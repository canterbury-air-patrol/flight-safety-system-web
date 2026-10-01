"""Bounded duplicate-identity summaries, history and durable acknowledgement."""

from django.db.models import Count, F, Q, Window
from django.db.models.functions import RowNumber
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from fss.decorators import login_required_api

from .models import Asset, AssetIdentityEvent

SUMMARY_LIMIT = 10
HISTORY_LIMIT = 50


def format_event(event):
    """Expose evidence and the durable first acknowledgement, never account IDs."""
    return {
        'id': event.pk,
        'event_id': str(event.event_id),
        'timestamp': event.timestamp,
        'received_at': event.received_at,
        'outcome': event.outcome,
        'incumbent': event.incumbent,
        'newcomer': event.newcomer,
        'acknowledged_at': event.acknowledged_at,
        'acknowledged_by': event.acknowledged_username or None,
    }


def identity_alert_summaries(asset_ids):
    """One query bounds evidence per asset without hiding count or eviction severity."""
    summaries = {}
    events = AssetIdentityEvent.objects.filter(
        asset_id__in=asset_ids, acknowledged_at__isnull=True,
    ).annotate(
        pending_count=Window(Count('pk'), partition_by=[F('asset_id')]),
        eviction_count=Window(Count('pk', filter=Q(outcome='incumbent_evicted')), partition_by=[F('asset_id')]),
        row_number=Window(RowNumber(), partition_by=[F('asset_id')], order_by=F('pk').desc()),
    ).filter(row_number__lte=SUMMARY_LIMIT).order_by('asset_id', '-pk')
    for event in events:
        summary = summaries.setdefault(event.asset_id, {
            'count': event.pending_count, 'eviction_count': event.eviction_count, 'events': [],
        })
        summary['events'].append(format_event(event))
    return summaries


def private_json(data):
    """Prevent operator evidence from being cached by shared intermediaries."""
    response = JsonResponse(data)
    response['Cache-Control'] = 'private, no-store'
    return response


@login_required_api
@require_GET
def identity_event_history(request, asset_id):
    """Keyset history includes acknowledged events and retired assets."""
    get_object_or_404(Asset, pk=asset_id)
    events = AssetIdentityEvent.objects.filter(asset_id=asset_id).order_by('-pk')
    before = request.GET.get('before')
    if before is not None:
        if not before.isascii() or not before.isdecimal() or len(before) > 19 or not 0 < int(before) <= 9223372036854775807:
            return HttpResponseBadRequest('Invalid history cursor')
        events = events.filter(pk__lt=int(before))
    page = list(events[:HISTORY_LIMIT + 1])
    return private_json({
        'events': [format_event(event) for event in page[:HISTORY_LIMIT]],
        'next_before': page[HISTORY_LIMIT - 1].pk if len(page) > HISTORY_LIMIT else None,
    })


@login_required_api
@require_POST
def identity_event_acknowledge(request, asset_id, event_id):
    """A conditional update preserves the first actor and cannot acknowledge new events."""
    event = get_object_or_404(AssetIdentityEvent, pk=event_id, asset_id=asset_id)
    AssetIdentityEvent.objects.filter(pk=event.pk, acknowledged_at__isnull=True).update(
        acknowledged_at=timezone.now(), acknowledged_by=request.user,
        acknowledged_username=request.user.get_username(),
    )
    event.refresh_from_db()
    return private_json({'event': format_event(event)})
