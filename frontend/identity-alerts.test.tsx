// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeServerAssets } from './asset'
import { FSSAsset } from './fss-main-page'
import { AssetStatus, IdentityEvent, ServerState, createServer, serverConnectFailed, serverUnauthenticated } from './server'

const origin = 'https://alpha.example'
const betaOrigin = 'https://beta.example'
const server: ServerState = { ...createServer('alpha', '127.0.0.1', 8080, origin), connected: true, userName: 'pilot', csrfToken: 'token' }
const event: IdentityEvent = {
  id: 12,
  event_id: 'uuid',
  timestamp: '2026-01-01T00:00:00Z',
  received_at: '2026-01-01T00:00:01Z',
  outcome: 'newcomer_rejected',
  incumbent: { certificate_cn: 'Drone', session_id: 'old' },
  newcomer: { certificate_cn: 'Drone', session_id: 'new' },
  acknowledged_at: null,
  acknowledged_by: null
}
const status = (events = [event], count = events.length, evictionCount = 0): AssetStatus => ({
  asset: { pk: 42, name: 'Drone' },
  connected: true,
  identity_alerts: { count, eviction_count: evictionCount, events }
})
const assetFrom = (data = status()) => mergeServerAssets({}, origin, 'alpha', [data]).Drone

const response = (data: unknown) => ({ ok: true, json: async () => data })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TC-MAV-015 duplicate identity alerts', () => {
  it('shows both outcomes across server tabs, preserves eviction severity outside the bounded list, and leaves commands available', () => {
    const beta = { ...server, name: 'beta', url: betaOrigin }
    let assets = mergeServerAssets({}, origin, 'alpha', [status([event], 15, 1)])
    assets = mergeServerAssets(assets, betaOrigin, 'beta', [status([{ ...event, outcome: 'incumbent_evicted' }], 1, 1)])
    const { container } = render(<FSSAsset asset={assets.Drone} knownServers={{ [origin]: server, [betaOrigin]: beta }} setSelected={vi.fn()} />)
    expect(screen.getByText(/newcomer was rejected/)).toBeTruthy()
    expect(screen.getByText(/existing connection was disconnected/)).toBeTruthy()
    expect(screen.getByText(/Showing 1 of 15/)).toBeTruthy()
    expect(container.querySelectorAll('.asset-identity-warning.alert-danger')).toHaveLength(2)
    expect((screen.getByRole('button', { name: 'RTL' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByText(/Session: old/)).toHaveLength(2)
    expect(screen.getAllByText(/Session: new/)).toHaveLength(2)
  })

  it('retains old warnings through failed polls or login expiry and disables acknowledgements', () => {
    const asset = assetFrom()
    const { rerender } = render(<FSSAsset asset={asset} knownServers={{ [origin]: serverConnectFailed(server) }} setSelected={vi.fn()} />)
    expect(screen.getByText(/Showing last known warnings/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Acknowledge event 12' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<FSSAsset asset={asset} knownServers={{ [origin]: serverUnauthenticated(server) }} setSelected={vi.fn()} />)
    expect(screen.getByText(/newcomer was rejected/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Acknowledge event 12' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('acknowledges only the selected peer event, survives a newer arrival, and waits for authoritative polling', async () => {
    let resolveRequest!: (value: unknown) => void
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<FSSAsset asset={assetFrom()} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge event 12' }))
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge event 12' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `${origin}/assets/42/identity-events/12/acknowledge/`,
      expect.objectContaining({ method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': 'token' } })
    )
    const newer = { ...event, id: 13 }
    rerender(<FSSAsset asset={assetFrom(status([newer, event]))} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    resolveRequest(response({ event: { ...event, acknowledged_at: '2026-10-01T00:00:00Z', acknowledged_by: 'pilot' } }))
    await waitFor(() => expect(screen.getByText(/Event 12 acknowledged by pilot/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Acknowledge event 13' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Acknowledge event 12' })).toBeTruthy()
    rerender(<FSSAsset asset={assetFrom(status([newer]))} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Acknowledge event 12' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Acknowledge event 13' })).toBeTruthy()
  })

  it('keeps warnings visible on failed acknowledgement and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    render(<FSSAsset asset={assetFrom()} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge event 12' }))
    await waitFor(() => expect(screen.getByText(/Login or CSRF validation required/)).toBeTruthy())
    expect(screen.getByText(/newcomer was rejected/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Acknowledge event 12' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows persistent acknowledgement history with bounded older pages and no outstanding banner', async () => {
    const acknowledged = { ...event, acknowledged_at: '2026-10-01T00:00:00Z', acknowledged_by: 'pilot' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ events: [acknowledged], next_before: 12 }))
      .mockResolvedValueOnce(response({ events: [{ ...event, id: 1 }], next_before: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(<FSSAsset asset={assetFrom(status([]))} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Identity history — alpha' }))
    await waitFor(() => expect(screen.getByText(/Acknowledged by pilot at/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Older identity events' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acknowledge event 1' })).toBeTruthy())
    expect(fetchMock).toHaveBeenLastCalledWith(`${origin}/assets/42/identity-events/?before=12`, expect.objectContaining({ method: 'GET', credentials: 'include' }))
    expect(screen.queryByRole('button', { name: 'Older identity events' })).toBeNull()
  })

  it('treats older peers as unsupported and keeps equal event IDs isolated by origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ event: { ...event, acknowledged_at: event.timestamp, acknowledged_by: 'pilot' } }))
    vi.stubGlobal('fetch', fetchMock)
    const oldStatus = { asset: { pk: 42, name: 'Drone' }, connected: true }
    const { rerender } = render(<FSSAsset asset={assetFrom(oldStatus)} knownServers={{ [origin]: server }} setSelected={vi.fn()} />)
    expect(screen.queryByText(/Identity history/)).toBeNull()
    let assets = mergeServerAssets({}, origin, 'alpha', [status()])
    assets = mergeServerAssets(assets, betaOrigin, 'beta', [status()])
    rerender(<FSSAsset asset={assets.Drone} knownServers={{ [origin]: server, [betaOrigin]: { ...server, name: 'beta', url: betaOrigin } }} setSelected={vi.fn()} />)
    fireEvent.click(within(screen.getByRole('region', { name: 'Identity events on beta' })).getByRole('button', { name: 'Acknowledge event 12' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(`${betaOrigin}/assets/42/identity-events/12/acknowledge/`)
  })
})
