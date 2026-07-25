"""
Django settings for testing against PostGIS - the engine production (and the
FSS server sharing the same database) actually uses, unlike the SpatiaLite
default in test_settings.py. Connection details come from the environment so
CI can point this at a postgis service container; see
.github/workflows/checkcode.yml.
"""

import os

# Inherit test-only overrides (including authentication-backend compatibility)
# and replace only the database engine and connection below.
# pylint: disable=W0401,W0614
from .test_settings import *

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '5432'),
        'NAME': os.environ.get('DB_NAME', 'fss_test'),
        'USER': os.environ.get('DB_USER', 'postgres'),
        'PASSWORD': os.environ.get('DB_PASS', 'postgres'),
    }
}
