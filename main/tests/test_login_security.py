"""
Tests for failed-login throttling.
"""

from datetime import timedelta

from axes.models import AccessAttempt, AccessAttemptExpiration
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone


@override_settings(AXES_ENABLED=True)
class LoginRateLimitTest(TestCase):
    """
    Repeated failures temporarily block a submitted username on this server.
    """

    def setUp(self):
        self.url = reverse('login_page')
        self.user = get_user_model().objects.create_user(
            username='testuser',
            password='password',
        )
        self.other_user = get_user_model().objects.create_user(
            username='otheruser',
            password='other-password',
        )

    def assert_generic_failure(self, response):
        """Failures and lockouts expose the same browser response."""
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, '/login/?error=1')

    def fail_login(self, client=None, username='testuser', **request_headers):
        """Submit one bad password and assert the generic response."""
        client = client or self.client
        response = client.post(
            self.url,
            {'username': username, 'password': 'wrong-password'},
            **request_headers,
        )
        self.assert_generic_failure(response)
        return response

    def test_fifth_failure_locks_username_and_correct_password_stays_generic(self):
        """Five failures block authentication without revealing the lockout."""
        for _index in range(4):
            self.fail_login()

        with self.assertLogs('fss.security', level='WARNING') as security_logs:
            self.fail_login()

        self.assertIn(
            "Login temporarily locked for username 'testuser'",
            security_logs.output[0],
        )
        attempt = AccessAttempt.objects.get(username='testuser')
        self.assertEqual(attempt.failures_since_start, 5)

        response = self.client.post(
            self.url,
            {'username': 'testuser', 'password': 'password'},
        )
        self.assert_generic_failure(response)
        self.assertNotIn('_auth_user_id', self.client.session)
        attempt.refresh_from_db()
        self.assertEqual(attempt.failures_since_start, 5)

    def test_username_limit_aggregates_across_client_metadata(self):
        """Changing addresses, user agents, or cookies does not evade the limit."""
        for index in range(5):
            client = Client()
            self.fail_login(
                client,
                REMOTE_ADDR=f'192.0.2.{index + 1}',
                HTTP_USER_AGENT=f'rotating-agent-{index}',
            )

        self.assertEqual(
            sum(
                AccessAttempt.objects.filter(username='testuser')
                .values_list('failures_since_start', flat=True)
            ),
            5,
        )
        response = Client().post(
            self.url,
            {'username': 'testuser', 'password': 'password'},
            REMOTE_ADDR='198.51.100.1',
            HTTP_USER_AGENT='another-agent',
        )
        self.assert_generic_failure(response)

        other_response = Client().post(
            self.url,
            {'username': 'otheruser', 'password': 'other-password'},
            REMOTE_ADDR='198.51.100.1',
            HTTP_USER_AGENT='another-agent',
        )
        self.assertEqual(other_response.status_code, 302)
        self.assertEqual(other_response.url, '/')

    def test_successful_login_resets_prior_failures(self):
        """A valid login starts a fresh failure window."""
        for _index in range(4):
            self.fail_login()

        response = self.client.post(
            self.url,
            {'username': 'testuser', 'password': 'password'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, '/')
        self.assertFalse(AccessAttempt.objects.filter(username='testuser').exists())

        self.client.logout()
        for _index in range(4):
            self.fail_login()

        response = self.client.post(
            self.url,
            {'username': 'testuser', 'password': 'password'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, '/')

    def test_expired_failure_window_allows_login(self):
        """Authentication resumes when the rolling cool-off has elapsed."""
        for _index in range(5):
            self.fail_login()

        expired_at = timezone.now() - timedelta(minutes=16)
        AccessAttempt.objects.filter(username='testuser').update(
            attempt_time=expired_at,
        )
        AccessAttemptExpiration.objects.filter(
            access_attempt__username='testuser',
        ).update(expires_at=expired_at)

        response = self.client.post(
            self.url,
            {'username': 'testuser', 'password': 'password'},
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, '/')
        self.assertIn('_auth_user_id', self.client.session)
        self.assertFalse(AccessAttempt.objects.filter(username='testuser').exists())
