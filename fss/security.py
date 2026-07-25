"""
Authentication security integration helpers.
"""

import logging

from axes.signals import user_locked_out
from django.dispatch import receiver
from django.http import HttpResponseBase
from django.shortcuts import redirect

LOGGER = logging.getLogger('fss.security')


def ignore_client_ip(_request):
    """
    Do not collect an address that is not part of the lockout policy.

    Deployments use independently configured reverse proxies, so Django
    cannot safely interpret a forwarded client-address header globally.
    """
    return None


def preserve_auth_failure_response(_request, response, _credentials, *args, **kwargs):
    """
    Keep the login view's generic failure response when Axes blocks a login.
    """
    if isinstance(response, HttpResponseBase):
        return response
    # django-axes 8.3.1 does not pass the original response through its async
    # middleware path. Keep that edge case generic instead of returning its
    # credentials dictionary as a response.
    return redirect('/login/?error=1')


@receiver(user_locked_out)
def log_user_lockout(sender, request, username, ip_address, **kwargs):  # pylint: disable=unused-argument
    """
    Emit an operational security event without credentials or request data.
    """
    LOGGER.warning("Login temporarily locked for username %r", username)
