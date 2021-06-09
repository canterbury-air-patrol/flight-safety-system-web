# Generated by Django 3.0.3 on 2020-02-16 11:28

import django.contrib.gis.db.models.fields
import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Asset',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
            ],
        ),
        migrations.CreateModel(
            name='AssetStatus',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(default=django.utils.timezone.now)),
                ('bat_percent', models.IntegerField()),
                ('bat_used_mah', models.IntegerField()),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='assets.Asset')),
            ],
        ),
        migrations.CreateModel(
            name='AssetSearchProgress',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(default=django.utils.timezone.now)),
                ('search', models.IntegerField()),
                ('search_progress', models.IntegerField()),
                ('search_progress_of', models.IntegerField()),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='assets.Asset')),
            ],
        ),
        migrations.CreateModel(
            name='AssetRTT',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(default=django.utils.timezone.now)),
                ('rtt', models.IntegerField()),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='assets.Asset')),
            ],
        ),
        migrations.CreateModel(
            name='AssetPosition',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(default=django.utils.timezone.now)),
                ('position', django.contrib.gis.db.models.fields.PointField(geography=True, srid=4326)),
                ('altitude', models.IntegerField(default=0)),
                ('asset', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='assets.Asset')),
            ],
        ),
        migrations.AddIndex(
            model_name='asset',
            index=models.Index(fields=['name'], name='assets_asse_name_e4d2fa_idx'),
        ),
        migrations.AddIndex(
            model_name='assetstatus',
            index=models.Index(fields=['asset', 'timestamp'], name='assets_asse_asset_i_ef8e63_idx'),
        ),
        migrations.AddIndex(
            model_name='assetsearchprogress',
            index=models.Index(fields=['asset', 'timestamp'], name='assets_asse_asset_i_db9f9f_idx'),
        ),
        migrations.AddIndex(
            model_name='assetrtt',
            index=models.Index(fields=['asset', 'timestamp'], name='assets_asse_asset_i_9b46c0_idx'),
        ),
        migrations.AddIndex(
            model_name='assetposition',
            index=models.Index(fields=['asset', 'timestamp'], name='assets_asse_asset_i_9e3456_idx'),
        ),
    ]
