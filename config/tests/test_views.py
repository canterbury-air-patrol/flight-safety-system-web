"""
Tests for the Config API
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from assets.models import Asset
from config.asset_configs import duplicate_asset_config_response
from config.models import AssetConfig, ServerConfig, SMMConfig


class ConfigViewTest(TestCase):
    """
    Test the Config views
    """
    def setUp(self):
        self.client = Client()
        self.user = get_user_model().objects.create_user(username='testuser', password='testpass')
        self.asset = Asset.objects.create(name='Test Drone')
        self.smm_server = SMMConfig.objects.create(name='SMM Server', address='2.2.2.2', port=9090)
        self.asset_config = AssetConfig.objects.create(asset=self.asset, smm=self.smm_server, smm_login='user', smm_password='pass')
        self.fss_server = ServerConfig.objects.create(name='FSS Server', address='1.1.1.1', client_port=8080)

    def test_config_main_view(self):
        """Test the main configuration page renders correctly."""
        url = reverse('config_main')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'main/main.html')

    def test_config_data_json_unauthenticated(self):
        """Test config_data_json rejects unauthenticated requests."""
        url = reverse('config_data_json')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

    def test_config_data_json(self):
        """Test the configuration data JSON endpoint."""
        self.client.force_login(self.user)
        url = reverse('config_data_json')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(len(data['fss_servers']), 1)
        self.assertEqual(data['fss_servers'][0]['name'], 'FSS Server')
        self.assertEqual(len(data['smm_servers']), 1)
        self.assertEqual(data['smm_servers'][0]['name'], 'SMM Server')
        self.assertEqual(len(data['assets']), 1)
        self.assertEqual(data['assets'][0]['name'], 'Test Drone')
        self.assertEqual(data['assets'][0]['smm_name'], 'SMM Server')

    def test_config_data_json_hides_retired_assets(self):
        """Retired identities are not offered as active configuration targets."""
        self.asset.retired_at = timezone.now()
        self.asset.save(update_fields=['retired_at'])
        self.client.force_login(self.user)

        response = self.client.get(reverse('config_data_json'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['assets'], [])

    def test_config_data_json_asset_without_config(self):
        """An asset with no AssetConfig reports null SMM fields rather than erroring."""
        unconfigured = Asset.objects.create(name='Unconfigured Drone')
        self.client.force_login(self.user)
        url = reverse('config_data_json')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()

        assets_by_name = {a['name']: a for a in data['assets']}
        self.assertIn('Unconfigured Drone', assets_by_name)
        entry = assets_by_name['Unconfigured Drone']
        self.assertEqual(entry['pk'], unconfigured.pk)
        self.assertIsNone(entry['smm_name'])
        self.assertIsNone(entry['smm_login'])

    def test_multiple_assets_can_share_smm_config(self):
        """The one-to-one asset link does not make the SMM server exclusive."""
        other_asset = Asset.objects.create(name='Other configured drone')
        other_config = AssetConfig.objects.create(
            asset=other_asset,
            smm=self.smm_server,
            smm_login='other-user',
            smm_password='other-password',
        )

        self.assertEqual(self.asset_config.smm, other_config.smm)
        self.assertEqual(self.smm_server.assetconfig_set.count(), 2)

    def test_config_data_json_reports_duplicate_asset_configs(self):
        """Legacy conflicting rows are reported instead of silently collapsed."""
        self.client.force_login(self.user)

        error = duplicate_asset_config_response([self.asset.pk])
        with patch('config.views.active_assets_with_configs', return_value=(None, error)):
            response = self.client.get(reverse('config_data_json'))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['duplicate_asset_ids'], [self.asset.pk])
        self.assertNotContains(response, 'pass', status_code=409)
        self.assertNotContains(response, 'secret', status_code=409)
