"""
TEST-01 (TC-WEB-001 / HZ-09): a completeness net behind the existing
per-endpoint unauthenticated-access tests. Walks every URL pattern from the
resolver - not a hand-kept list - so a new endpoint that forgets
@login_required_api fails this sweep by default instead of shipping silently.
"""

from django.test import TestCase
from django.urls import NoReverseMatch, get_resolver, reverse
from django.urls.resolvers import URLPattern, URLResolver

from assets.models import Asset, AssetCommand
from fss.satisfies import satisfies

# Endpoints deliberately reachable without authentication: the SPA shell (its
# auth-gated data is fetched separately via JS) and the login flow itself.
PUBLIC_URL_NAMES = {
    'main_view',
    'assets_main',
    'config_main',
    'login_page',
}

# django.contrib.admin and django.contrib.auth's own URLs (password reset
# etc.) are not this project's view surface and have their own auth model;
# out of scope for this sweep.
SKIP_NAMESPACES = {'admin'}
SKIP_MODULES = {'django.contrib.auth.urls'}

# Dummy values for named URL kwargs, tried when a bare reverse() fails.
DUMMY_KWARGS = {'asset_id': 1}


def _iter_view_names(resolver):
    for entry in resolver.url_patterns:
        if isinstance(entry, URLResolver):
            if entry.namespace in SKIP_NAMESPACES:
                continue
            module_name = entry.urlconf_name if isinstance(entry.urlconf_name, str) else getattr(entry.urlconf_module, '__name__', None)
            if module_name in SKIP_MODULES:
                continue
            yield from _iter_view_names(entry)
        elif isinstance(entry, URLPattern) and entry.name:
            yield entry.name


class UnauthenticatedAccessSweepTest(TestCase):
    """
    Every endpoint in this project's own URLconfs must reject an
    unauthenticated request, unless explicitly allowlisted as public.
    """

    @satisfies('TC-WEB-001')
    def test_unauthenticated_requests_are_rejected(self):
        """Sweep every named URL pattern this project owns for a 302/403."""
        checked = []
        for name in _iter_view_names(get_resolver()):
            if name in PUBLIC_URL_NAMES:
                continue
            try:
                url = reverse(name)
            except NoReverseMatch:
                try:
                    url = reverse(name, kwargs=DUMMY_KWARGS)
                except NoReverseMatch:
                    self.fail(f"don't know how to reverse '{name}' for the unauth sweep - add its kwargs or allowlist it")

            checked.append(name)
            response = self.client.get(url)
            self.assertIn(
                response.status_code,
                (302, 403),
                f"{name} ({url}) allowed an unauthenticated GET (got {response.status_code})",
            )

        # Guard against the sweep silently checking nothing if the resolver
        # tree changes shape underneath it.
        self.assertGreaterEqual(len(checked), 5)

    def test_unauthenticated_post_does_not_create_asset(self):
        """asset_add is a POST endpoint; confirm it also can't create state."""
        response = self.client.post(reverse('asset_add'), {'asset_name': 'Sneaky Drone'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Asset.objects.filter(name='Sneaky Drone').exists())

    def test_unauthenticated_post_does_not_create_command(self):
        """asset_command_set is a POST endpoint; confirm it can't queue a command."""
        asset = Asset.objects.create(name='Test Drone')
        response = self.client.post(reverse('asset_command_set', kwargs={'asset_id': asset.pk}), {'command': 'TERM'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(AssetCommand.objects.filter(asset=asset).count(), 0)
