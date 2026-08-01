#!/usr/bin/env python3
"""Assertions used by the Docker Compose smoke test."""

import argparse
import json
import os
import sys
import time
import uuid
from http.cookiejar import CookieJar
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener


SMOKE_ASSET_NAME = 'Compose Smoke Asset'
SMOKE_OPERATION_ID = uuid.UUID('e3759a70-f1b8-4c3b-b26c-27cdb2b59751')


def require(condition, message):
    """Exit with a useful message when a smoke-test assertion fails."""
    if not condition:
        raise SystemExit(message)


def verify_config(args):
    """Verify the rendered database settings for PostgreSQL and Django."""
    config = json.load(sys.stdin)
    db_service = config['services']['db']
    web_service = config['services']['web']
    maintenance_service = config['services']['telemetry-maintenance']
    proxy_service = config['services']['tls-proxy']
    expected_db_environment = {
        'POSTGRES_USER': args.database_user,
        'POSTGRES_DB': args.database_name,
        'POSTGRES_PASSWORD': args.database_password,
    }
    expected_web_environment = {
        'DB_USER': args.database_user,
        'DB_NAME': args.database_name,
        'DB_PASS': args.database_password,
    }

    for setting, expected in expected_db_environment.items():
        require(
            db_service['environment'].get(setting) == expected,
            f'db environment does not contain {setting}={expected}',
        )
    for setting, expected in expected_web_environment.items():
        require(
            web_service['environment'].get(setting) == expected,
            f'web environment does not contain {setting}={expected}',
        )
    for service_name, service in (
        ('web', web_service),
        ('telemetry-maintenance', maintenance_service),
    ):
        require(
            'COMMAND_AUDIT_RETENTION_DAYS' in service['environment'],
            f'{service_name} environment does not expose command audit retention',
        )

    healthcheck = ' '.join(db_service['healthcheck']['test'])
    require('POSTGRES_USER' in healthcheck, 'database health check does not select POSTGRES_USER')
    require('POSTGRES_DB' in healthcheck, 'database health check does not select POSTGRES_DB')
    require(db_service.get('restart') == 'unless-stopped', 'database restart policy is not unless-stopped')
    require(web_service.get('restart') == 'unless-stopped', 'web restart policy is not unless-stopped')
    web_healthcheck = ' '.join(web_service['healthcheck']['test'])
    require('/health/' in web_healthcheck, 'web health check does not use application readiness')
    require(
        proxy_service.get('depends_on', {}).get('web', {}).get('condition') == 'service_healthy',
        'TLS proxy does not wait for a healthy web service during initial startup',
    )
    database_volumes = db_service.get('volumes', [])
    expected_volume = {
        'type': 'volume',
        'source': 'db-data',
        'target': '/var/lib/postgresql',
    }
    require(
        any(
            all(volume.get(key) == value for key, value in expected_volume.items())
            for volume in database_volumes
        ),
        'database does not mount db-data at the PostgreSQL 18 persistent root',
    )
    print('Rendered Compose config passes database checks.')


def setup_django():
    """Initialize Django only for commands that inspect application data."""
    repository_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, repository_root)
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'fss.settings')
    import django  # pylint: disable=import-outside-toplevel
    django.setup()


def seed_audit_data(_args):
    """Create stable application and audit rows for persistence tests."""
    setup_django()
    from django.contrib.auth import get_user_model  # pylint: disable=import-outside-toplevel
    from assets.models import Asset, AssetCommand, AssetRTT  # pylint: disable=import-outside-toplevel

    username = os.environ['DJANGO_SUPERUSER_USERNAME']
    user = get_user_model().objects.get(username=username)
    asset, _created = Asset.objects.get_or_create(name=SMOKE_ASSET_NAME)
    AssetRTT.objects.create(asset=asset, rtt=25)
    AssetCommand.objects.get_or_create(
        operation_id=SMOKE_OPERATION_ID,
        defaults={
            'asset': asset,
            'command': 'RTL',
            'issued_by': user,
        },
    )
    print('Seeded asset and issued command for persistence checks.')


