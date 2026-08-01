"""Tests for asset lifecycle and audit relationships."""

# pylint: disable=missing-function-docstring

from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone

from assets.models import Asset, AssetCommand


class AssetLifecycleTest(TestCase):
    """Asset identities are retired and retained rather than deleted."""

    def test_instance_delete_requires_retirement(self):
        asset = Asset.objects.create(name='Instance delete')

        with self.assertRaisesMessage(ProtectedError, 'set retired_at instead'):
            asset.delete()

        self.assertTrue(Asset.objects.filter(pk=asset.pk).exists())

    def test_queryset_delete_requires_retirement(self):
        asset = Asset.objects.create(name='Queryset delete')

        with self.assertRaisesMessage(ProtectedError, 'set retired_at instead'):
            Asset.objects.filter(pk=asset.pk).delete()

        self.assertTrue(Asset.objects.filter(pk=asset.pk).exists())

    def test_retirement_is_reversible(self):
        asset = Asset.objects.create(name='Reactivatable')
        asset.retired_at = timezone.now()
        asset.save(update_fields=['retired_at'])
        asset.retired_at = None
        asset.save(update_fields=['retired_at'])

        asset.refresh_from_db()
        self.assertIsNone(asset.retired_at)

    def test_command_protects_asset_from_collector_deletion(self):
        asset = Asset.objects.create(name='Protected command')
        command = AssetCommand.objects.create(asset=asset, command='RTL')

        with self.assertRaises(ProtectedError):
            asset.delete()

        self.assertTrue(Asset.objects.filter(pk=asset.pk).exists())
        self.assertTrue(AssetCommand.objects.filter(pk=command.pk).exists())
