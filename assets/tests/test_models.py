"""Tests for asset lifecycle and audit relationships."""

# pylint: disable=missing-function-docstring

import uuid

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from django.utils import timezone

from assets.models import Asset, AssetCommand, AssetCommandAck, AssetPosition


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

    def test_deleting_issuer_preserves_command(self):
        asset = Asset.objects.create(name='Issuer deletion')
        user = get_user_model().objects.create_user(username='former-operator')
        command = AssetCommand.objects.create(asset=asset, command='TERM', issued_by=user)

        user.delete()

        command.refresh_from_db()
        self.assertIsNone(command.issued_by)

    def test_operation_id_is_unique_but_legacy_nulls_are_allowed(self):
        asset = Asset.objects.create(name='Operation identity')
        operation_id = uuid.uuid4()
        AssetCommand.objects.create(
            asset=asset, command='RTL', operation_id=operation_id,
        )
        AssetCommand.objects.create(asset=asset, command='HOLD')
        AssetCommand.objects.create(asset=asset, command='RON')

        with self.assertRaises(IntegrityError), transaction.atomic():
            AssetCommand.objects.create(
                asset=asset, command='MAN', operation_id=operation_id,
            )


class AssetPositionGPSFixTest(TestCase):
    """Position rows distinguish GPS fixes from untrusted estimates."""

    def setUp(self):
        self.asset = Asset.objects.create(name='Position asset')

    def test_database_default_keeps_legacy_writer_positions_valid(self):
        """A raw insert that omits gps_fix_valid remains deploy-compatible."""
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO assets_assetposition '
                '(asset_id, timestamp, position, altitude) '
                'VALUES (%s, %s, NULL, %s)',
                [self.asset.pk, timezone.now(), 100],
            )

        position = AssetPosition.objects.get(asset=self.asset)
        self.assertTrue(position.gps_fix_valid)

    def test_no_fix_report_can_omit_position_estimate(self):
        position = AssetPosition.objects.create(
            asset=self.asset,
            position=None,
            altitude=100,
            gps_fix_valid=False,
        )

        self.assertIsNone(position.position)
        self.assertFalse(position.gps_fix_valid)


class AssetCommandAckTest(TestCase):
    """Every accepted acknowledgement has its own ordered history row."""

    def setUp(self):
        asset = Asset.objects.create(name='Ack asset')
        self.command = AssetCommand.objects.create(asset=asset, command='RTL')

    def create_ack(self, dispatch_id, state, timestamp, reason=0):
        return AssetCommandAck.objects.create(
            command=self.command,
            dispatch_id=dispatch_id,
            ack_state=state,
            ack_timestamp=timestamp,
            ack_superseded_by=reason,
        )

    def test_two_phase_and_redelivery_acks_are_retained_in_arrival_order(self):
        received = self.create_ack(10, AssetCommand.ACK_RECEIVED, 1_700_000_000_000)
        actioned = self.create_ack(10, AssetCommand.ACK_ACTIONED, 1_700_000_000_100)
        redelivered = self.create_ack(11, AssetCommand.ACK_NOOP, 1_700_000_100_000)

        self.assertQuerySetEqual(
            self.command.ack_history.all(),
            [received, actioned, redelivered],
        )
        self.assertTrue(all(ack.received_at is not None for ack in (received, actioned, redelivered)))

    def test_concrete_supersede_reason_requires_superseded_state(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.create_ack(
                10,
                AssetCommand.ACK_ACTIONED,
                1_700_000_000_000,
                AssetCommand.SUPERSEDE_LOW_BATTERY,
            )

    def test_deleting_command_cascades_ack_history(self):
        ack = self.create_ack(10, AssetCommand.ACK_ACTIONED, 1_700_000_000_000)

        self.command.delete()

        self.assertFalse(AssetCommandAck.objects.filter(pk=ack.pk).exists())
