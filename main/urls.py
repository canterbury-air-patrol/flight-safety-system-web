"""
Main URLs
"""

from django.urls import re_path

from . import views

urlpatterns = [
    re_path(r'^assets.json$', views.asset_list, name='asset_list'),
    re_path(r'^$', views.main_view, name='main_view'),
    re_path(r'^current/all.json/$', views.all_status_data, name='all_status_data'),
    re_path(r'^login/$', views.login_page, name='login_page'),
]
