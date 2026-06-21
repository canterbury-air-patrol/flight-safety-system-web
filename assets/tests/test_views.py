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
        self.assertEqual(response.content.decode(), 'Queued')

        cmd = AssetCommand.objects.filter(asset=self.asset).latest('timestamp')
        self.assertEqual(cmd.command, 'RTL')
        self.assertEqual(cmd.issued_by, self.user)

    def test_asset_command_records_issuer(self):
        """The issuing user is recorded on the command and surfaced in the API."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        self.client.post(url, {'command': 'TERM'})

        cmd = AssetCommand.objects.filter(asset=self.asset).latest('timestamp')
        self.assertEqual(cmd.issued_by, self.user)

        status_url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        data = self.client.get(status_url).json()
        self.assertEqual(data['command']['issued_by'], 'testuser')

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

    def test_asset_command_set_invalid_command(self):
        """Test that an unrecognised command is rejected."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})
        response = self.client.post(url, {'command': 'SELFDESTRUCT'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content.decode(), 'Invalid command')

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

    def test_asset_command_set_out_of_range_coordinates(self):
        """Test that out-of-range lat/lng values are rejected."""
        self.client.force_login(self.user)
        url = reverse('asset_command_set', kwargs={'asset_id': self.asset.pk})

        response = self.client.post(url, {'command': 'GOTO', 'latitude': 91.0, 'longitude': 172.0})
        self.assertEqual(response.status_code, 400)

        response = self.client.post(url, {'command': 'GOTO', 'latitude': -43.0, 'longitude': 181.0})
        self.assertEqual(response.status_code, 400)

        response = self.client.post(url, {'command': 'GOTO', 'latitude': -43.0, 'longitude': 172.0})
        self.assertEqual(response.status_code, 200)

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

    def test_asset_status_json_command_code(self):
        """Test that asset_status_json includes command_code alongside the display string."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(asset=self.asset, command='RTL')
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['command_code'], 'RTL')
        self.assertEqual(data['command']['command'], 'Return to Launch')

    def test_asset_status_json_ack_pending(self):
        """A dispatched-but-unacked command reports ack_state 'pending'."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(asset=self.asset, command='RTL')
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['ack_state'], 'pending')
        self.assertNotIn('ack_timestamp', data['command'])

    def test_asset_status_json_ack_actioned(self):
        """An actioned ack is surfaced with its code, label and timestamp."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(
            asset=self.asset, command='RTL',
            ack_state=AssetCommand.ACK_ACTIONED, ack_timestamp=1700000000000,
        )
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['ack_state'], 'actioned')
        self.assertEqual(data['command']['ack_state_display'], 'Actioned')
        self.assertEqual(data['command']['ack_timestamp'], 1700000000000)

    def test_asset_status_json_ack_superseded(self):
        """A superseded ack carries the supersede reason as a code string."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(
            asset=self.asset, command='MAN',
            ack_state=AssetCommand.ACK_SUPERSEDED,
            ack_superseded_by=AssetCommand.SUPERSEDE_LOW_BATTERY,
        )
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['ack_state'], 'superseded')
        self.assertEqual(data['command']['ack_superseded_by'], 'low_battery')

    def test_asset_status_json_ack_superseded_newer_command(self):
        """A command superseded by a newer command reports that reason code."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(
            asset=self.asset, command='MAN',
            ack_state=AssetCommand.ACK_SUPERSEDED,
            ack_superseded_by=AssetCommand.SUPERSEDE_NEWER_COMMAND,
        )
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['ack_state'], 'superseded')
        self.assertEqual(data['command']['ack_superseded_by'], 'newer_command')

    def test_asset_status_json_ack_noop(self):
        """A noop ack (already-current state) reports ack_state 'noop'."""
        self.client.force_login(self.user)
        AssetCommand.objects.create(
            asset=self.asset, command='RTL', ack_state=AssetCommand.ACK_NOOP,
        )
        url = reverse('asset_status_json', kwargs={'asset_id': self.asset.pk})
        response = self.client.get(url)
        data = response.json()
        self.assertEqual(data['command']['ack_state'], 'noop')
        self.assertEqual(data['command']['ack_state_display'], 'No change')

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
