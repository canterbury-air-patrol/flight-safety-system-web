"""
URLs for assets
"""

from django.urls import re_path

from . import views

urlpatterns = [
    re_path(r'^$', views.assets_main, name='assets_main'),
    re_path(r'^add/$', views.asset_add, name='asset_add'),
    re_path(r'^(?P<asset_id>\d+)/status.json$', views.asset_status_json, name='asset_status_json'),
    re_path(r'^(?P<asset_id>\d+)/command/set/$', views.asset_command_set, name='asset_command_set'),
]
