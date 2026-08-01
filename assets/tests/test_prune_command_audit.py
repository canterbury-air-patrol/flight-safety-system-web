"""Tests for command and acknowledgement audit retention."""

# pylint: disable=missing-function-docstring

from datetime import datetime, timedelta
from datetime import timezone as datetime_timezone
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from assets.models import Asset, AssetCommand, AssetCommandAck


class PruneCommandAuditTest(TestCase):
    """Commands and acknowledgements are retained and pruned as audit units."""

    now = datetime(2026, 8, 1, 12, 0, tzinfo=datetime_timezone.utc)

    def setUp(self):
        self.asset = Asset.objects.create(name='Audit asset')
        now_patch = patch(
            'assets.management.commands.prune_command_audit.timezone.now',
            return_value=self.now,
        )
        now_patch.start()
        self.addCleanup(now_patch.stop)

    @staticmethod
    def create_ack(command, received_at):
        ack = AssetCommandAck.objects.create(
            command=command,
            dispatch_id=1,
            ack_state=AssetCommand.ACK_ACTIONED,
            ack_timestamp=1_700_000_000_000,
            ack_superseded_by=AssetCommand.SUPERSEDE_NONE,
        )
        AssetCommandAck.objects.filter(pk=ack.pk).update(received_at=received_at)
        ack.refresh_from_db()
        return ack

    @staticmethod
    def run_command(**options):
        stdout = StringIO()
        call_command('prune_command_audit', stdout=stdout, **options)
        return stdout.getvalue()

    @override_settings(COMMAND_AUDIT_RETENTION_DAYS=None)
    def test_unset_retention_disables_pruning(self):
        command = AssetCommand.objects.create(
            asset=self.asset,
            command='RTL',
            timestamp=self.now - timedelta(days=100),
        )

        output = self.run_command()

        self.assertTrue(AssetCommand.objects.filter(pk=command.pk).exists())
        self.assertIn('not configured', output)

    @override_settings(COMMAND_AUDIT_RETENTION_DAYS=30)
    def test_old_command_and_acks_are_deleted_as_one_unit(self):
        old = AssetCommand.objects.create(
            asset=self.asset,
            command='HOLD',
            timestamp=self.now - timedelta(days=40),
        )
        ack = self.create_ack(old, self.now - timedelta(days=39))
        newest = AssetCommand.objects.create(
            asset=self.asset,
            command='RTL',
            timestamp=self.now - timedelta(days=1),
        )

        output = self.run_command()

        self.assertFalse(AssetCommand.objects.filter(pk=old.pk).exists())
        self.assertFalse(AssetCommandAck.objects.filter(pk=ack.pk).exists())
        self.assertTrue(AssetCommand.objects.filter(pk=newest.pk).exists())
        self.assertIn('commands: deleted 1 row(s)', output)
        self.assertIn('acknowledgements: deleted 1 row(s)', output)

    @override_settings(COMMAND_AUDIT_RETENTION_DAYS=30)
    def test_newest_command_is_always_preserved(self):
        newest = AssetCommand.objects.create(
            asset=self.asset,
            command='TERM',
            timestamp=self.now - timedelta(days=100),
        )
        self.create_ack(newest, self.now - timedelta(days=99))

        self.run_command()

        self.assertTrue(AssetCommand.objects.filter(pk=newest.pk).exists())
        self.assertEqual(newest.ack_history.count(), 1)

    @override_settings(COMMAND_AUDIT_RETENTION_DAYS=30)
    def test_recent_or_boundary_ack_preserves_old_command(self):
        boundary = self.now - timedelta(days=30)
        commands = []
        for offset, received_at in enumerate((boundary, boundary + timedelta(seconds=1))):
            command = AssetCommand.objects.create(
                asset=self.asset,
                command='HOLD',
                timestamp=self.now - timedelta(days=100 - offset),
            )
            self.create_ack(command, received_at)
            commands.append(command)
        AssetCommand.objects.create(asset=self.asset, command='RTL', timestamp=self.now)

        self.run_command()

        self.assertTrue(all(AssetCommand.objects.filter(pk=command.pk).exists() for command in commands))

    @override_settings(COMMAND_AUDIT_RETENTION_DAYS=30)
    def test_dry_run_and_batching(self):
        old_commands = [
            AssetCommand.objects.create(
                asset=self.asset,
                command='HOLD',
                timestamp=self.now - timedelta(days=60 - offset),
            )
            for offset in range(3)
        ]
        for command in old_commands:
            self.create_ack(command, self.now - timedelta(days=50))
        newest = AssetCommand.objects.create(asset=self.asset, command='RTL', timestamp=self.now)

        dry_run_output = self.run_command(dry_run=True, batch_size=1)
        self.assertEqual(AssetCommand.objects.count(), 4)
        self.assertIn('commands: would delete 3 row(s)', dry_run_output)

        self.run_command(batch_size=1)
        self.assertQuerySetEqual(AssetCommand.objects.all(), [newest], ordered=False)
        self.assertFalse(AssetCommandAck.objects.exists())

    def test_invalid_configuration_is_rejected(self):
        for value in (-1, 'invalid', float('inf')):
            with self.subTest(value=value), override_settings(COMMAND_AUDIT_RETENTION_DAYS=value):
                with self.assertRaises(CommandError):
                    self.run_command()
        with override_settings(COMMAND_AUDIT_RETENTION_DAYS=1):
            with self.assertRaisesMessage(CommandError, 'greater than zero'):
                self.run_command(batch_size=0)
