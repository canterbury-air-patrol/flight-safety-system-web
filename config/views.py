"""
Views to configure servers and assets.
"""
from django.shortcuts import render

from assets.models import Asset

from .models import AssetConfig, ServerConfig, SMMConfig


def config_main(request):
    """
    Main configuration page
    """
    assets = list(Asset.objects.all())
    configs_by_asset_id = {c.asset_id: c for c in AssetConfig.objects.filter(asset__in=assets)}

    for asset in assets:
        asset.config = configs_by_asset_id.get(asset.id)

    data = {
        'FSSservers': ServerConfig.objects.all(),
        'SMMservers': SMMConfig.objects.all(),
        'Assets': assets,
    }
    return render(request, 'config/main.html', data)
