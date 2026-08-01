"""
Views for Assets
"""

import logging
import uuid
from datetime import timedelta

from django.contrib.gis.geos import Point
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import OuterRef, Subquery
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie

from fss.decorators import login_required_api

from .models import Asset, AssetCommand, AssetCommandConfirmation, AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus

RTT_SAMPLE_LIMIT = 15
COMMAND_CONFIRMATION_TTL = timedelta(seconds=60)
ASSET_CONNECTION_TIMEOUT = timedelta(seconds=60)
LOGGER = logging.getLogger('fss.security')

# How far back the RTT window-function query below looks. Bounds the scan to
# a fixed recent window instead of the fleet's entire history, while staying
# a comfortable multiple of the reporting period so RTT_SAMPLE_LIMIT samples
# are always found within it.
RTT_SCAN_WINDOW = timedelta(hours=1)


def server_now_ms():
    """
    The server's current time as epoch milliseconds.

    Emitted alongside status data so the frontend can age commands against a
    single server clock (server_now - command.timestamp) rather than mixing the
    browser clock with server/FMU timestamps, which clock skew would corrupt.
    """
    return int(timezone.now().timestamp() * 1000)


def asset_has_live_connection(asset, now=None):
    """
    Return whether the asset has answered an RTT request recently enough to
    accept a command.

    RTT responses are the server's direct per-asset liveness signal. The FSS
    server normally requests one every 10 seconds and times a client out after
    30 seconds; a 60-second web-side window tolerates scheduling/database
    jitter while still refusing commands for a connection that is no longer
    plausibly live.
    """
    cutoff = (now or timezone.now()) - ASSET_CONNECTION_TIMEOUT
    return AssetRTT.objects.filter(asset=asset, timestamp__gte=cutoff).exists()


def _latest_rtt_is_recent(rtts, now=None):
    """Classify an already-fetched, newest-first RTT collection."""
    if not rtts:
        return False
    cutoff = (now or timezone.now()) - ASSET_CONNECTION_TIMEOUT
    return rtts[0].timestamp >= cutoff


@ensure_csrf_cookie
def assets_main(request):
    """
    Show the current asset list (serves React SPA)
    """
    return render(request, 'main/main.html')


def _format_position(pos):
    if not pos:
        return None
    return {
        'timestamp': pos.timestamp,
        'lat': pos.position.y,
        'lng': pos.position.x,
        'alt': pos.altitude,
    }


def _format_status(stat):
    if not stat:
        return None
    return {
        'timestamp': stat.timestamp,
        'battery_percent': stat.bat_percent,
        'battery_used': stat.bat_used_mah,
        'battery_voltage': stat.bat_volt,
    }


def _format_search(srch):
    if not srch:
        return None
    return {
        'timestamp': srch.timestamp,
        'id': srch.search,
        'progress': srch.search_progress,
        'total': srch.search_progress_of,
    }


def _format_rtts(rtts):
    if not rtts:
        return None

    # Initialize aggregates from the most recent RTT entry to avoid magic sentinel values
    latest = rtts[0]
    rtt_total = latest.rtt
    rtt_min = latest.rtt
    rtt_max = latest.rtt

    for rtt in rtts[1:]:
        rtt_min = min(rtt_min, rtt.rtt)
        rtt_max = max(rtt_max, rtt.rtt)
        rtt_total += rtt.rtt

    rtt_avg = rtt_total / len(rtts)

    return {
        'timestamp': latest.timestamp,
        'rtt': latest.rtt,
        'rtt_min': rtt_min,
        'rtt_max': rtt_max,
        'rtt_avg': round(rtt_avg),
    }


# Machine-readable codes for each ack outcome, paired with the human label
# from AssetCommand.ACK_STATE_CHOICES. The codes are what the frontend
# switches on; the display label is for convenience.
ACK_STATE_CODES = {
    AssetCommand.ACK_RECEIVED: 'received',
    AssetCommand.ACK_ACTIONED: 'actioned',
    AssetCommand.ACK_SUPERSEDED: 'superseded',
    AssetCommand.ACK_REJECTED: 'rejected',
    AssetCommand.ACK_NOOP: 'noop',
}

