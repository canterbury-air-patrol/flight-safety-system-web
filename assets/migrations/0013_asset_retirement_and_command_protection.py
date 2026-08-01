import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('assets', '0012_assetcommand_notify'),
    ]

    operations = [
        migrations.AddField(
            model_name='asset',
            name='retired_at',
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                help_text='Retire this asset instead of deleting its identity and audit history.',
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name='assetcommand',
            name='asset',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                to='assets.asset',
            ),
        ),
    ]
