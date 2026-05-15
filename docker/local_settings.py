"""
This file contains your site-specific settings
Make changes as required and make sure to save
it as local_settings.py
"""

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'

# Allow all hosts
ALLOWED_HOSTS = ['*']
# NOTE: http:// here is for local Docker development only.
# In production, all origins must be https:// (see Deployment Requirements in README).
CSRF_TRUSTED_ORIGINS = ['http://localhost:8080']

# Require the Secure flag on session and CSRF cookies so they are never sent
# over plain HTTP. All production instances must be served over HTTPS.
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# CORS: list every peer FSS web-server origin so browsers can send credentials
# cross-origin. Each server must appear in the other servers' lists.
# All entries must use HTTPS and share a registered domain (e.g. example.com).
# Example: CORS_ALLOWED_ORIGINS = ['https://fss1.example.com', 'https://fss2.example.com']
CORS_ALLOWED_ORIGINS = []

# Database
# https://docs.djangoproject.com/en/2.1/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.contrib.gis.db.backends.postgis',
        'HOST': 'POSTGRES_SERVER',
        'NAME': 'POSTGRES_DBNAME',
        'USER': 'POSTGRES_USER',
        'PASSWORD': 'POSTGRES_PASSWORD'
    }
}
