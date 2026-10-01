"""TC-MAV-015 evidence for persistent duplicate-identity visibility."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from assets.identity_alerts import HISTORY_LIMIT, SUMMARY_LIMIT, identity_alert_summaries
from assets.models import Asset, AssetIdentityEvent
from assets.views import bulk_asset_status_data
from fss.satisfies import satisfies


class IdentityAlertTest(TestCase):
    """Event evidence survives polling, acknowledgement and asset retirement."""

    def setUp(self):
        self.asset = Asset.objects.create(name='Aircraft')
        self.user = get_user_model().objects.create_user(username='pilot')
        self.client.force_login(self.user)
        self.event = AssetIdentityEvent.objects.create(
            asset=self.asset, outcome='incumbent_evicted',
            timestamp=timezone.now() - timedelta(days=30),
            incumbent={'certificate_cn': 'Aircraft', 'session_id': 'old'},
            newcomer={'certificate_cn': 'Aircraft', 'session_id': 'new'},
        )

    def ack_url(self, event=None, asset=None):
        """Address one event on its owning asset."""
        return reverse('identity_event_acknowledge', args=[(asset or self.asset).pk, (event or self.event).pk])

    def history_url(self):
        """Address this asset's audit history."""
        return reverse('identity_event_history', args=[self.asset.pk])

    @satisfies('TC-MAV-015')
    def test_pending_summary_is_durable_bounded_and_retains_eviction_severity(self):
        """An old eviction cannot be hidden by new reconnects or clean telemetry."""
        for _ in range(SUMMARY_LIMIT + 3):
            AssetIdentityEvent.objects.create(asset=self.asset, outcome='newcomer_rejected')
        for _ in range(2):
            response = self.client.get(reverse('all_status_data'))
            summary = response.json()['assets'][0]['identity_alerts']
            self.assertEqual(summary['count'], SUMMARY_LIMIT + 4)
            self.assertEqual(summary['eviction_count'], 1)
            self.assertEqual(len(summary['events']), SUMMARY_LIMIT)
            self.assertNotIn(self.event.pk, [event['id'] for event in summary['events']])
            self.assertEqual(summary['events'][0]['outcome'], 'newcomer_rejected')

    @satisfies('TC-MAV-015')
    def test_acknowledgement_preserves_first_actor_and_new_events(self):
        """Retries by another operator do not overwrite evidence or clear unseen events."""
        newer = AssetIdentityEvent.objects.create(asset=self.asset, outcome='newcomer_rejected')
        first = self.client.post(self.ack_url())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['event']['acknowledged_by'], 'pilot')
        other = get_user_model().objects.create_user(username='other')
        self.client.force_login(other)
        self.assertEqual(self.client.post(self.ack_url()).json(), first.json())
        self.user.delete()
        self.event.refresh_from_db()
        self.assertIsNone(self.event.acknowledged_by)
        self.assertEqual(self.event.acknowledged_username, 'pilot')
        summary = identity_alert_summaries([self.asset.pk])[self.asset.pk]
        self.assertEqual(summary['count'], 1)
        self.assertEqual(summary['events'][0]['id'], newer.pk)
        self.asset.retired_at = timezone.now()
        self.asset.save()
        history = self.client.get(self.history_url()).json()['events']
        self.assertEqual(len(history), 2)
        self.assertEqual(history[1]['incumbent']['session_id'], 'old')
        self.assertEqual(history[1]['acknowledged_by'], 'pilot')
        self.assertEqual(self.client.get(reverse('all_status_data')).json()['assets'], [])
        with self.assertRaises(ProtectedError):
            self.asset.delete()

    def test_authentication_csrf_methods_and_asset_scope(self):
        """Only authenticated, CSRF-validated POSTs may acknowledge the named event."""
        anonymous = Client()
        self.assertEqual(anonymous.get(self.history_url()).status_code, 403)
        self.assertEqual(anonymous.post(self.ack_url()).status_code, 403)
        self.assertEqual(self.client.get(self.ack_url()).status_code, 405)
        self.assertEqual(self.client.post(self.history_url()).status_code, 405)
        other_asset = Asset.objects.create(name='Other')
        self.assertEqual(self.client.post(self.ack_url(asset=other_asset)).status_code, 404)
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.force_login(self.user)
        self.assertEqual(csrf_client.post(self.ack_url()).status_code, 403)
        token = csrf_client.get(reverse('all_status_data')).json()['csrfToken']
        self.assertEqual(csrf_client.post(self.ack_url(), HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(self.client.get(self.history_url())['Cache-Control'], 'private, no-store')

    def test_history_pagination_and_validation(self):
        """Keyset pages remain stable when newer evidence arrives between requests."""
        for _ in range(HISTORY_LIMIT):
            AssetIdentityEvent.objects.create(asset=self.asset, outcome='newcomer_rejected')
        first = self.client.get(self.history_url()).json()
        self.assertEqual(len(first['events']), HISTORY_LIMIT)
        AssetIdentityEvent.objects.create(asset=self.asset, outcome='newcomer_rejected')
        second = self.client.get(self.history_url(), {'before': first['next_before']}).json()
        self.assertEqual([event['id'] for event in second['events']], [self.event.pk])
        self.assertIsNone(second['next_before'])
        for cursor in ('', '-1', '0', 'abc', '9' * 30, '١'):
            self.assertEqual(self.client.get(self.history_url(), {'before': cursor}).status_code, 400)

    def test_queries_do_not_scale_with_fleet_size(self):
        """Fleet polling adds one alert query, irrespective of the number of assets."""
        with CaptureQueriesContext(connection) as single:
            bulk_asset_status_data(Asset.objects.all())
        for index in range(5):
            asset = Asset.objects.create(name=f'Aircraft {index}')
            AssetIdentityEvent.objects.create(asset=asset, outcome='newcomer_rejected')
        with CaptureQueriesContext(connection) as fleet:
            data = bulk_asset_status_data(Asset.objects.all())
        self.assertEqual(len(single), len(fleet))
        self.assertTrue(all(item['identity_alerts']['count'] == 1 for item in data))

    def test_database_constraints_and_writer_defaults(self):
        """Raw FSS inserts have database defaults; invalid outcomes and duplicate UUIDs fail."""
        with self.assertRaises(IntegrityError), transaction.atomic():
            AssetIdentityEvent.objects.create(asset=self.asset, outcome='unknown')
        with self.assertRaises(IntegrityError), transaction.atomic():
            AssetIdentityEvent.objects.create(asset=self.asset, outcome='newcomer_rejected', event_id=self.event.event_id)
        with self.assertRaises(IntegrityError), transaction.atomic():
            AssetIdentityEvent.objects.filter(pk=self.event.pk).update(acknowledged_username='pilot')
        with connection.cursor() as cursor:
            cursor.execute(
                'INSERT INTO assets_assetidentityevent (asset_id, event_id, timestamp, outcome) VALUES (%s, %s, %s, %s)',
                [self.asset.pk, 'a' * 32, timezone.now(), 'newcomer_rejected'],
            )
        raw = AssetIdentityEvent.objects.exclude(pk=self.event.pk).get()
        self.assertEqual(raw.incumbent, {})
        self.assertEqual(raw.newcomer, {})
        self.assertEqual(raw.acknowledged_username, '')
        self.assertIsNotNone(raw.received_at)
