"""
Views for Assets
"""

import contextlib

from django.contrib.gis.geos import Point
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import OuterRef, Subquery
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Asset, AssetCommand, AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus

RTT_SAMPLE_LIMIT = 15


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

    # Initialize aggregates from the first RTT entry to avoid magic sentinel values
    first = rtts[0]
    rtt_total = first.rtt
    rtt_min = first.rtt
    rtt_max = first.rtt

    for rtt in rtts[1:]:
        rtt_min = min(rtt_min, rtt.rtt)
        rtt_max = max(rtt_max, rtt.rtt)
        rtt_total += rtt.rtt

    rtt_avg = rtt_total / len(rtts)

    return {
        'timestamp': first.timestamp,
        'rtt': first.rtt,
        'rtt_min': rtt_min,
        'rtt_max': rtt_max,
        'rtt_avg': round(rtt_avg),
    }


def _format_command(cmd):
    if not cmd:
        return None
    data = {
        'timestamp': cmd.timestamp,
        'command': cmd.get_command_display(),
    }
    if cmd.position:
        data['lat'] = cmd.position.y
        data['lng'] = cmd.position.x
    if cmd.altitude is not None:
        data['alt'] = cmd.altitude
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
        command = AssetCommand.objects.filter(asset=asset).latest('timestamp')

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
            )
        },
    }

    # Fetch RTTs (up to RTT_SAMPLE_LIMIT per asset)
    # We do this per-asset because a bulk query with a limit-per-group is extremely
    # inefficient in Django's ORM without complex raw SQL or lateral joins.
    # Given the number of assets is small, N fast indexed queries is better
    # than 1 query that fetches every RTT record in the database.
    rtts_by_asset = {}
    for asset in annotated_assets:
        rtts_by_asset[asset.pk] = list(
            AssetRTT.objects.filter(asset=asset)
            .order_by('-timestamp')[:RTT_SAMPLE_LIMIT]
        )

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


def asset_status_json(request, asset_id):
    """
    Show the current asset status
    """
    asset = get_object_or_404(Asset, pk=asset_id)

    return JsonResponse(asset_status_data(asset))


def asset_command_set(request, asset_id):
    """
    Set the command for a given asset
    """
    asset = get_object_or_404(Asset, pk=asset_id)
    if request.method == "POST":
        point = None
        altitude = None
        command = request.POST.get('command')
        if command in AssetCommand.REQUIRES_POSITION:
            latitude = request.POST.get('latitude')
            longitude = request.POST.get('longitude')
            try:
                point = Point(float(longitude), float(latitude))
            except (ValueError, TypeError):
                return HttpResponseBadRequest('Invalid Lat/Long')
        if command in AssetCommand.REQUIRES_ALTITUDE:
            try:
                altitude = int(request.POST.get('altitude'))
                if altitude < 0 or altitude > 1000:
                    raise ValueError
            except (ValueError, TypeError):
                return HttpResponseBadRequest('Invalid Altitude')
        asset_command = AssetCommand(asset=asset, command=command,
                                     position=point, altitude=altitude)
        asset_command.save()
        return HttpResponse("Created")
    return HttpResponseBadRequest("Only POST is supported")


def asset_add(request):
    """
    Add an asset
    """
    if request.method == "POST":
        asset_name = request.POST.get('asset_name')
        if asset_name is not None:
            if Asset.objects.filter(name=asset_name).exists():
                return HttpResponse("Asset already exists", status=409)
            asset = Asset(name=asset_name)
            asset.save()
            return HttpResponse("Created")
    return HttpResponseBadRequest("Only POST is supported")
