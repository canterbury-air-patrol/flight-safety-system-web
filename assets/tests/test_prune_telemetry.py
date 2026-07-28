"""
Tests for the prune_telemetry management command.
"""

# pylint: disable=missing-function-docstring

from datetime import datetime, timedelta
from datetime import timezone as datetime_timezone
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from assets.models import Asset, AssetCommand, AssetCommandConfirmation, AssetPosition, AssetRTT, AssetSearchProgress, AssetStatus

RETENTION_DISABLED = {
    'TELEMETRY_POSITION_RETENTION_DAYS': None,
    'TELEMETRY_STATUS_RETENTION_DAYS': None,
    'TELEMETRY_RTT_RETENTION_DAYS': None,
    'TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS': None,
    'TELEMETRY_ALIGNED_WINDOW_HOURS': 24,
}
RETENTION_SETTING_BY_MODEL = {
    AssetPosition: 'TELEMETRY_POSITION_RETENTION_DAYS',
    AssetStatus: 'TELEMETRY_STATUS_RETENTION_DAYS',
    AssetRTT: 'TELEMETRY_RTT_RETENTION_DAYS',
    AssetSearchProgress: 'TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS',
}


class PruneTelemetryTest(TestCase):
    """Telemetry retention keeps table limits and asset timelines aligned."""

    now = datetime(2026, 7, 28, 12, 0, tzinfo=datetime_timezone.utc)

    def setUp(self):
        self.asset = Asset.objects.create(name='Asset One')
        self.now_patch = patch(
            'assets.management.commands.prune_telemetry.timezone.now',
            return_value=self.now,
        )
        self.now_patch.start()
        self.addCleanup(self.now_patch.stop)

    @staticmethod
    def create_telemetry(model, asset, timestamp):
        """Create a minimally populated row for any retained telemetry model."""
        fields = {
            AssetPosition: {'position': Point(172.0, -43.0), 'altitude': 100},
            AssetStatus: {'bat_percent': 75, 'bat_used_mah': 100, 'bat_volt': 12.1},
            AssetRTT: {'rtt': 25},
            AssetSearchProgress: {
                'search': 1,
                'search_progress': 2,
                'search_progress_of': 10,
            },
        }
        return model.objects.create(asset=asset, timestamp=timestamp, **fields[model])

    def run_command(self, **options):
        """Run prune_telemetry and return its stdout."""
        stdout = StringIO()
        call_command('prune_telemetry', stdout=stdout, **options)
        return stdout.getvalue()

    @override_settings(**RETENTION_DISABLED)
    def test_all_unset_retention_limits_disable_pruning(self):
        for model in RETENTION_SETTING_BY_MODEL:
            self.create_telemetry(model, self.asset, self.now - timedelta(days=100))

        output = self.run_command()

        for model in RETENTION_SETTING_BY_MODEL:
            self.assertEqual(model.objects.count(), 1)
        self.assertIn('No telemetry retention limits are configured', output)

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=2,
        TELEMETRY_STATUS_RETENTION_DAYS=4,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=1,
        TELEMETRY_ALIGNED_WINDOW_HOURS=0,
    )
    def test_table_limits_are_independent_and_boundaries_are_retained(self):
        position_boundary = self.create_telemetry(
            AssetPosition, self.asset, self.now - timedelta(days=2)
        )
        self.create_telemetry(
            AssetPosition, self.asset, self.now - timedelta(days=2, microseconds=1)
        )
        status_boundary = self.create_telemetry(
            AssetStatus, self.asset, self.now - timedelta(days=4)
        )
        self.create_telemetry(
            AssetStatus, self.asset, self.now - timedelta(days=4, microseconds=1)
        )
        old_rtt = self.create_telemetry(
            AssetRTT, self.asset, self.now - timedelta(days=100)
        )
        search_boundary = self.create_telemetry(
            AssetSearchProgress, self.asset, self.now - timedelta(days=1)
        )
        self.create_telemetry(
            AssetSearchProgress, self.asset,
            self.now - timedelta(days=1, microseconds=1),
        )

        self.run_command()

        self.assertQuerySetEqual(AssetPosition.objects.all(), [position_boundary])
        self.assertQuerySetEqual(AssetStatus.objects.all(), [status_boundary])
        self.assertQuerySetEqual(AssetRTT.objects.all(), [old_rtt])
        self.assertQuerySetEqual(
            AssetSearchProgress.objects.all(), [search_boundary]
        )

    def test_reference_timestamp_can_come_from_any_telemetry_table(self):
        for reference_model in RETENTION_SETTING_BY_MODEL:
            with self.subTest(reference_model=reference_model.__name__):
                asset = Asset.objects.create(name=f'Reference {reference_model.__name__}')
                old_position = self.create_telemetry(
                    AssetPosition, asset, self.now - timedelta(days=3)
                )
                boundary_position = self.create_telemetry(
                    AssetPosition, asset, self.now - timedelta(days=2)
                )
                self.create_telemetry(reference_model, asset, self.now)
                configured = dict(RETENTION_DISABLED)
                configured.update({
                    'TELEMETRY_POSITION_RETENTION_DAYS': 1,
                    'TELEMETRY_ALIGNED_WINDOW_HOURS': 48,
                })

                with override_settings(**configured):
                    self.run_command()

                self.assertFalse(
                    AssetPosition.objects.filter(pk=old_position.pk).exists()
                )
                self.assertTrue(
                    AssetPosition.objects.filter(pk=boundary_position.pk).exists()
                )

    def test_every_table_uses_the_shared_timestamp_not_its_own_latest_row(self):
        models = tuple(RETENTION_SETTING_BY_MODEL)
        for target_model in models:
            with self.subTest(target_model=target_model.__name__):
                asset = Asset.objects.create(name=f'Target {target_model.__name__}')
                oldest = self.create_telemetry(
                    target_model, asset, self.now - timedelta(days=3)
                )
                own_latest = self.create_telemetry(
                    target_model, asset, self.now - timedelta(hours=36)
                )
                reference_model = next(model for model in models if model != target_model)
                self.create_telemetry(reference_model, asset, self.now)
                configured = dict(RETENTION_DISABLED)
                configured.update({
                    RETENTION_SETTING_BY_MODEL[target_model]: 1,
                    'TELEMETRY_ALIGNED_WINDOW_HOURS': 48,
                })

                with override_settings(**configured):
                    self.run_command()

                self.assertFalse(target_model.objects.filter(pk=oldest.pk).exists())
                self.assertTrue(target_model.objects.filter(pk=own_latest.pk).exists())

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=1,
        TELEMETRY_STATUS_RETENTION_DAYS=None,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=None,
        TELEMETRY_ALIGNED_WINDOW_HOURS=48,
    )
    def test_assets_have_independent_aligned_windows(self):
        fresh_asset = Asset.objects.create(name='Fresh Asset')
        stale_asset = Asset.objects.create(name='Stale Asset')
        fresh_old = self.create_telemetry(
            AssetPosition, fresh_asset, self.now - timedelta(days=3)
        )
        fresh_boundary = self.create_telemetry(
            AssetPosition, fresh_asset, self.now - timedelta(days=2)
        )
        self.create_telemetry(AssetStatus, fresh_asset, self.now)
        stale_old = self.create_telemetry(
            AssetPosition, stale_asset, self.now - timedelta(days=13)
        )
        stale_boundary = self.create_telemetry(
            AssetPosition, stale_asset, self.now - timedelta(days=12)
        )
        self.create_telemetry(AssetStatus, stale_asset, self.now - timedelta(days=10))

        self.run_command()

        self.assertFalse(AssetPosition.objects.filter(pk=fresh_old.pk).exists())
        self.assertTrue(AssetPosition.objects.filter(pk=fresh_boundary.pk).exists())
        self.assertFalse(AssetPosition.objects.filter(pk=stale_old.pk).exists())
        self.assertTrue(AssetPosition.objects.filter(pk=stale_boundary.pk).exists())

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=1,
        TELEMETRY_STATUS_RETENTION_DAYS=None,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=None,
        TELEMETRY_ALIGNED_WINDOW_HOURS=48,
    )
    def test_aligned_window_preserves_rows_older_than_table_limit(self):
        protected = self.create_telemetry(
            AssetPosition, self.asset, self.now - timedelta(hours=36)
        )
        self.create_telemetry(AssetRTT, self.asset, self.now)

        self.run_command()

        self.assertTrue(AssetPosition.objects.filter(pk=protected.pk).exists())

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=1,
        TELEMETRY_STATUS_RETENTION_DAYS=None,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=None,
        TELEMETRY_ALIGNED_WINDOW_HOURS=24,
    )
    def test_empty_enabled_table_is_reported_without_error(self):
        self.create_telemetry(AssetStatus, self.asset, self.now)

        output = self.run_command()

        self.assertIn('position: deleted 0 row(s)', output)

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=1,
        TELEMETRY_STATUS_RETENTION_DAYS=None,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=None,
        TELEMETRY_ALIGNED_WINDOW_HOURS=0,
    )
    def test_deletion_runs_across_multiple_batches(self):
        for offset in range(5):
            self.create_telemetry(
                AssetPosition,
                self.asset,
                self.now - timedelta(days=10, minutes=offset),
            )

        output = self.run_command(batch_size=2)

        self.assertFalse(AssetPosition.objects.exists())
        self.assertIn('position: deleted 5 row(s)', output)

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=1,
        TELEMETRY_STATUS_RETENTION_DAYS=None,
        TELEMETRY_RTT_RETENTION_DAYS=None,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=None,
        TELEMETRY_ALIGNED_WINDOW_HOURS=0,
    )
    def test_dry_run_reports_without_deleting(self):
        row = self.create_telemetry(
            AssetPosition, self.asset, self.now - timedelta(days=10)
        )

        output = self.run_command(dry_run=True, batch_size=1)

        self.assertTrue(AssetPosition.objects.filter(pk=row.pk).exists())
        self.assertIn('position: would delete 1 row(s)', output)
        self.assertIn('Total: would delete 1 telemetry row(s)', output)

    def test_invalid_configuration_is_rejected(self):
        invalid_configurations = (
            {'TELEMETRY_POSITION_RETENTION_DAYS': -1},
            {'TELEMETRY_STATUS_RETENTION_DAYS': 'invalid'},
            {'TELEMETRY_RTT_RETENTION_DAYS': float('inf')},
            {'TELEMETRY_ALIGNED_WINDOW_HOURS': -1},
            {'TELEMETRY_ALIGNED_WINDOW_HOURS': ''},
        )
        for invalid in invalid_configurations:
            with self.subTest(invalid=invalid):
                configured = dict(RETENTION_DISABLED)
                configured.update(invalid)
                with override_settings(**configured):
                    with self.assertRaises(CommandError):
                        self.run_command()

        with override_settings(**RETENTION_DISABLED):
            with self.assertRaisesMessage(CommandError, 'greater than zero'):
                self.run_command(batch_size=0)

    @override_settings(
        TELEMETRY_POSITION_RETENTION_DAYS=0,
        TELEMETRY_STATUS_RETENTION_DAYS=0,
        TELEMETRY_RTT_RETENTION_DAYS=0,
        TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS=0,
        TELEMETRY_ALIGNED_WINDOW_HOURS=0,
    )
    def test_command_and_confirmation_audit_data_is_untouched(self):
        for model in RETENTION_SETTING_BY_MODEL:
            self.create_telemetry(model, self.asset, self.now - timedelta(days=10))
        command = AssetCommand.objects.create(
            asset=self.asset,
            command='RTL',
            timestamp=self.now - timedelta(days=10),
        )
        user = get_user_model().objects.create_user(username='operator')
        confirmation = AssetCommandConfirmation.objects.create(
            user=user,
            asset=self.asset,
            command='TERM',
            expires_at=self.now - timedelta(days=10),
        )

        self.run_command(batch_size=1)

        self.assertTrue(AssetCommand.objects.filter(pk=command.pk).exists())
        self.assertTrue(
            AssetCommandConfirmation.objects.filter(pk=confirmation.pk).exists()
        )
        for model in RETENTION_SETTING_BY_MODEL:
            self.assertFalse(model.objects.exists())