def verify_audit_data(_args):
    """Verify restored command identity and issuer relationships."""
    setup_django()
    from django.contrib.auth import get_user_model  # pylint: disable=import-outside-toplevel
    from assets.models import AssetCommand  # pylint: disable=import-outside-toplevel

    username = os.environ['DJANGO_SUPERUSER_USERNAME']
    require(
        get_user_model().objects.filter(username=username).exists(),
        'smoke-test user did not survive database recovery',
    )
    command = AssetCommand.objects.select_related('asset', 'issued_by').filter(
        operation_id=SMOKE_OPERATION_ID,
    ).first()
    require(command is not None, 'smoke-test command did not survive database recovery')
    require(command.asset.name == SMOKE_ASSET_NAME, 'command lost its asset relationship')
    require(command.issued_by is not None, 'command lost its issuing user')
    require(command.issued_by.username == username, 'command issuer changed during recovery')
    print('User, asset, and command audit relationships are intact.')


def wait_for_login_page(opener, login_url, timeout_seconds):
    """Wait for uWSGI to serve the login page."""
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    while time.monotonic() < deadline:
        try:
            with opener.open(login_url, timeout=5) as response:
                response.read()
            return
        except (TimeoutError, URLError) as error:
            last_error = error
            time.sleep(1)
    raise SystemExit(f'web service did not become ready: {last_error}')


def verify_endpoint(args):
    """Log in and prove an authenticated endpoint is served."""
    username = os.environ['DJANGO_SUPERUSER_USERNAME']
    password = os.environ['DJANGO_SUPERUSER_PASSWORD']
    base_url = 'http://127.0.0.1:8080'
    login_url = f'{base_url}/login/'
    cookie_jar = CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar))

    wait_for_login_page(opener, login_url, args.timeout)
    csrf_token = next(
        (cookie.value for cookie in cookie_jar if cookie.name == 'csrftoken'),
        None,
    )
    require(csrf_token is not None, 'login page did not set a CSRF cookie')

    login_data = urlencode({
        'username': username,
        'password': password,
        'csrfmiddlewaretoken': csrf_token,
    }).encode()
    login_request = Request(
        login_url,
        data=login_data,
        headers={'Referer': login_url},
        method='POST',
    )
    with opener.open(login_request, timeout=5) as response:
        response.read()

    with opener.open(f'{base_url}/current/all.json/', timeout=5) as response:
        status = json.load(response)
    require(
        status.get('currentUser') == username,
        'authenticated endpoint did not return the smoke-test user',
    )
    if args.submit_command:
        command_csrf_token = status.get('csrfToken')
        require(command_csrf_token is not None, 'status endpoint did not return a CSRF token')
        asset_id = next(
            (
                entry['asset']['pk']
                for entry in status.get('assets', [])
                if entry['asset']['name'] == SMOKE_ASSET_NAME
            ),
            None,
        )
        require(asset_id is not None, 'status endpoint did not return the smoke-test asset')
        command_data = urlencode({
            'command': 'RTL',
            'operation_id': str(uuid.uuid4()),
        }).encode()
        command_request = Request(
            f'{base_url}/assets/{asset_id}/command/set/',
            data=command_data,
            headers={'Referer': f'{base_url}/', 'X-CSRFToken': command_csrf_token},
            method='POST',
        )
        with opener.open(command_request, timeout=5) as response:
            command_response = response.read()
        require(command_response == b'Queued', 'authenticated command was not queued')
        print('Authenticated command submission recovered.')
    print(f'Authenticated endpoint returned currentUser={username}.')


def parse_args():
    """Parse smoke-test helper arguments."""
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command', required=True)

    config_parser = subparsers.add_parser('config')
    config_parser.add_argument('database_user')
    config_parser.add_argument('database_name')
    config_parser.add_argument('database_password')
    config_parser.set_defaults(handler=verify_config)

    seed_parser = subparsers.add_parser('seed')
    seed_parser.set_defaults(handler=seed_audit_data)

    audit_parser = subparsers.add_parser('audit')
    audit_parser.set_defaults(handler=verify_audit_data)

    endpoint_parser = subparsers.add_parser('endpoint')
    endpoint_parser.add_argument('--timeout', type=int, default=60)
    endpoint_parser.add_argument('--submit-command', action='store_true')
    endpoint_parser.set_defaults(handler=verify_endpoint)
    return parser.parse_args()


if __name__ == '__main__':
    parsed_args = parse_args()
    parsed_args.handler(parsed_args)
