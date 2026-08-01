from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('assets', '0014_assetcommandack'),
    ]

    operations = [
        migrations.AddField(
            model_name='assetcommand',
            name='operation_id',
            field=models.UUIDField(blank=True, null=True, unique=True),
        ),
        migrations.AddField(
            model_name='assetcommandconfirmation',
            name='operation_id',
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
    ]