# Machine-readable codes for the supersede reason (fss_command_ack_reason),
# meaningful only when ack_state is 'superseded'.
ACK_SUPERSEDE_REASON_CODES = {
    AssetCommand.SUPERSEDE_NONE: 'none',
    AssetCommand.SUPERSEDE_LOW_BATTERY: 'low_battery',
    AssetCommand.SUPERSEDE_COMMS_LOSS: 'comms_loss',
    AssetCommand.SUPERSEDE_NEWER_COMMAND: 'newer_command',
}


def _format_command(cmd):
    if not cmd:
        return None
    data = {
        'timestamp': cmd.timestamp,
        'command': cmd.get_command_display(),
        'command_code': cmd.command,
        # Who dispatched the command (audit trail); NULL for legacy rows or a
        # since-deleted account.
        'issued_by': cmd.issued_by.username if cmd.issued_by else None,
    }
    if cmd.position:
        data['lat'] = cmd.position.y
        data['lng'] = cmd.position.x
    if cmd.altitude is not None:
        data['alt'] = cmd.altitude
    # Acknowledgement state. ack_state is NULL until the FSS server records an
    # ack against this command, so a dispatched-but-unacked command reports
    # 'pending'. ack_timestamp is the FMU's wall-clock epoch-ms, passed through
    # for the frontend to render.
    if cmd.ack_state is None:
        data['ack_state'] = 'pending'
    else:
        data['ack_state'] = ACK_STATE_CODES.get(cmd.ack_state, 'pending')
        data['ack_state_display'] = cmd.get_ack_state_display()
    if cmd.ack_timestamp is not None:
        data['ack_timestamp'] = cmd.ack_timestamp
    if cmd.ack_superseded_by is not None:
        data['ack_superseded_by'] = ACK_SUPERSEDE_REASON_CODES.get(cmd.ack_superseded_by, 'none')
    return data


# pylint: disable=too-many-arguments,too-many-positional-arguments
def format_asset_status(asset, position=None, status=None, search=None, rtts=None, command=None, now=None):
    """
    Centralized formatting logic for asset status data.
    """
    data = {
        'asset': {
            'name': asset.name,
            'pk': asset.pk,
        },
        # This is deliberately based on RTT rather than generic telemetry:
        # position/status reports may be infrequent while RTT is the FSS
        # server's active connection heartbeat.
        'connected': _latest_rtt_is_recent(rtts, now),
    }

    pos_data = _format_position(position)
    if pos_data:
        data['position'] = pos_data

    stat_data = _format_status(status)
    if stat_data:
        data['status'] = stat_data

    srch_data = _format_search(search)
    if srch_data:
        data['search'] = srch_data

    rtt_data = _format_rtts(rtts) if rtts is not None else None
    if rtt_data:
        data['rtt'] = rtt_data

    cmd_data = _format_command(command)
    if cmd_data:
        data['command'] = cmd_data

    return data


