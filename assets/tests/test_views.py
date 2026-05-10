"""
Tests for the Asset API
"""
from django.test import Client, TestCase
from django.urls import reverse

from assets.models import Asset, AssetCommand


class AssetAPITest(TestCase):
    """
    Test the Asset API
    """
    def setUp(self):
        self.client = Client()
        self.asset = Asset.objects.create(name='Test Drone')

    def test_asset_command_set_rtl(self):
        """Test setting RTL command."""
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.post(url, {'command': 'RTL'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), 'Created')

        # Verify command was created
        cmd = AssetCommand.objects.filter(asset=self.asset).latest('timestamp')
        self.assertEqual(cmd.command, 'RTL')

    def test_asset_command_set_goto(self):
        """Test setting GOTO command with coordinates."""
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.post(url, {
            'command': 'GOTO',
            'latitude': -43.0,
            'longitude': 172.0
        })
        self.assertEqual(response.status_code, 200)

        cmd = AssetCommand.objects.filter(asset=self.asset).latest('timestamp')
        self.assertEqual(cmd.command, 'GOTO')
        self.assertEqual(cmd.position.y, -43.0)
        self.assertEqual(cmd.position.x, 172.0)

    def test_asset_add(self):
        """Test adding a new asset."""
        url = reverse('asset_add')
        response = self.client.post(url, {'asset_name': 'New Drone'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), 'Created')

        self.assertTrue(Asset.objects.filter(name='New Drone').exists())

    def test_asset_add_duplicate(self):
        """Test adding a duplicate asset."""
        url = reverse('asset_add')
        response = self.client.post(url, {'asset_name': 'Test Drone'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.content.decode(), 'Asset already exists')
