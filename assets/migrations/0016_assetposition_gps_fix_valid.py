import django.contrib.gis.db.models.fields
from django.db import migrations, models


def allow_missing_position(_apps, schema_editor):
    """Drop the PostGIS NOT NULL constraint; SpatiaLite permits NULL already."""
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        'ALTER TABLE assets_assetposition '
        'ALTER COLUMN position DROP NOT NULL'
    )


def require_position(_apps, schema_editor):
    """Restore the old constraint when rolling back a database with no NULLs."""
    if schema_editor.connection.vendor != 'postgresql':
        return
    schema_editor.execute(
        'ALTER TABLE assets_assetposition '
        'ALTER COLUMN position SET NOT NULL'
    )


class Migration(migrations.Migration):

    dependencies = [
        ('assets', '0015_command_operation_id'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    allow_missing_position,
                    require_position,
                ),
            ],
            state_operations=[
                migrations.AlterField(
                    model_name='assetposition',
                    name='position',
                    field=django.contrib.gis.db.models.fields.PointField(
                        geography=True,
                        null=True,
                        srid=4326,
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name='assetposition',
            name='gps_fix_valid',
            field=models.BooleanField(db_default=True, default=True),
        ),
        migrations.AddIndex(
            model_name='assetposition',
            index=models.Index(
                fields=['asset', 'gps_fix_valid', '-timestamp'],
                name='asset_pos_fix_time_idx',
            ),
        ),
    ]
