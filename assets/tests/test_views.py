"""
Tests for the Asset API
"""
from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.urls import reverse

from assets.models import Asset, AssetCommand, AssetRTT
from assets.views import RTT_SAMPLE_LIMIT


class AssetAPITest(TestCase):
    """
    Test the Asset API
    """
    def setUp(self):
        self.client = Client()
        self.asset = Asset.objects.create(name='Test Drone')
        self.user = get_user_model().objects.create_user(username='testuser', password='testpass')

    def test_asset_command_set_unauthenticated(self):
        """Test that unauthenticated command attempts are rejected."""
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.post(url, {'command': 'RTL'})
        self.assertEqual(response.status_code, 403)

    def test_asset_add_unauthenticated(self):
        """Test that unauthenticated asset-add attempts are rejected."""
        url = reverse('asset_add')
        response = self.client.post(url, {'asset_name': 'New Drone'})
        self.assertEqual(response.status_code, 403)

    def test_asset_command_set_rtl(self):
        """Test setting RTL command."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.post(url, {'command': 'RTL'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), 'Created')

        cmd = AssetCommand.objects.filter(asset=self.asset).latest('timestamp')
        self.assertEqual(cmd.command, 'RTL')

    def test_asset_command_set_goto(self):
        """Test setting GOTO command with coordinates."""
        self.client.force_login(self.user)
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
        self.client.force_login(self.user)
        url = reverse('asset_add')
        response = self.client.post(url, {'asset_name': 'New Drone'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), 'Created')
        self.assertTrue(Asset.objects.filter(name='New Drone').exists())

    def test_asset_add_duplicate(self):
        """Test adding a duplicate asset."""
        self.client.force_login(self.user)
        url = reverse('asset_add')
        response = self.client.post(url, {'asset_name': 'Test Drone'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.content.decode(), 'Asset already exists')

    def test_asset_command_set_invalid_altitude(self):
        """Test setting an invalid altitude."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})

        response = self.client.post(url, {'command': 'ALT', 'altitude': 1001})
        self.assertEqual(response.status_code, 400)

        response = self.client.post(url, {'command': 'ALT', 'altitude': -1})
        self.assertEqual(response.status_code, 400)

        response = self.client.post(url, {'command': 'ALT', 'altitude': 'high'})
        self.assertEqual(response.status_code, 400)

    def test_asset_command_set_invalid_coordinates(self):
        """Test setting invalid coordinates for GOTO."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})

        response = self.client.post(url, {
            'command': 'GOTO',
            'latitude': 'invalid',
            'longitude': 172.0
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content.decode(), 'Invalid Lat/Long')

    def test_asset_command_set_missing_params(self):
        """Test setting commands with missing required parameters."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})

        response = self.client.post(url, {'command': 'GOTO', 'latitude': -43.0})
        self.assertEqual(response.status_code, 400)

        response = self.client.post(url, {'command': 'ALT'})
        self.assertEqual(response.status_code, 400)

    def test_asset_status_json_unauthenticated(self):
        """Test asset_status_json rejects unauthenticated requests."""
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

    def test_asset_status_json_success(self):
        """Test asset_status_json for a valid asset."""
        self.client.force_login(self.user)
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['asset']['name'], 'Test Drone')

    def test_asset_status_json_not_found(self):
        """Test asset_status_json for a non-existent asset."""
        self.client.force_login(self.user)
        url = reverse('asset_status_json', kwargs={'asset_id': 99999})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_asset_status_no_data(self):
        """Test an asset with no status/position/rtt data."""
        self.client.force_login(self.user)
        asset = Asset.objects.create(name='Empty Drone')
        url = reverse('asset_status_json', kwargs={'asset_id': asset.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['asset']['name'], 'Empty Drone')
        self.assertNotIn('position', data)
        self.assertNotIn('status', data)
        self.assertNotIn('rtt', data)

    def test_rtt_sample_limit(self):
        """Test that RTT calculation only uses the latest RTT_SAMPLE_LIMIT samples."""
        self.client.force_login(self.user)
        total_samples = RTT_SAMPLE_LIMIT + 5
        for i in range(1, total_samples + 1):
            AssetRTT.objects.create(asset=self.asset, rtt=i)

        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()

        rtt_data = data['rtt']
        self.assertEqual(rtt_data['rtt_max'], total_samples)
        self.assertEqual(rtt_data['rtt_min'], total_samples - RTT_SAMPLE_LIMIT + 1)

    def test_asset_add_get_rejected(self):
        """Test that authenticated GET request to asset_add is rejected."""
        self.client.force_login(self.user)
        url = reverse('asset_add')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content.decode(), 'Only POST is supported')

    def test_asset_command_set_get_rejected(self):
        """Test that authenticated GET request to asset_command_set is rejected."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content.decode(), 'Only POST is supported')

    def test_assets_main(self):
        """Test assets_main view serves React SPA."""
        url = reverse('assets_main')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'main/main.html')
