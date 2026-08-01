"""Consistent lookup of the optional SMM configuration for each asset."""

from django.http import JsonResponse

from assets.models import Asset

from .models import AssetConfig


class DuplicateAssetConfigError(Exception):
    """Raised when legacy data contains conflicting configurations."""

    def __init__(self, asset_ids):
        self.asset_ids = tuple(asset_ids)
        super().__init__(f"Duplicate AssetConfig rows for asset IDs: {self.asset_ids}")


def asset_configs_by_asset_id(assets):
    """Return one config per asset or report every conflicting asset ID."""
    configs = list(
        AssetConfig.objects
        .filter(asset__in=assets)
        .select_related('smm')
        .order_by('asset_id', 'pk')
    )
    configs_by_asset_id = {}
    duplicate_asset_ids = set()
    for config in configs:
        if config.asset_id in configs_by_asset_id:
            duplicate_asset_ids.add(config.asset_id)
        else:
            configs_by_asset_id[config.asset_id] = config
    if duplicate_asset_ids:
        raise DuplicateAssetConfigError(sorted(duplicate_asset_ids))
    return configs_by_asset_id


def active_assets_with_configs():
    """Return active assets and configs, or a cleanup-window error response."""
    assets = list(Asset.objects.filter(retired_at__isnull=True))
    try:
        return (assets, asset_configs_by_asset_id(assets)), None
    except DuplicateAssetConfigError as exc:
        return None, JsonResponse({
            'error': 'Multiple SMM configurations exist for one or more assets.',
            'duplicate_asset_ids': exc.asset_ids,
        }, status=409)
