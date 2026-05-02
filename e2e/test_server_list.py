"""E2E tests for the server-list JSON endpoint (/current/all.json/).

Regression for TEST-02: config_serverconfig was missing the name, config_port,
and https columns in the e2e schema, so any test that exercised the Django
server-list response would get incomplete or wrong data.

Run with: python manage.py test e2e
Requires: PostgreSQL + PostGIS (same as the dev environment).
"""
from django.test import TestCase

from config.models import ServerConfig


class ServerListJsonTest(TestCase):
    def test_returns_name_and_http_url(self):
        ServerConfig.objects.create(
            name="primary",
            address="192.0.2.1",
            client_port=20202,
            config_port=8090,
            https=False,
            active=True,
        )
        response = self.client.get("/current/all.json/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["servers"]), 1)
        server = data["servers"][0]
        self.assertEqual(server["name"], "primary")
        self.assertEqual(server["address"], "192.0.2.1")
        self.assertEqual(server["client_port"], 20202)
        self.assertEqual(server["url"], "http://192.0.2.1:8090")

    def test_returns_https_url_when_https_true(self):
        ServerConfig.objects.create(
            name="secure",
            address="192.0.2.2",
            client_port=20202,
            config_port=443,
            https=True,
            active=True,
        )
        response = self.client.get("/current/all.json/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["servers"]), 1)
        self.assertEqual(data["servers"][0]["url"], "https://192.0.2.2")

    def test_inactive_server_excluded(self):
        ServerConfig.objects.create(
            name="offline",
            address="192.0.2.3",
            client_port=20202,
            config_port=8090,
            https=False,
            active=False,
        )
        response = self.client.get("/current/all.json/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["servers"], [])
