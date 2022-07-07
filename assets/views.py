"""
Views for Assets
"""
from django.contrib.gis.geos import Point
from django.core.exceptions import ObjectDoesNotExist
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import csrf_exempt

from .models import Asset, AssetCommand, AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus


def assets_main(request):
    """
    Show the current asset list
    """
    data = {
        'assets': Asset.objects.all(),
    }
    return render(request, 'assets/main.html', data)


def asset_status_data(asset):
    """
    Get all the current status data for an asset
    """
    data = {
        'asset': {
            'name': asset.name,
            'pk': asset.pk
        }
    }

    try:
        position = AssetPosition.objects.filter(asset=asset).latest('timestamp')
        data['position'] = {
            'timestamp': position.timestamp,
            'lat': position.position.y,
            'lng': position.position.x,
        }
    except ObjectDoesNotExist:
        pass
    try:
        status = AssetStatus.objects.filter(asset=asset).latest('timestamp')
        data['status'] = {
            'timestamp': status.timestamp,
            'battery_percent': status.bat_percent,
            'battery_used': status.bat_used_mah,
            'battery_voltage': status.bat_volt,
        }
    except ObjectDoesNotExist:
        pass
    try:
        search = AssetSearchProgress.objects.filter(asset=asset).latest('timestamp')
        data['search'] = {
            'timestamp': search.timestamp,
            'id': search.search,
            'progress': search.search_progress,
            'total': search.search_progress_of,
        }
    except ObjectDoesNotExist:
        pass
    try:
        rtts = AssetRTT.objects.filter(asset=asset).order_by('-timestamp')[:15]
        rtt_total = 0
        rtt_avg = -1
        rtt_min = -1
        rtt_max = 0
        count = 0
        for rtt in rtts:
            if rtt_min == -1 or rtt.rtt < rtt_min:
                rtt_min = rtt.rtt
            if rtt_max < rtt.rtt:
                rtt_max = rtt.rtt
            rtt_total += rtt.rtt
            count += 1
        if count > 0:
            rtt_avg = rtt_total / count
        data['rtt'] = {
            'timestamp': rtts[0].timestamp,
            'rtt': rtts[0].rtt,
            'rtt_min': rtt_min,
            'rtt_max': rtt_max,
            'rtt_avg': round(rtt_avg),
        }
    except IndexError:
        pass
    try:
        command = AssetCommand.objects.filter(asset=asset).latest('timestamp')
        data['command'] = {
            'timestamp': command.timestamp,
            'command': command.get_command_display(),
        }
        if command.position:
            data['command']['lat'] = command.position.y
            data['command']['lng'] = command.position.x
        if command.altitude:
            data['command']['alt'] = command.altitude
    except ObjectDoesNotExist:
        pass

    return data


def asset_status_json(request, asset_id):
    """
    Show the current asset status
    """
    asset = get_object_or_404(Asset, pk=asset_id)

    return JsonResponse(asset_status_data(asset))


@csrf_exempt
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
            error = False
            try:
                altitude = int(request.POST.get('altitude'))
            except (ValueError, TypeError):
                error = True
            if not error:
                if altitude < 0 or altitude > 1000:
                    error = True
            if error:
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
                return HttpResponseForbidden("Asset already exists")
            asset = Asset(name=asset_name)
            asset.save()
            return HttpResponse("Created")
    return HttpResponseBadRequest("Only POST is supported")
