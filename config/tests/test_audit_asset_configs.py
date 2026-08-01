"""Tests for the AssetConfig duplicate audit command."""

# pylint: disable=missing-function-docstring

from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from assets.models import Asset
from config.models import AssetConfig, SMMConfig


class AuditAssetConfigsTest(TestCase):
    """The audit identifies conflicts without exposing credentials."""

    def setUp(self):
        self.asset = Asset.objects.create(name='Configured asset')
        self.smm = SMMConfig.objects.create(name='SMM', address='smm.example')

    def run_command(self):
        stdout = StringIO()
        call_command('audit_asset_configs', stdout=stdout)
        return stdout.getvalue()

    def test_no_duplicates_passes(self):
        AssetConfig.objects.create(
            asset=self.asset,
            smm=self.smm,
            smm_login='operator',
            smm_password='top-secret',
        )

        self.assertIn('No duplicate AssetConfig rows found', self.run_command())

    def test_duplicates_report_only_asset_identity_and_count(self):
        for login, password in (('one', 'first-secret'), ('two', 'second-secret')):
            AssetConfig.objects.create(
                asset=self.asset,
                smm=self.smm,
                smm_login=login,
                smm_password=password,
            )
        stdout = StringIO()

        with self.assertRaises(CommandError):
            call_command('audit_asset_configs', stdout=stdout)

        output = stdout.getvalue()
        self.assertIn(f'asset_id={self.asset.pk} rows=2', output)
        self.assertNotIn('one', output)
        self.assertNotIn('two', output)
        self.assertNotIn('secret', output)
