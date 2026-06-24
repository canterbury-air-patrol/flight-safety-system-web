"""
Main view functions
"""
from django.contrib.auth import authenticate, login
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie

from assets.models import Asset
from assets.views import bulk_asset_status_data, server_now_ms
from config.models import ServerConfig
from fss.decorators import login_required_api


@ensure_csrf_cookie
def main_view(request):
    """
    The default landing page
    """
    return render(request, 'main/main.html')


@login_required_api
def server_list(request):
    """
    Return the active servers as a json array
    """
    servers = ServerConfig.objects.filter(active=True)
    servers_list = []
    for server in servers:
        server_details = {
            'name': server.name,
            'address': server.address,
            'client_port': server.client_port,
            'url': server.http_address(),
        }
        servers_list.append(server_details)

    return JsonResponse({'servers': servers_list})


@login_required_api
def asset_list(request):
    """
    Return the know assets as a json array
    """
    assets = Asset.objects.all()
    assets_list = [{'pk': asset.pk, 'name': asset.name} for asset in assets]
    return JsonResponse({'assets': assets_list})


def current_user(request):
    """
    Return the current user, helps determine if the client is logged in
    """
    user = request.user.username if request.user.is_authenticated else None
    return JsonResponse({'currentUser': user})


@ensure_csrf_cookie
def login_page(request):
    """
    Login a user
    """
    if request.method == "POST":
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            # Redirect to a success page.
            return redirect('/')
        return redirect('/login/?error=1')
    return render(request, 'main/main.html')


@login_required_api
def all_status_data(request):
    """
    Return all data in one go
    """
    data = {
        'currentUser': None,
        'csrfToken': get_token(request),
        # The server's current time (epoch-ms), used by the frontend to age
        # commands against a single server clock instead of the browser clock.
        'server_now': server_now_ms(),
        'servers': [],
        'assets': []
    }

    if request.user.is_authenticated:
        data['currentUser'] = request.user.username

    servers = ServerConfig.objects.filter(active=True)
    for server in servers:
        server_details = {
            'name': server.name,
            'address': server.address,
            'client_port': server.client_port,
            'url': server.http_address(),
        }
        data['servers'].append(server_details)

    assets = Asset.objects.all()
    data['assets'] = bulk_asset_status_data(assets)

    response = JsonResponse(data)
    response['Cache-Control'] = 'private, no-store'
    return response
