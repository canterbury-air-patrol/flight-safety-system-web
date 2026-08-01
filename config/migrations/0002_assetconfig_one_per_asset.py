import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Count


def require_unique_asset_configs(apps, _schema_editor):
    """Abort without exposing credentials when legacy conflicts remain."""
    asset_config = apps.get_model('config', 'AssetConfig')
    duplicate_asset_ids = list(
        asset_config.objects
        .values('asset_id')
        .annotate(row_count=Count('pk'))
        .filter(row_count__gt=1)
        .order_by('asset_id')
        .values_list('asset_id', flat=True)
    )
    if duplicate_asset_ids:
        raise RuntimeError(
            'Duplicate AssetConfig rows must be resolved for asset IDs: '
            + ', '.join(str(asset_id) for asset_id in duplicate_asset_ids)
        )


class Migration(migrations.Migration):

    dependencies = [
        ('config', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(require_unique_asset_configs, migrations.RunPython.noop),
        migrations.RemoveIndex(
            model_name='assetconfig',
            name='config_asse_asset_i_c1e6c4_idx',
        ),
        migrations.AlterField(
            model_name='assetconfig',
            name='asset',
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                to='assets.asset',
            ),
        ),
    ]
