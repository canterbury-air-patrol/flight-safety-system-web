"""
URLs for configuration
"""

from django.urls import re_path

from . import views

urlpatterns = [
    re_path(r'^$', views.config_main, name='config_main'),
]
