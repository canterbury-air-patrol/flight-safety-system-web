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
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Peer FSS server origins for cross-origin credentialed fetches.
# Each server must appear in the other servers' lists.
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
    if o.strip()
]

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'HOST': os.environ['DB_HOST'],
        'NAME': os.environ['DB_NAME'],
        'USER': os.environ['DB_USER'],
        'PASSWORD': os.environ['DB_PASS'],
    }
}
