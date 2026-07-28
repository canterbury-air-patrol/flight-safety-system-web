"""
Docker production settings — all runtime config is read from environment variables.
See .env.example for the required variables.
"""

import os

DEBUG = False

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'

# Required: comma-separated list of hostnames this instance is reachable on.
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost').split(',')

# Required: comma-separated https:// origins (must match ALLOWED_HOSTS scheme+host).
CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get('CSRF_TRUSTED_ORIGINS', '').split(',')
    if o.strip()
]

# Require the Secure flag on session and CSRF cookies so they are never sent
# over plain HTTP. All production instances must be served over HTTPS.
# Set SESSION_COOKIE_SECURE=false or CSRF_COOKIE_SECURE=false only in
# environments where HTTPS is not available (e.g. integration test runners).
SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE', 'true').lower() != 'false'
CSRF_COOKIE_SECURE = os.environ.get('CSRF_COOKIE_SECURE', 'true').lower() != 'false'
# SameSite=Lax is the Django default but we pin it explicitly: the multi-server
# architecture relies on Lax to allow credentialed cross-origin fetches between
# FSS instances that share a registered domain (e.g. fss1.example.com →
# fss2.example.com). Strict would break cross-origin polling; None would weaken
# CSRF protection. This value must not be changed without reviewing SEC-01/02.
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# HSTS: opt-in via SECURE_HSTS_SECONDS (e.g. 31536000 for 1 year).
# Only set this when the container is behind a reverse proxy that strips and
# rewrites X-Forwarded-Proto — without a trusted proxy, clients can forge that
# header and cause Django to treat HTTP as HTTPS. Leave unset (or 0) when
# running without a proxy (e.g. local development or direct-port deployments).
# SECURE_HSTS_INCLUDE_SUBDOMAINS defaults true, covering peer FSS instances on
# the same domain. SECURE_HSTS_PRELOAD defaults false because preload registration
# is hard to undo; only enable it for domains that will remain HTTPS permanently.
_hsts_seconds = int(os.environ.get('SECURE_HSTS_SECONDS', '0'))
if _hsts_seconds:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_HSTS_SECONDS = _hsts_seconds
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get('SECURE_HSTS_INCLUDE_SUBDOMAINS', 'true').lower() == 'true'
    SECURE_HSTS_PRELOAD = os.environ.get('SECURE_HSTS_PRELOAD', 'false').lower() == 'true'

# security.W004 (HSTS) and security.W008 (SECURE_SSL_REDIRECT) are silenced
# deliberately, not fixed: this deployment model puts a TLS-terminating
# reverse proxy in front of uWSGI, and that proxy - not Django - is
# responsible for enforcing HTTPS and issuing the HTTP->HTTPS redirect.
# Django only sees plain HTTP from the proxy unless SECURE_HSTS_SECONDS is
# opted into above (which also wires up SECURE_PROXY_SSL_HEADER). Silencing
# just these two checks (rather than skipping `manage.py check --deploy`
# altogether) keeps it meaningful for everything else it catches - DEBUG,
# secret key strength, cookie flags, etc.
SILENCED_SYSTEM_CHECKS = ['security.W004', 'security.W008']

# Peer FSS server origins for cross-origin credentialed fetches.
# Each server must appear in the other servers' lists.
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
    if o.strip()
]

# Empty table-specific values leave retention disabled for that telemetry
# stream. Values are validated by the prune_telemetry management command so a
# configuration error cannot silently select an unintended deletion window.
TELEMETRY_POSITION_RETENTION_DAYS = os.environ.get('TELEMETRY_POSITION_RETENTION_DAYS') or None
TELEMETRY_STATUS_RETENTION_DAYS = os.environ.get('TELEMETRY_STATUS_RETENTION_DAYS') or None
TELEMETRY_RTT_RETENTION_DAYS = os.environ.get('TELEMETRY_RTT_RETENTION_DAYS') or None
TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS = os.environ.get('TELEMETRY_SEARCH_PROGRESS_RETENTION_DAYS') or None
TELEMETRY_ALIGNED_WINDOW_HOURS = os.environ.get('TELEMETRY_ALIGNED_WINDOW_HOURS', '24')

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'HOST': os.environ['DB_HOST'],
        'NAME': os.environ['DB_NAME'],
        'USER': os.environ['DB_USER'],
        'PASSWORD': os.environ['DB_PASS'],
    }
}
