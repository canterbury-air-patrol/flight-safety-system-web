"""
Tests for the Config API
"""
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from assets.models import Asset
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
