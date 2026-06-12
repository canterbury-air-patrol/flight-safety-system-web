"""
Main URLs
"""

from django.urls import path, re_path

from . import views

urlpatterns = [
    path('servers.json', views.server_list, name='server_list'),
    path('assets.json', views.asset_list, name='asset_list'),
    path('current/all.json/', views.all_status_data, name='all_status_data'),
    path('current_user/', views.current_user, name='current_user'),
    re_path(r'^login/?$', views.login_page, name='login_page'),
    path('', views.main_view, name='main_view'),
]
