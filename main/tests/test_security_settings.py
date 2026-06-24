"""
Tests for security-relevant Django settings.
"""

from django.conf import settings
from django.test import SimpleTestCase


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
