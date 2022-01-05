"""
Main view functions
"""
from django.contrib.auth import authenticate, login
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.csrf import ensure_csrf_cookie

from assets.models import Asset
from config.models import ServerConfig


@ensure_csrf_cookie
def main_view(request):
    """
    The default landing page
    """
    return render(request, 'main/main.html', {request: request})


def status_view(request):
    """
    Report the current status
    """
    assets = Asset.objects.all()
    return HttpResponse(f'<tr><td class="server-status-label">Known Assets</td><td class="server-status-value">{assets.count()}</td></tr>')


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


def asset_list(request):
    """
    Return the know assets as a json array
    """
    assets = Asset.objects.filter()
    assets_list = []
    for asset in assets:
        assets_list.append({'pk': asset.pk, 'name': asset.name})

    return JsonResponse({'assets': assets_list})


def current_user(request):
    """
    Return the current user, helps determine if the client is logged in
    """
    if request.user.is_authenticated:
        user = request.user.username
    else:
        user = None
    return JsonResponse({'currentUser': user})


def login_page(request):
    """
    Login a user
    """
    if request.method == "POST":
        username = request.POST['username']
        password = request.POST['password']
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            # Redirect to a success page.
            return redirect('/')
    return render(request, 'main/login_page.html')
