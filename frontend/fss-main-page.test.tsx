// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeServerAssets } from './asset'
import { FSSAsset, FSSMainPage, FSSServerBar } from './fss-main-page'
import { AssetStatus, ServerState, createServer, serverConnectFailed } from './server'

const SERVER_KEY = 'https://alpha.example'
const SERVER_NOW = 1_700_000_000_000

const makeServer = (name = 'alpha'): ServerState => ({
  ...createServer(name, `10.0.0.${name === 'alpha' ? '1' : '2'}`, 8080, `https://${name}.example`),
  connected: true,
  userName: 'pilot',
  csrfToken: 'csrf-123'
})

const cannedAssetStatus = (connected: boolean): AssetStatus => ({
  asset: { name: 'Drone', pk: 42 },
  connected
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('disconnected asset command controls', () => {
  it('disables every command control when canned status reports no live connection', () => {
    const servers = { [SERVER_KEY]: makeServer() }
    const asset = mergeServerAssets({}, SERVER_KEY, 'alpha', [cannedAssetStatus(false)], SERVER_NOW).Drone

    render(<FSSAsset asset={asset} knownServers={servers} setSelected={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toContain('Commands disabled: alpha: asset disconnected')
    for (const name of ['RTL', 'Hold', 'Altitude', 'Goto', 'Continue', 'Manual', 'DisArm', 'Terminate']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('keeps command controls enabled when canned status reports a live connection', () => {
    const servers = { [SERVER_KEY]: makeServer() }
    const asset = mergeServerAssets({}, SERVER_KEY, 'alpha', [cannedAssetStatus(true)], SERVER_NOW).Drone

    render(<FSSAsset asset={asset} knownServers={servers} setSelected={vi.fn()} />)

    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'RTL' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks rapid duplicate actions and disables every command control while submitting', async () => {
    let resolveRequest: ((response: { ok: boolean; status: number }) => void) | undefined
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const servers = { [SERVER_KEY]: makeServer() }
    const asset = mergeServerAssets({}, SERVER_KEY, 'alpha', [cannedAssetStatus(true)], SERVER_NOW).Drone

    render(<FSSAsset asset={asset} knownServers={servers} setSelected={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'RTL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))

    await waitFor(() => {
      for (const name of ['RTL', 'Hold', 'Altitude', 'Goto', 'Continue', 'Manual', 'DisArm', 'Terminate']) {
        expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveRequest!({ ok: true, status: 200 })
    await waitFor(() => expect((screen.getByRole('button', { name: 'RTL' }) as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('asset command rendering', () => {
  it('shows GOTO coordinates when latitude and longitude are exactly zero', () => {
    const servers = { [SERVER_KEY]: makeServer() }
    const status: AssetStatus = {
      ...cannedAssetStatus(true),
      command: {
        timestamp: new Date(SERVER_NOW).toISOString(),
        command: 'Goto Position',
        command_code: 'GOTO',
        lat: 0,
        lng: 0,
        ack_state: 'actioned'
      }
    }
    const asset = mergeServerAssets({}, SERVER_KEY, 'alpha', [status], SERVER_NOW).Drone

    render(<FSSAsset asset={asset} knownServers={servers} setSelected={vi.fn()} />)

    expect(screen.getByText('Goto Position 0 0.000 N, 0 0.000 E')).toBeTruthy()
  })
})

describe('command retry alert', () => {
  it('offers an explicit retry and clears the failure after that peer succeeds', async () => {
    let commandAttempts = 0
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        commandAttempts += 1
        return commandAttempts === 1 ? { ok: false, status: 500, statusText: 'Server Error' } : { ok: true, status: 200 }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          currentUser: 'pilot',
          csrfToken: 'csrf-123',
          server_now: SERVER_NOW,
          servers: [],
          assets: [cannedAssetStatus(true)]
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<FSSMainPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'RTL' }))

    const retry = await screen.findByRole('button', { name: 'Retry failed servers' })
    expect(screen.getByText('Command Failure:').closest('[role="alert"]')!.textContent).toContain('Failed on: direct: 500 Server Error')
    fireEvent.click(retry)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry failed servers' })).toBeNull())
    expect(commandAttempts).toBe(2)
    const commandRequests = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
    const operationIds = commandRequests.map((call) => (call[1]!.body as URLSearchParams).get('operation_id'))
    expect(new Set(operationIds).size).toBe(1)
  })
})

describe('FSS server redundancy status', () => {
  it('reports nominal status when at least two FSS servers are reachable', () => {
    render(<FSSServerBar knownServers={[makeServer('alpha'), makeServer('beta')]} />)

    expect(screen.getByRole('status').textContent).toBe('Systems: Nominal — 2 FSS servers reachable')
  })

  // satisfies: TC-WEB-015
  it('reports critical status and identifies an unreachable server when redundancy is lost', () => {
    const offline = serverConnectFailed(makeServer('beta'))

    render(<FSSServerBar knownServers={[makeServer('alpha'), offline]} />)

    expect(screen.getByRole('status').textContent).toBe('Systems: Critical — Redundancy lost: 1 FSS server reachable; 2 required')
    expect(screen.getByText('beta').classList.contains('server-label-failure')).toBe(true)
    expect(screen.getByText('Unreachable')).toBeTruthy()
  })

  it('reports critical status when only one server is configured and reachable', () => {
    render(<FSSServerBar knownServers={[makeServer('alpha')]} />)

    expect(screen.getByRole('status').textContent).toContain('Systems: Critical')
  })

  it('reports critical status when no servers are reachable', () => {
    render(<FSSServerBar knownServers={[serverConnectFailed(makeServer('alpha')), serverConnectFailed(makeServer('beta'))]} />)

    expect(screen.getByRole('status').textContent).toBe('Systems: Critical — Redundancy lost: 0 FSS servers reachable; 2 required')
  })
})
