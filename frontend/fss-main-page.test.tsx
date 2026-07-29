// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeServerAssets } from './asset'
import { FSSAsset, FSSServerBar } from './fss-main-page'
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

afterEach(cleanup)

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
