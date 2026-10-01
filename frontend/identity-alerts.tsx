import React, { useRef, useState } from 'react'

import { AssetServerState, AssetState, getAssetServerURL } from './asset'
import { IdentityEvent, IdentityPeer, ServerState } from './server'

const outcomeText = (event: IdentityEvent): string =>
  event.outcome === 'incumbent_evicted'
    ? 'The existing connection was disconnected; a newcomer claimed this identity.'
    : 'Another connection claimed this identity; the newcomer was rejected.'

function PeerEvidence({ label, peer }: { label: string; peer: IdentityPeer }) {
  const fields = [
    ['Certificate CN', peer.certificate_cn],
    ['Certificate SHA-256', peer.certificate_sha256],
    ['Session', peer.session_id],
    ['Peer address', peer.peer_address]
  ].filter(([, value]) => typeof value === 'string' && value.length > 0)
  return (
    <div>
      <strong>{label}: </strong>
      {fields.length ? fields.map(([name, value]) => `${name}: ${value}`).join('; ') : 'Peer details unavailable'}
    </div>
  )
}

function IdentityEventDetails({ event, disabled, acknowledge }: { event: IdentityEvent; disabled: boolean; acknowledge: (event: IdentityEvent) => void }) {
  return (
    <li>
      <div>
        <time dateTime={event.timestamp}>{event.timestamp}</time> — {outcomeText(event)}
      </div>
      <details>
        <summary>Connection details for event {event.id}</summary>
        <PeerEvidence label="Existing connection" peer={event.incumbent} />
        <PeerEvidence label="Newcomer" peer={event.newcomer} />
      </details>
      {event.acknowledged_at ? (
        <div>
          Acknowledged by {event.acknowledged_by} at {event.acknowledged_at}
        </div>
      ) : (
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={disabled} onClick={() => acknowledge(event)}>
          Acknowledge event {event.id}
        </button>
      )}
    </li>
  )
}

function ServerIdentityAlerts({ server, assetServer }: { server: ServerState; assetServer: AssetServerState }) {
  const [history, setHistory] = useState<{ events: IdentityEvent[]; next_before: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const summary = assetServer.data?.identity_alerts
  const available = server.connected && !!server.userName && !!server.csrfToken

  const request = async (path: string, method: 'GET' | 'POST') => {
    const response = await fetch(getAssetServerURL(server, assetServer, path), {
      method,
      credentials: 'include',
      headers: method === 'POST' ? { 'X-CSRFToken': server.csrfToken ?? '' } : {},
      signal: AbortSignal.timeout(10000)
    })
    if (!response.ok)
      throw new Error(response.status === 403 ? 'Login or CSRF validation required. Refresh and log in to this server.' : `Server returned HTTP ${response.status}.`)
    return response.json()
  }

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current || !available) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed; please retry.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const acknowledge = (event: IdentityEvent) => {
    void run(async () => {
      const data: { event: IdentityEvent } = await request(`identity-events/${event.id}/acknowledge/`, 'POST')
      setHistory((current) => (current ? { ...current, events: current.events.map((item) => (item.id === event.id ? data.event : item)) } : null))
      // Only authoritative polling clears the banner. In-flight/failed polls
      // cannot optimistically hide this event, or any newer unseen occurrence.
      setMessage(`Event ${event.id} acknowledged by ${data.event.acknowledged_by}. Outstanding warnings update on the next successful poll.`)
    })
  }

  const loadHistory = (before?: number) => {
    void run(async () => {
      setHistory(await request(`identity-events/${before === undefined ? '' : `?before=${before}`}`, 'GET'))
    })
  }

  if (!summary) return null
  return (
    <section aria-label={`Identity events on ${assetServer.serverName}`}>
      {summary.count > 0 && (
        <div className={`alert ${summary.eviction_count > 0 ? 'alert-danger' : 'alert-warning'} asset-identity-warning`} role="alert">
          <strong>Duplicate asset identity — {assetServer.serverName}</strong> ({server.url})
          <p>
            {summary.count} unacknowledged event(s); {summary.eviction_count} existing connection(s) evicted. Verify which aircraft is using this identity. Acknowledgement records
            that this warning was seen; it does not resolve the identity conflict.
          </p>
          {!available && <p>Server unavailable or login required. Showing last known warnings.</p>}
          <ul>
            {summary.events.map((event) => (
              <IdentityEventDetails key={event.id} event={event} disabled={!available || busy} acknowledge={acknowledge} />
            ))}
          </ul>
          {summary.count > summary.events.length && (
            <p>
              Showing {summary.events.length} of {summary.count} outstanding events. Open identity history to review older events.
            </p>
          )}
        </div>
      )}
      <button type="button" className="btn btn-sm btn-link" disabled={!available || busy} onClick={() => loadHistory()}>
        Identity history — {assetServer.serverName}
      </button>
      {busy && <p role="status">Updating identity events…</p>}
      {error && <p role="alert">Identity event request failed: {error}</p>}
      {message && <p role="status">{message}</p>}
      {history && (
        <div>
          <h4>Identity history — {assetServer.serverName}</h4>
          <button type="button" className="btn btn-sm btn-link" onClick={() => setHistory(null)}>
            Close history
          </button>
          {!history.events.length && <p>No recorded identity events.</p>}
          <ul>
            {history.events.map((event) => (
              <IdentityEventDetails key={event.id} event={event} disabled={!available || busy} acknowledge={acknowledge} />
            ))}
          </ul>
          {history.next_before !== null && (
            <button type="button" className="btn btn-sm btn-link" disabled={!available || busy} onClick={() => loadHistory(history.next_before!)}>
              Older identity events
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export function AssetIdentityAlerts({ asset, knownServers }: { asset: AssetState; knownServers: Record<string, ServerState> }) {
  return (
    <>
      {Object.entries(asset.servers).map(([origin, assetServer]) =>
        knownServers[origin] ? <ServerIdentityAlerts key={`${origin}:${assetServer.assetPk}`} server={knownServers[origin]} assetServer={assetServer} /> : null
      )}
    </>
  )
}