def bulk_asset_status_data(assets):
    """
    Get current status data for a list of assets efficiently.
    """

    def latest_subquery(model):
        return (
            model.objects
            .filter(asset=OuterRef('pk'))
            .order_by('-timestamp')
            .values('pk')[:1]
        )

    # Materialize annotated assets to avoid multiple database evaluations
    annotated_assets = list(
        assets.annotate(
            pos_id=Subquery(latest_subquery(AssetPosition)),
            stat_id=Subquery(latest_subquery(AssetStatus)),
            srch_id=Subquery(latest_subquery(AssetSearchProgress)),
            cmd_id=Subquery(latest_subquery(AssetCommand)),
        )
    )

    # Fetch latest objects for all assets in 4 bulk queries
    latest = {
        'positions': {
            p.asset_id: p
            for p in AssetPosition.objects.filter(
                pk__in=[a.pos_id for a in annotated_assets if a.pos_id]
            )
        },
        'statuses': {
            s.asset_id: s
            for s in AssetStatus.objects.filter(
                pk__in=[a.stat_id for a in annotated_assets if a.stat_id]
            )
        },
        'searches': {
            s.asset_id: s
            for s in AssetSearchProgress.objects.filter(
                pk__in=[a.srch_id for a in annotated_assets if a.srch_id]
            )
        },
        'commands': {
            c.asset_id: c
            for c in AssetCommand.objects.filter(
                pk__in=[a.cmd_id for a in annotated_assets if a.cmd_id]
            ).select_related('issued_by')
        },
    }

    # Fetch the latest RTT_SAMPLE_LIMIT RTTs per asset in one query using a
    # window function — Django ORM can't express LIMIT-per-group without raw SQL.
    # Bound by RTT_SCAN_WINDOW so the partition doesn't materialize over the
    # fleet's entire RTT history on every poll; the cutoff is computed in
    # Python (rather than a database-specific interval literal) so the query
    # stays portable across the spatialite (tests) and PostGIS (production)
    # backends.
    rtts_by_asset = {}
    now = timezone.now()
    asset_ids = [a.pk for a in annotated_assets]
    if asset_ids:
        placeholders = ','.join(['%s'] * len(asset_ids))
        table_name = AssetRTT._meta.db_table
        scan_cutoff = now - RTT_SCAN_WINDOW
        for rtt in AssetRTT.objects.raw(
            "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY timestamp DESC) AS rn "
            f"FROM {table_name} WHERE asset_id IN ({placeholders}) AND timestamp > %s) t WHERE rn <= %s "
            "ORDER BY asset_id, rn",
            [*asset_ids, scan_cutoff, RTT_SAMPLE_LIMIT]
        ):
            rtts_by_asset.setdefault(rtt.asset_id, []).append(rtt)

    results = []
    for asset in annotated_assets:
        results.append(
            format_asset_status(
                asset,
                position=latest['positions'].get(asset.pk),
                status=latest['statuses'].get(asset.pk),
                search=latest['searches'].get(asset.pk),
                rtts=rtts_by_asset.get(asset.pk, []),
                command=latest['commands'].get(asset.pk),
                now=now,
            )
        )
    return results


@login_required_api
def asset_command_confirm(request, asset_id):  # pylint: disable=too-many-return-statements
    """
    Issue short-lived, single-use evidence for a destructive command.
    """
    asset = get_object_or_404(Asset, pk=asset_id, retired_at__isnull=True)
    if request.method != "POST":
        return HttpResponseBadRequest("Only POST is supported")

    command = request.POST.get('command')
    if command not in AssetCommand.DESTRUCTIVE_COMMANDS:
        return HttpResponseBadRequest("Invalid destructive command")
    unexpected_parameters = set(request.POST) - {'command', 'operation_id'}
    if unexpected_parameters:
        return HttpResponseBadRequest(
            f"Unexpected parameter(s): {', '.join(sorted(unexpected_parameters))}"
        )
    operation_id = _parse_operation_id(request.POST.get('operation_id'))
    if operation_id is None:
        return HttpResponseBadRequest("Valid operation_id required")

    # SECURITY-01 must add its destructive-command permission check here,
    # before either revealing an existing operation or issuing evidence.
    existing_command = AssetCommand.objects.filter(operation_id=operation_id).first()
    if existing_command is not None:
        requested = AssetCommand(
            asset=asset,
            command=command,
            operation_id=operation_id,
            issued_by=request.user,
        )
        if not _same_command_operation(existing_command, requested):
            return _operation_conflict_response(existing_command, requested)
        return JsonResponse({'operation_committed': True})

    now = timezone.now()
    AssetCommandConfirmation.objects.filter(expires_at__lte=now).delete()
    existing_confirmation = AssetCommandConfirmation.objects.filter(
        operation_id=operation_id,
        user=request.user,
        asset=asset,
        command=command,
        expires_at__gt=now,
    ).first()
    if existing_confirmation is not None:
        return _confirmation_response(existing_confirmation)
    confirmation = AssetCommandConfirmation.objects.create(
        operation_id=operation_id,
        user=request.user,
        asset=asset,
        command=command,
        expires_at=now + COMMAND_CONFIRMATION_TTL,
    )
    return _confirmation_response(confirmation)


