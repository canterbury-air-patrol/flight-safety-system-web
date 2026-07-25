"""
Django settings for testing, using SpatiaLite in-memory database.
"""

# pylint: disable=W0401,W0614
from .settings import *

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.spatialite',
        'NAME': ':memory:',
    }
}

# Ensure we don't try to connect to a real Postgres in tests
SPATIALITE_LIBRARY_PATH = 'mod_spatialite.so'

# Most tests authenticate directly through Client.login(), which does not pass
# an HttpRequest to authentication backends. Enable Axes only in the dedicated
# login-security tests that exercise the real HTTP login view.
AXES_ENABLED = False
