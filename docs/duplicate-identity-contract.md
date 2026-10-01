# Duplicate-identity event contract (FEATURE-05 / FSS todo/77)

The web application owns migration `0017_assetidentityevent`. Deploy it before
an FSS writer that uses this contract. The writer is not implemented by this
web change; no events can be detected from telemetry or old log entries alone.
No aircraft protocol change is required by the web contract.

## FSS writer

Insert one row into `assets_assetidentityevent` for each actual competing
identity resolution. Capture evidence before disconnecting either session.
Do not interpret every `resolveDuplicateIdentity(false)` as a duplicate:
timeout removal and shutdown can also return false.

| Column | Contract |
| --- | --- |
| `id` | Database-generated primary key; omit on insert. |
| `event_id` | Required UUID generated once at resolution; reuse on write retries. Unique. |
| `asset_id` | Required existing local asset primary key. |
| `timestamp` | Required timezone-aware occurrence time from FSS, not delayed writer time. |
| `received_at` | Database receipt time; omit to use database default. |
| `outcome` | Required `newcomer_rejected` or `incumbent_evicted`; describe the actual outcome, not configured policy. |
| `incumbent`, `newcomer` | JSON objects, default `{}`. Optional string keys: `certificate_cn`, `certificate_sha256`, `session_id`, `peer_address`. Omit unavailable keys. Bound each value to 512 characters in the producer. No secrets or certificate PEM data. |
| `acknowledged_at`, `acknowledged_by_id`, `acknowledged_username` | Web-owned. Omit on insert (NULL, NULL, empty string). Never overwrite on retry. |

A retry may use `ON CONFLICT (event_id) DO NOTHING`; never use that UUID for
another occurrence. Both peers can share the same CN, certificate, or address;
these are investigation evidence, not proof of physical aircraft identity.
Use per-connection session IDs to distinguish sessions with cloned credentials.

The later FSS implementation must preserve atomic identity resolution, enqueue
outside the identity lock, and explicitly handle overload/write failure.
These are audit events, not discardable telemetry. Repeated reconnects can
produce an unbounded sequence; the web bounds payloads, not event production.
Any aggregation, durable retry, or loss reporting policy must be settled in FSS
and must not silently suppress new occurrences after acknowledgement.

## Web API

All endpoints require a logged-in user. Event acknowledgement currently follows
the application's existing authenticated-user policy; future SECURITY-01 roles
must cover this action explicitly. POSTs require normal CSRF protection.
Responses are private and not cacheable.

`GET /current/all.json/` adds `identity_alerts` to each active asset:

```json
{
  "count": 12,
  "eviction_count": 1,
  "events": []
}
```

`events` contains up to ten newest unacknowledged events, ordered by local
insertion ID descending. Counts include ALL outstanding events, including
older evictions outside the displayed list. Zero counts and an empty list mean
no recorded outstanding events, not proof that the upstream writer is deployed.
Old peers may omit this field; absence must not be described as an all-clear.

`GET /assets/{asset_id}/identity-events/?before={id}` returns `events` and
`next_before`. Pages contain up to 50 records, newest insertion first, including
acknowledged events. Omit `before` for the first page; null `next_before` ends
pagination. Retired assets' history remains accessible through this endpoint.
New arrivals do not shift subsequent pages. Refresh to see new arrivals.

Each event contains `id`, `event_id`, `timestamp`, `received_at`, `outcome`,
`incumbent`, `newcomer`, `acknowledged_at`, and `acknowledged_by` (username or null).
Timestamps are JSON ISO dates. IDs are scoped to the responding server; the
frontend must use its canonical origin together with the ID.

`POST /assets/{asset_id}/identity-events/{id}/acknowledge/` takes no payload and
returns `{ "event": ... }`. A conditional update records only the first
acknowledgement, with server time, user reference, and username snapshot.
Retries return the existing acknowledgement. A deleted account does not erase
the snapshot. Acknowledging one event cannot clear any later event.
Acknowledgement means seen, not resolved, and does not change command access.

There is no automatic retention or telemetry-pruning rule for these events.
Asset references are protected; retirement preserves event history.

## Validation and later integration

Backend tests tagged `TC-MAV-015` cover persistence and acknowledgement safety;
frontend tests cover the operator surface. FSS still needs both-policy event
insertion and concurrency/queue-failure tests. End-to-end TC-MAV-015 completion
requires generating real competing connections and observing the web warning.
