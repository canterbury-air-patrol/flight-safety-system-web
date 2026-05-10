"""
Test the main API
"""
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.test import Client, TestCase
from django.urls import reverse

from assets.models import Asset, AssetCommand, AssetPosition, AssetRTT, AssetStatus
from config.models import ServerConfig


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
        """Test the all_status_data endpoint when not logged in."""
        url = reverse('all_status_data')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNone(data['currentUser'])
        self.assertEqual(len(data['servers']), 1)
        self.assertEqual(data['servers'][0]['name'], 'Test Server')
        self.assertEqual(len(data['assets']), 1)
        self.assertEqual(data['assets'][0]['asset']['name'], 'Test Drone')

    def test_all_status_data_authenticated(self):
        """Test the all_status_data endpoint when logged in."""
        self.client.login(username='testuser', password='password')
        url = reverse('all_status_data')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['currentUser'], 'testuser')

    def test_all_status_data_with_details(self):
        """Test with position and status data."""
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
        AssetCommand.objects.create(asset=self.asset, command='ALT', altitude=0)

        url = reverse('all_status_data')
        response = self.client.get(url)
        data = response.json()

        cmd_data = data['assets'][0]['command']
        self.assertEqual(cmd_data['command'], 'Adjust Altitude')
        self.assertEqual(cmd_data['alt'], 0)

    def test_current_user_unauthenticated(self):
        """Test current_user when not logged in."""
        url = reverse('current_user')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['currentUser'])

    def test_current_user_authenticated(self):
        """Test current_user when logged in."""
        self.client.login(username='testuser', password='password')
        url = reverse('current_user')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['currentUser'], 'testuser')

    def test_login_page_get(self):
        """Test login page GET request."""
        url = reverse('login_page')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, 'main/login_page.html')

    def test_login_page_post_success(self):
        """Test successful login via POST."""
        url = reverse('login_page')
        response = self.client.post(url, {'username': 'testuser', 'password': 'password'})
        self.assertRedirects(response, '/')
