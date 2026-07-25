"""
Tests for security-relevant Django settings.
"""

from django.conf import settings
from django.test import Client, SimpleTestCase, TestCase, override_settings

from fss.settings import merge_csrf_trusted_origins


class SecuritySettingsTest(SimpleTestCase):
    """
    Check base security defaults that local deployments inherit.
    """

    def test_secure_cookie_defaults_are_enabled(self):
        """
        Session and CSRF cookies default to HTTPS-only with SameSite=Lax.
        """
        self.assertTrue(settings.SESSION_COOKIE_SECURE)
        self.assertTrue(settings.CSRF_COOKIE_SECURE)
        self.assertEqual(settings.SESSION_COOKIE_SAMESITE, 'Lax')
        self.assertEqual(settings.CSRF_COOKIE_SAMESITE, 'Lax')

    def test_cors_allows_only_peer_poll_and_command_routes(self):
        """Peer servers can prepare and submit commands, but not read unrelated APIs."""
        self.assertRegex('/current/all.json/', settings.CORS_URLS_REGEX)
        self.assertRegex('/assets/42/command/confirm/', settings.CORS_URLS_REGEX)
        self.assertRegex('/assets/42/command/set/', settings.CORS_URLS_REGEX)
        self.assertNotRegex('/assets/42/status.json', settings.CORS_URLS_REGEX)


class MergeCsrfTrustedOriginsTest(SimpleTestCase):
    """
    A peer trusted for CORS must also become CSRF-trusted (SECURITY-05):
    listing it in only one of the two silently breaks cross-server commands.
    """

    def test_cors_peer_is_added_to_csrf_trusted(self):
        """A CORS-only peer is added to the CSRF-trusted set."""
        merged = merge_csrf_trusted_origins(['https://fss1.example.com'], ['https://fss2.example.com'])
        self.assertEqual(merged, ['https://fss1.example.com', 'https://fss2.example.com'])

    def test_no_duplicates_when_already_listed_in_both(self):
        """A peer listed in both sets is not duplicated."""
        merged = merge_csrf_trusted_origins(['https://fss1.example.com'], ['https://fss1.example.com'])
        self.assertEqual(merged, ['https://fss1.example.com'])

    def test_empty_cors_leaves_csrf_trusted_unchanged(self):
        """A single-server deployment with no CORS peers is unaffected."""
        merged = merge_csrf_trusted_origins(['https://fss1.example.com'], [])
        self.assertEqual(merged, ['https://fss1.example.com'])


@override_settings(CSRF_TRUSTED_ORIGINS=['https://fss-peer.example.com'], ALLOWED_HOSTS=['testserver'])
class CrossOriginCommandCsrfTest(TestCase):
    """
    Regression for SECURITY-05: Django's CSRF middleware rejects a cross-origin
    POST outright (before even checking the token) unless the Origin header is
    the request's own origin or is listed in CSRF_TRUSTED_ORIGINS. A POST from
    a trusted peer origin with a valid token must pass that check; the same
    request from an untrusted origin must not, regardless of the token.
    """

    def _post_with_valid_token(self, client, origin):
        get_response = client.get('/login/')
        csrftoken = get_response.cookies['csrftoken'].value
        return client.post('/login/', {'csrfmiddlewaretoken': csrftoken}, HTTP_ORIGIN=origin)

    def test_trusted_peer_origin_passes_csrf_check(self):
        """A POST with Origin: a CSRF_TRUSTED_ORIGINS entry is not CSRF-rejected."""
        client = Client(enforce_csrf_checks=True)
        response = self._post_with_valid_token(client, 'https://fss-peer.example.com')
        # Invalid/missing credentials still redirect to the error page; the
        # point is that CSRF itself did not 403 the request.
        self.assertNotEqual(response.status_code, 403)

    def test_untrusted_origin_is_csrf_rejected(self):
        """A POST with an untrusted Origin is CSRF-rejected regardless of token."""
        client = Client(enforce_csrf_checks=True)
        response = self._post_with_valid_token(client, 'https://not-a-peer.example.com')
        self.assertEqual(response.status_code, 403)
