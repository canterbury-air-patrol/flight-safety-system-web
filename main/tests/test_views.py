"""
Test the main API
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from assets.models import Asset, AssetCommand, AssetPosition, AssetRTT, AssetStatus
from config.asset_configs import duplicate_asset_config_response
from config.models import AssetConfig, ServerConfig, SMMConfig
from fss.satisfies import satisfies


class StatusAPITest(TestCase):
    """
    Test the API
    """
    def setUp(self):
        self.client = Client()
        self.user = get_user_model().objects.create_user(username='testuser', password='password')
        self.asset = Asset.objects.create(name='Test Drone')
        self.server = ServerConfig.objects.create(name='Test Server', address='1.2.3.4', client_port=8080, active=True)

    def test_all_status_data_unauthenticated(self):
        """Test the all_status_data endpoint rejects unauthenticated requests."""
        url = reverse('all_status_data')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

    @satisfies('TC-WEB-005')
    def test_all_status_data_authenticated(self):
        """Test the all_status_data endpoint when logged in."""
        self.client.login(username='testuser', password='password')
        url = reverse('all_status_data')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['currentUser'], 'testuser')
        self.assertEqual(len(data['servers']), 1)
        self.assertEqual(data['servers'][0]['name'], 'Test Server')
        self.assertEqual(len(data['assets']), 1)
        self.assertEqual(data['assets'][0]['asset']['name'], 'Test Drone')
        self.assertIn('csrfToken', data)

    def test_retired_asset_is_hidden_from_active_endpoints(self):
        """Retired identities leave status and asset-list responses."""
        self.asset.retired_at = timezone.now()
        self.asset.save(update_fields=['retired_at'])
        self.client.force_login(self.user)

        status_response = self.client.get(reverse('all_status_data'))
        list_response = self.client.get(reverse('asset_list'))

        self.assertEqual(status_response.json()['assets'], [])
        self.assertEqual(list_response.json()['assets'], [])

    def test_all_status_data_server_now(self):
        """The status response carries the server's current time (epoch-ms)."""
        self.client.login(username='testuser', password='password')
        url = reverse('all_status_data')
        before = int(timezone.now().timestamp() * 1000)
        response = self.client.get(url)
        after = int(timezone.now().timestamp() * 1000)
        data = response.json()
        self.assertIn('server_now', data)
        self.assertIsInstance(data['server_now'], int)
        self.assertGreaterEqual(data['server_now'], before)
        self.assertLessEqual(data['server_now'], after)

    def test_all_status_data_with_no_asset_data_still_has_server_now(self):
        """
        An asset with no position/status/search/command data yet must still
        carry server_now, so the frontend's clock-skew-safe aging (which keys
        entirely off this field) never silently disables itself because a
        no-data asset happened to omit it (TEST-02).
        """
        self.client.login(username='testuser', password='password')
        url = reverse('all_status_data')
        response = self.client.get(url)
        data = response.json()

        asset_data = data['assets'][0]
        self.assertNotIn('position', asset_data)
        self.assertNotIn('status', asset_data)
        self.assertNotIn('search', asset_data)
        self.assertNotIn('command', asset_data)
        self.assertIn('server_now', data)
        self.assertIsInstance(data['server_now'], int)

    def test_all_status_data_with_details(self):
        """Test with position and status data."""
        self.client.login(username='testuser', password='password')
        AssetPosition.objects.create(asset=self.asset, position=Point(172.0, -43.0), altitude=100)
        AssetStatus.objects.create(asset=self.asset, bat_percent=85, bat_used_mah=500, bat_volt=11.1)
        AssetRTT.objects.create(asset=self.asset, rtt=50)

        url = reverse('all_status_data')
        response = self.client.get(url)
        data = response.json()

        asset_data = data['assets'][0]
        self.assertEqual(asset_data['position']['alt'], 100)
        self.assertEqual(asset_data['status']['battery_percent'], 85)
        self.assertEqual(asset_data['rtt']['rtt'], 50)

    def test_all_status_data_with_altitude_zero(self):
        """Test that altitude 0 is correctly included in command data (Regression for DJANGO-01)."""
        self.client.login(username='testuser', password='password')
        AssetCommand.objects.create(asset=self.asset, command='ALT', altitude=0)

        url = reverse('all_status_data')
        response = self.client.get(url)
        data = response.json()

        cmd_data = data['assets'][0]['command']
        self.assertEqual(cmd_data['command'], 'Adjust Altitude')
        self.assertEqual(cmd_data['alt'], 0)

    def test_all_status_data_with_null_battery_voltage(self):
        """A null bat_volt passes through as null rather than an ambiguous value."""
        self.client.login(username='testuser', password='password')
        AssetStatus.objects.create(asset=self.asset, bat_percent=85, bat_used_mah=500, bat_volt=None)

        url = reverse('all_status_data')
        response = self.client.get(url)
        data = response.json()

        self.assertIsNone(data['assets'][0]['status']['battery_voltage'])

    def test_legacy_api_endpoints_are_removed(self):
        """Legacy endpoints stay outside the authenticated API surface."""
        self.client.login(username='testuser', password='password')
        for path in ('/servers.json', '/current_user/', f'/assets/{self.asset.pk}/status.json'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 404)

    def test_asset_list_unauthenticated(self):
        """Test asset_list rejects unauthenticated requests."""
        url = reverse('asset_list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)

    @satisfies('TC-WEB-002')
    def test_asset_list_authenticated(self):
        """Test asset_list returns data when logged in."""
        self.client.login(username='testuser', password='password')
        url = reverse('asset_list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['assets']), 1)
        entry = data['assets'][0]
        self.assertEqual(entry['name'], 'Test Drone')
        # No AssetConfig for this asset, so SMM fields are null.
        self.assertIsNone(entry['smm_name'])
        self.assertIsNone(entry['smm_login'])

    def test_asset_list_includes_smm_config(self):
        """asset_list surfaces SMM name/login when an AssetConfig exists."""
        smm = SMMConfig.objects.create(name='SMM Server', address='2.2.2.2', port=9090)
        AssetConfig.objects.create(asset=self.asset, smm=smm, smm_login='operator', smm_password='secret')
        self.client.login(username='testuser', password='password')
        url = reverse('asset_list')
        response = self.client.get(url)
        entry = response.json()['assets'][0]
        self.assertEqual(entry['smm_name'], 'SMM Server')
        self.assertEqual(entry['smm_login'], 'operator')

    def test_asset_list_reports_duplicate_asset_configs(self):
        """Legacy conflicting rows produce an explicit configuration error."""
        self.client.force_login(self.user)

        error = duplicate_asset_config_response([self.asset.pk])
        with patch('main.views.active_assets_with_configs', return_value=(None, error)):
            response = self.client.get(reverse('asset_list'))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['duplicate_asset_ids'], [self.asset.pk])
        self.assertNotContains(response, 'secret', status_code=409)

    def test_main_view(self):
        """The landing page serves the React SPA and sets the CSRF cookie."""
        url = reverse('main_view')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'main/main.html')
        self.assertIn('csrftoken', response.cookies)

    def test_login_page_get(self):
        """Test login page GET request."""
        url = reverse('login_page')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'main/main.html')

    def test_login_page_post_success(self):
        """Test successful login via POST."""
        url = reverse('login_page')
        response = self.client.post(url, {'username': 'testuser', 'password': 'password'})
        self.assertRedirects(response, '/')

    def test_login_page_post_missing_credentials(self):
        """A POST with no credentials fails cleanly rather than 500ing."""
        url = reverse('login_page')
        response = self.client.post(url, {})
        self.assertRedirects(response, '/login/?error=1', target_status_code=200)
