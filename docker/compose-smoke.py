#!/usr/bin/env python3
"""Assertions used by the Docker Compose smoke test."""

import argparse
import json
import os
import sys
import time
from http.cookiejar import CookieJar
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener


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
    print('Rendered Compose config passes database checks.')


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

    endpoint_parser = subparsers.add_parser('endpoint')
    endpoint_parser.add_argument('--timeout', type=int, default=60)
    endpoint_parser.set_defaults(handler=verify_endpoint)
    return parser.parse_args()


if __name__ == '__main__':
    parsed_args = parse_args()
    parsed_args.handler(parsed_args)
