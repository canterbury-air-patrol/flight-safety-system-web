// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeServerAssets } from './asset'
import { FSSAsset } from './fss-main-page'
import { AssetStatus, ServerState, createServer } from './server'

const SERVER_KEY = 'https://alpha.example'
const SERVER_NOW = 1_700_000_000_000

const makeServer = (): ServerState => ({
  ...createServer('alpha', '10.0.0.1', 8080, SERVER_KEY),
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
