"""
URLs for assets
"""

from django.urls import re_path

from . import identity_alerts, views

urlpatterns = [
    re_path(r'^(?P<asset_id>\d+)/identity-events/$', identity_alerts.identity_event_history, name='identity_event_history'),
    re_path(r'^(?P<asset_id>\d+)/identity-events/(?P<event_id>\d+)/acknowledge/$', identity_alerts.identity_event_acknowledge, name='identity_event_acknowledge'),
    re_path(r'^$', views.assets_main, name='assets_main'),
    re_path(r'^add/$', views.asset_add, name='asset_add'),
    re_path(r'^(?P<asset_id>\d+)/command/confirm/$', views.asset_command_confirm, name='asset_command_confirm'),
    re_path(r'^(?P<asset_id>\d+)/command/set/$', views.asset_command_set, name='asset_command_set'),
]
