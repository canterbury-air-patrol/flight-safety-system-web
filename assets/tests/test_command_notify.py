"""
PostgreSQL integration coverage for asset-command insertion notifications.
"""

from unittest import skipUnless

import psycopg
from django.db import connection
from django.test import TransactionTestCase

from assets.models import Asset, AssetCommand


@skipUnless(connection.vendor == "postgresql", "PostgreSQL-specific integration test")
class AssetCommandNotifyTest(TransactionTestCase):
    """The database wakes the FSS server only for newly queued commands."""

    def test_insert_notifies_asset_id_and_update_does_not(self):
        """INSERT publishes the asset id; server-owned UPDATE fields stay quiet."""
        asset = Asset.objects.create(name="Notify Test Asset")

        with psycopg.connect(
            **connection.get_connection_params(),
            autocommit=True,
        ) as listener:
            listener.execute("LISTEN fss_command")

            command = AssetCommand.objects.create(asset=asset, command="RTL")
            notifications = list(listener.notifies(timeout=1, stop_after=1))

            self.assertEqual(len(notifications), 1)
            self.assertEqual(notifications[0].channel, "fss_command")
            self.assertEqual(notifications[0].payload, str(asset.pk))

            AssetCommand.objects.filter(pk=command.pk).update(dispatch_id=1)
            self.assertEqual(
                list(listener.notifies(timeout=0.1, stop_after=1)),
                [],
            )

    def test_trigger_is_after_insert_for_each_row(self):
        """Catalog metadata pins the trigger to AFTER INSERT for each row."""
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT pg_trigger.tgtype
                FROM pg_trigger
                JOIN pg_class ON pg_class.oid = pg_trigger.tgrelid
                WHERE pg_trigger.tgname = 'fss_assetcommand_notify'
                  AND pg_class.relname = 'assets_assetcommand'
                  AND NOT pg_trigger.tgisinternal
                """
            )
            trigger_types = cursor.fetchall()

        # PostgreSQL tgtype bits: ROW (1) | INSERT (4), with BEFORE unset.
        self.assertEqual(trigger_types, [(5,)])