def _confirmation_response(confirmation):
    """Format destructive confirmation evidence consistently."""
    return JsonResponse({
        'confirmation_token': str(confirmation.token),
        'expires_at': confirmation.expires_at,
    })


def _queue_destructive_command(asset_command, user, confirmation_token):
    """
    Consume matching confirmation evidence and queue its command atomically.

    Return the queued command, whether it was newly created, and whether valid
    confirmation evidence was available. A unique-operation race resolves to
    the winning row without consuming a second confirmation.
    """
    try:
        with transaction.atomic():
            confirmation = AssetCommandConfirmation.objects.select_for_update().filter(
                token=confirmation_token,
                operation_id=asset_command.operation_id,
                user=user,
                asset=asset_command.asset,
                command=asset_command.command,
                expires_at__gt=timezone.now(),
            ).first()
            if confirmation is None:
                existing = AssetCommand.objects.filter(
                    operation_id=asset_command.operation_id,
                ).first()
                return existing, False, existing is not None
            try:
                # The savepoint keeps the outer transaction usable if another
                # request inserts the operation after the initial lookup.
                with transaction.atomic():
                    asset_command.save()
            except IntegrityError:
                existing = AssetCommand.objects.get(
                    operation_id=asset_command.operation_id,
                )
                return existing, False, True
            AssetCommandConfirmation.objects.filter(
                operation_id=asset_command.operation_id,
                user=user,
                asset=asset_command.asset,
                command=asset_command.command,
            ).exclude(pk=confirmation.pk).delete()
            confirmation.delete()
    except (TypeError, ValidationError, ValueError):
        return None, False, False
    return asset_command, True, True


def _queue_routine_command(asset_command):
    """Insert a routine command or resolve a concurrent operation insert."""
    try:
        with transaction.atomic():
            asset_command.save()
    except IntegrityError:
        existing = AssetCommand.objects.filter(
            operation_id=asset_command.operation_id,
        ).first()
        if existing is None:
            raise
        return existing, False
    return asset_command, True


def _parse_operation_id(value):
    """Return a UUID for a valid operation identifier, otherwise None."""
    try:
        return uuid.UUID(value)
    except (AttributeError, TypeError, ValueError):
        return None


def _same_position(left, right):
    """Compare optional command points without relying on database SRIDs."""
    if left is None or right is None:
        return left is None and right is None
    return left.x == right.x and left.y == right.y


def _same_command_operation(existing, requested):
    """Return whether two rows describe the same logical operator action."""
    return all((
        existing.issued_by_id == requested.issued_by_id,
        existing.asset_id == requested.asset_id,
        existing.command == requested.command,
        _same_position(existing.position, requested.position),
        existing.altitude == requested.altitude,
    ))


def _operation_conflict_response(existing, requested):
    """Log and reject reuse of an operation identifier for different input."""
    LOGGER.warning(
        "Command operation ID conflict operation_id=%s existing_user_id=%s "
        "requested_user_id=%s existing_asset_id=%s requested_asset_id=%s "
        "existing_command=%s requested_command=%s",
        requested.operation_id,
        existing.issued_by_id,
        requested.issued_by_id,
        existing.asset_id,
        requested.asset_id,
        existing.command,
        requested.command,
    )
    return HttpResponse("Operation ID conflicts with an existing command", status=409)


def _command_parameter_error(parameters, command):
    """Return the first command payload-contract error, if any."""
    if command not in dict(AssetCommand.COMMAND_CHOICES):
        return 'Invalid command'
    unexpected_parameters = set(parameters) - AssetCommand.allowed_parameter_names(command)
    if unexpected_parameters:
        return f"Unexpected parameter(s): {', '.join(sorted(unexpected_parameters))}"
    return None


