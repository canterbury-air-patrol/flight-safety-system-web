"""Migration tests for enforcing AssetConfig cardinality."""

# pylint: disable=missing-function-docstring

import importlib

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class AssetConfigCardinalityMigrationTest(TransactionTestCase):
    """The migration refuses ambiguous credentials before adding uniqueness."""

    migrate_from = [('config', '0001_initial')]
    migrate_to = [('config', '0002_assetconfig_one_per_asset')]

    def setUp(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        self.old_apps = self.executor.loader.project_state(self.migrate_from).apps

    def tearDown(self):
        self.old_apps.get_model('config', 'AssetConfig').objects.all().delete()
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())
        super().tearDown()

    def create_fixture(self):
        asset = self.old_apps.get_model('assets', 'Asset').objects.create(name='Migration asset')
        smm = self.old_apps.get_model('config', 'SMMConfig').objects.create(
            name='Migration SMM',
            address='smm.example',
        )
        return asset, smm, self.old_apps.get_model('config', 'AssetConfig')

    def test_precheck_lists_ids_without_credentials(self):
        asset, smm, asset_config = self.create_fixture()
        asset_config.objects.create(asset=asset, smm=smm, smm_login='one', smm_password='first-secret')
        asset_config.objects.create(asset=asset, smm=smm, smm_login='two', smm_password='second-secret')
        migration = importlib.import_module('config.migrations.0002_assetconfig_one_per_asset')

        with self.assertRaises(RuntimeError) as raised:
            migration.require_unique_asset_configs(self.old_apps, None)

        self.assertIn(str(asset.pk), str(raised.exception))
        self.assertNotIn('one', str(raised.exception))
        self.assertNotIn('two', str(raised.exception))
        self.assertNotIn('secret', str(raised.exception))
        asset_config.objects.all().delete()

    def test_clean_migration_enforces_one_optional_config(self):
        asset, smm, asset_config = self.create_fixture()
        asset_config.objects.create(asset=asset, smm=smm, smm_login='one', smm_password='secret')

        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_to)
        current_apps = self.executor.loader.project_state(self.migrate_to).apps
        current_asset_config = current_apps.get_model('config', 'AssetConfig')
        with self.assertRaises(IntegrityError), transaction.atomic():
            current_asset_config.objects.create(
                asset_id=asset.pk,
                smm_id=smm.pk,
                smm_login='two',
                smm_password='other',
            )
