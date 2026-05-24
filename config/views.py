"""
Views to configure servers and assets.
"""
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from assets.models import Asset
from fss.decorators import login_required_api

from .models import AssetConfig, ServerConfig, SMMConfig


@ensure_csrf_cookie
def config_main(request):
    """
    Main configuration page (serves React SPA)
    """
    return render(request, 'main/main.html')


@login_required_api
def config_data_json(request):
    """
    Return all configuration data as JSON
    """
    assets = list(Asset.objects.all())
    configs_by_asset_id = {c.asset_id: c for c in AssetConfig.objects.filter(asset__in=assets).select_related('smm')}

    fss_servers = []
    for s in ServerConfig.objects.all():
        fss_servers.append({
            'name': s.name,
            'address': s.address,
            'client_port': s.client_port,
            'config_port': s.config_port,
            'https': s.https,
            'url': s.http_address(),
        })

    smm_servers = []
    for s in SMMConfig.objects.all():
        smm_servers.append({
            'name': s.name,
            'address': s.address,
            'port': s.port,
            'https': s.https,
            'url': s.http_address(),
        })

    asset_list = []
    for a in assets:
        config = configs_by_asset_id.get(a.id)
        asset_list.append({
            'name': a.name,
            'pk': a.pk,
            'smm_name': config.smm.name if config else None,
            'smm_login': config.smm_login if config else None,
        })

    return JsonResponse({
        'fss_servers': fss_servers,
        'smm_servers': smm_servers,
        'assets': asset_list,
    })
