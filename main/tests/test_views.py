"""
Test the main API
"""
from django.test import Client, TestCase
from django.urls import reverse


class StatusAPITest(TestCase):
    """
    Test the API
    """
    def setUp(self):
        self.client = Client()

    def test_all_status_data_unauthenticated(self):
        """Test the all_status_data endpoint when not logged in."""
        url = reverse('all_status_data')
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNone(data['currentUser'])
        self.assertEqual(data['servers'], [])
        self.assertEqual(data['assets'], [])