@login_required_api
def asset_command_set(request, asset_id):  # pylint: disable=too-many-return-statements,too-many-locals,too-many-branches
    """
    Set the command for a given asset
    """
    asset = get_object_or_404(Asset, pk=asset_id, retired_at__isnull=True)
    if request.method == "POST":
        point = None
        altitude = None
        command = request.POST.get('command')
        parameter_error = _command_parameter_error(request.POST, command)
        if parameter_error is not None:
            return HttpResponseBadRequest(parameter_error)
        operation_id = _parse_operation_id(request.POST.get('operation_id'))
        if operation_id is None:
            return HttpResponseBadRequest("Valid operation_id required")
        if command in AssetCommand.REQUIRES_POSITION:
            latitude = request.POST.get('latitude')
            longitude = request.POST.get('longitude')
            try:
                lat = float(latitude)
                lng = float(longitude)
                if not -90 <= lat <= 90 or not -180 <= lng <= 180:
                    raise ValueError
                point = Point(lng, lat)
            except (ValueError, TypeError):
                return HttpResponseBadRequest('Invalid Lat/Long')
        if command in AssetCommand.REQUIRES_ALTITUDE:
            try:
                altitude = int(request.POST.get('altitude'))
                if altitude < 0 or altitude > AssetCommand.ALTITUDE_MAX_FT:
                    raise ValueError
            except (ValueError, TypeError):
                return HttpResponseBadRequest('Invalid Altitude')
        # @login_required_api guarantees an authenticated user here; guard
        # anyway so that decorator changing can't try to assign an AnonymousUser
        # to the FK. None keeps the command row, just without an attributed user.
        issued_by = request.user if request.user.is_authenticated else None
        asset_command = AssetCommand(asset=asset, command=command,
                                     position=point, altitude=altitude,
                                     issued_by=issued_by,
                                     operation_id=operation_id)
        # SECURITY-01 must add its command-class permission check here, after
        # parsing the requested command but before this operation lookup.
        existing_command = AssetCommand.objects.filter(operation_id=operation_id).first()
        if existing_command is not None:
            if not _same_command_operation(existing_command, asset_command):
                return _operation_conflict_response(existing_command, asset_command)
            return HttpResponse("Queued")
        if not asset_has_live_connection(asset):
            return HttpResponse(
                "Asset is disconnected: no recent RTT response",
                status=409,
            )
        if command in AssetCommand.DESTRUCTIVE_COMMANDS:
            confirmation_token = request.POST.get('confirmation_token')
            queued_command, _created, confirmed = _queue_destructive_command(
                asset_command,
                request.user,
                confirmation_token,
            )
            if not confirmed:
                return HttpResponseBadRequest("Valid confirmation required")
            if not _same_command_operation(queued_command, asset_command):
                return _operation_conflict_response(queued_command, asset_command)
        else:
            queued_command, _created = _queue_routine_command(asset_command)
            if not _same_command_operation(queued_command, asset_command):
                return _operation_conflict_response(queued_command, asset_command)
        return HttpResponse("Queued")
    return HttpResponseBadRequest("Only POST is supported")


@login_required_api
def asset_add(request):
    """
    Add an asset
    """
    if request.method != "POST":
        return HttpResponseBadRequest("Only POST is supported")
    asset_name = request.POST.get('asset_name')
    if asset_name is None:
        return HttpResponseBadRequest("Missing asset_name")
    try:
        # Contain the expected uniqueness failure in a savepoint. This keeps
        # the surrounding request transaction usable when session middleware
        # persists the sliding expiry after the view returns.
        with transaction.atomic():
            Asset.objects.create(name=asset_name)
    except IntegrityError:
        # Relies on Asset.name's unique constraint rather than a racy
        # exists()-then-save() check, so two concurrent requests for the same
        # name both get the clean 409 instead of one raising an unhandled 500.
        return HttpResponse("Asset already exists", status=409)
    return HttpResponse("Created")
