import { describe, expect, it } from 'vitest'

import { ServerState, StatusData, createServer, mergeServerPollResult } from './server'

const statusData = (overrides: Partial<StatusData> = {}): StatusData => ({
  csrfToken: 'tok',
  servers: [],
  assets: [],
  ...overrides
})

describe('mergeServerPollResult', () => {
  it('updates the polled server with the data from its response', () => {
    const current: Record<string, ServerState> = { alpha: createServer('alpha', '10.0.0.1', 8080, 'https://alpha.example') }
    const result = mergeServerPollResult(current, 'alpha', statusData({ currentUser: 'pilot', csrfToken: 'fresh', assets: [{ asset: { name: 'Drone', pk: 1 } }] }))

    expect(result.alpha.connected).toBe(true)
    expect(result.alpha.userName).toBe('pilot')
    expect(result.alpha.csrfToken).toBe('fresh')
    expect(result.alpha.assets).toHaveLength(1)
    expect(result.alpha.status).toBe('Known Assets: 1')
  })

  it('discovers servers advertised by the polled server', () => {
    const current: Record<string, ServerState> = { alpha: createServer('alpha', '10.0.0.1', 8080, 'https://alpha.example') }
    const result = mergeServerPollResult(current, 'alpha', statusData({ servers: [{ name: 'beta', address: '10.0.0.2', client_port: 9090, url: 'https://beta.example' }] }))

    expect(Object.keys(result).sort()).toEqual(['alpha', 'beta'])
    expect(result.beta.connected).toBe(false)
    expect(result.beta.url).toBe('https://beta.example')
    expect(result.beta.clientPort).toBe(9090)
  })

  it('does not clobber an already-known server when it is re-advertised', () => {
    const current: Record<string, ServerState> = {
      alpha: createServer('alpha', '10.0.0.1', 8080, 'https://alpha.example'),
      beta: { ...createServer('beta', '10.0.0.2', 9090, 'https://beta.example'), connected: true, userName: 'pilot' }
    }
    const result = mergeServerPollResult(current, 'alpha', statusData({ servers: [{ name: 'beta', address: '10.0.0.2', client_port: 9090, url: 'https://beta.example' }] }))

    expect(result.beta.connected).toBe(true)
    expect(result.beta.userName).toBe('pilot')
  })
})
