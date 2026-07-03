"""
Views for Assets
"""

import contextlib

from django.contrib.gis.geos import Point
from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError
from django.db.models import OuterRef, Subquery
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie

from fss.decorators import login_required_api

from .models import Asset, AssetCommand, AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus

RTT_SAMPLE_LIMIT = 15


def server_now_ms():
    """
    The server's current time as epoch milliseconds.

    Emitted alongside status data so the frontend can age commands against a
    single server clock (server_now - command.timestamp) rather than mixing the
    browser clock with server/FMU timestamps, which clock skew would corrupt.
    """
    return int(timezone.now().timestamp() * 1000)


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
def format_asset_status(asset, position=None, status=None, search=None, rtts=None, command=None):
    """
    Centralized formatting logic for asset status data.
    """
    data = {
        'asset': {
            'name': asset.name,
            'pk': asset.pk,
        }
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


def asset_status_data(asset):
    """
    Get all the current status data for an asset (single-asset, DB-backed).
    """
    position = status = search = command = None
    rtts = []

    with contextlib.suppress(ObjectDoesNotExist):
        position = AssetPosition.objects.filter(asset=asset).latest('timestamp')

    with contextlib.suppress(ObjectDoesNotExist):
        status = AssetStatus.objects.filter(asset=asset).latest('timestamp')

    with contextlib.suppress(ObjectDoesNotExist):
        search = AssetSearchProgress.objects.filter(asset=asset).latest('timestamp')

    with contextlib.suppress(IndexError):
        rtts = list(
            AssetRTT.objects.filter(asset=asset)
            .order_by('-timestamp')[:RTT_SAMPLE_LIMIT]
        )

    with contextlib.suppress(ObjectDoesNotExist):
        command = AssetCommand.objects.filter(asset=asset).select_related('issued_by').latest('timestamp')

    return format_asset_status(
        asset,
        position=position,
        status=status,
        search=search,
        rtts=rtts,
        command=command,
    )


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
    rtts_by_asset = {}
    asset_ids = [a.pk for a in annotated_assets]
    if asset_ids:
        placeholders = ','.join(['%s'] * len(asset_ids))
        table_name = AssetRTT._meta.db_table
        for rtt in AssetRTT.objects.raw(
            "SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY timestamp DESC) AS rn "
            f"FROM {table_name} WHERE asset_id IN ({placeholders})) t WHERE rn <= %s "
            "ORDER BY asset_id, rn",
            [*asset_ids, RTT_SAMPLE_LIMIT]
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
            )
        )
    return results


@login_required_api
def asset_status_json(request, asset_id):
    """
    Show the current asset status
    """
    asset = get_object_or_404(Asset, pk=asset_id)

    return JsonResponse(asset_status_data(asset))


@login_required_api
def asset_command_set(request, asset_id):
    """
    Set the command for a given asset
    """
    asset = get_object_or_404(Asset, pk=asset_id)
    if request.method == "POST":
        point = None
        altitude = None
        command = request.POST.get('command')
        valid_commands = dict(AssetCommand.COMMAND_CHOICES)
        if command not in valid_commands:
            return HttpResponseBadRequest('Invalid command')
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
                                     issued_by=issued_by)
        asset_command.save()
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
        Asset.objects.create(name=asset_name)
    except IntegrityError:
        # Relies on Asset.name's unique constraint rather than a racy
        # exists()-then-save() check, so two concurrent requests for the same
        # name both get the clean 409 instead of one raising an unhandled 500.
        return HttpResponse("Asset already exists", status=409)
    return HttpResponse("Created")
