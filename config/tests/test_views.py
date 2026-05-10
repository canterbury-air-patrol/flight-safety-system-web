"""
Tests for the Config API
"""
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
        self.asset = Asset.objects.create(name='Test Drone')
        self.smm_server = SMMConfig.objects.create(name='SMM Server', address='2.2.2.2', port=9090)
        self.asset_config = AssetConfig.objects.create(asset=self.asset, smm=self.smm_server, smm_login='user', smm_password='pass')
        self.fss_server = ServerConfig.objects.create(name='FSS Server', address='1.1.1.1', client_port=8080)

    def test_config_main_view(self):
        """Test the main configuration page renders correctly."""
        url = reverse('config_main')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'config/main.html')

        # Verify context data
        self.assertIn(self.asset, response.context['Assets'])
        self.assertIn(self.fss_server, response.context['FSSservers'])
        self.assertIn(self.smm_server, response.context['SMMservers'])

        # Verify asset config attachment
        asset_in_context = next(a for a in response.context['Assets'] if a.id == self.asset.id)
        self.assertEqual(asset_in_context.config, self.asset_config)
