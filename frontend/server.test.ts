import { describe, expect, it } from 'vitest'

import { ServerState, StatusData, canonicalServerOrigin, createServer, mergeServerPollResult } from './server'

const statusData = (overrides: Partial<StatusData> = {}): StatusData => ({
  csrfToken: 'tok',
  servers: [],
  assets: [],
  ...overrides
})

describe('mergeServerPollResult', () => {
  it('updates the polled server with the data from its response', () => {
    const alphaOrigin = canonicalServerOrigin('https://alpha.example')
    const current: Record<string, ServerState> = { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) }
    const result = mergeServerPollResult(current, alphaOrigin, statusData({ currentUser: 'pilot', csrfToken: 'fresh', assets: [{ asset: { name: 'Drone', pk: 1 } }] }))

    expect(result[alphaOrigin].connected).toBe(true)
    expect(result[alphaOrigin].userName).toBe('pilot')
    expect(result[alphaOrigin].csrfToken).toBe('fresh')
    expect(result[alphaOrigin].assets).toHaveLength(1)
    expect(result[alphaOrigin].status).toBe('Known Assets: 1')
  })

  it('discovers servers advertised by the polled server', () => {
    const alphaOrigin = canonicalServerOrigin('https://alpha.example')
    const betaOrigin = canonicalServerOrigin('https://beta.example')
    const current: Record<string, ServerState> = { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) }
    const result = mergeServerPollResult(current, alphaOrigin, statusData({ servers: [{ name: 'beta', address: '10.0.0.2', client_port: 9090, url: betaOrigin }] }))

    expect(Object.keys(result).sort()).toEqual([alphaOrigin, betaOrigin])
    expect(result[betaOrigin].connected).toBe(false)
    expect(result[betaOrigin].url).toBe(betaOrigin)
    expect(result[betaOrigin].clientPort).toBe(9090)
  })

  it('does not clobber an already-known server when it is re-advertised', () => {
    const alphaOrigin = canonicalServerOrigin('https://alpha.example')
    const betaOrigin = canonicalServerOrigin('https://beta.example')
    const current: Record<string, ServerState> = {
      [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin),
      [betaOrigin]: { ...createServer('beta', '10.0.0.2', 9090, betaOrigin), connected: true, userName: 'pilot' }
    }
    const result = mergeServerPollResult(current, alphaOrigin, statusData({ servers: [{ name: 'beta', address: '10.0.0.2', client_port: 9090, url: betaOrigin }] }))

    expect(result[betaOrigin].connected).toBe(true)
    expect(result[betaOrigin].userName).toBe('pilot')
  })

  it('collapses the direct alias into an advertised server with the same canonical origin', () => {
    const localOrigin = canonicalServerOrigin('https://fss1.example')
    const current: Record<string, ServerState> = {
      [localOrigin]: createServer('direct', '127.0.0.1', 0, localOrigin)
    }
    const result = mergeServerPollResult(
      current,
      localOrigin,
      statusData({ servers: [{ name: 'fss1', address: 'fss1.example', client_port: 20202, url: 'https://FSS1.example:443/' }] })
    )

    expect(Object.keys(result)).toEqual([localOrigin])
    expect(result[localOrigin].name).toBe('fss1')
    expect(result[localOrigin].connected).toBe(true)
  })

  it('keeps same-named servers on distinct origins separate', () => {
    const firstOrigin = canonicalServerOrigin('https://fss1.example')
    const secondOrigin = canonicalServerOrigin('https://fss2.example')
    const current: Record<string, ServerState> = {
      [firstOrigin]: createServer('operations', '10.0.0.1', 8080, firstOrigin)
    }
    const result = mergeServerPollResult(current, firstOrigin, statusData({ servers: [{ name: 'operations', address: '10.0.0.2', client_port: 9090, url: secondOrigin }] }))

    expect(Object.keys(result).sort()).toEqual([firstOrigin, secondOrigin])
    expect(result[firstOrigin].url).toBe(firstOrigin)
    expect(result[secondOrigin].url).toBe(secondOrigin)
  })
})
