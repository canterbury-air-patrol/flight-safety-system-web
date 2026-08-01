import django.db.models.deletion
import django.db.models.functions.datetime
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('assets', '0013_asset_retirement_and_command_protection'),
    ]

    operations = [
        migrations.CreateModel(
            name='AssetCommandAck',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('dispatch_id', models.BigIntegerField()),
                ('ack_state', models.SmallIntegerField(choices=[(0, 'Received'), (1, 'Actioned'), (2, 'Superseded'), (3, 'Rejected'), (4, 'No change')])),
                ('ack_timestamp', models.BigIntegerField()),
                ('ack_superseded_by', models.SmallIntegerField(choices=[(0, 'None'), (1, 'Low Battery'), (2, 'Comms Loss'), (3, 'Newer Command')])),
                ('received_at', models.DateTimeField(db_default=django.db.models.functions.datetime.Now(), editable=False)),
                ('command', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='ack_history', to='assets.assetcommand')),
            ],
            options={
                'ordering': ('received_at', 'pk'),
                'indexes': [models.Index(fields=['command', 'received_at'], name='assets_asse_command_ec304b_idx')],
                'constraints': [models.CheckConstraint(condition=models.Q(('ack_superseded_by', 0), ('ack_state', 2), _connector='OR'), name='ack_history_supersede_reason_requires_superseded_state')],
            },
        ),
    ]
