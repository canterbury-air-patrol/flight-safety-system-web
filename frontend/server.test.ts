import { describe, expect, it } from 'vitest'

import {
  ServerState,
  StatusData,
  canonicalServerOrigin,
  createServer,
  mergeServerPollResult,
  reconcileServerTopology,
  serverConnectFailed,
  serverTopologyMismatch,
  serverUnauthenticated
} from './server'

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

  it('stores canonical advertised origins from the latest successful snapshot', () => {
    const alphaOrigin = canonicalServerOrigin('https://alpha.example')
    const current = { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) }
    const result = mergeServerPollResult(
      current,
      alphaOrigin,
      statusData({ servers: [{ name: 'beta', address: '10.0.0.2', client_port: 9090, url: 'https://BETA.example:443/' }] })
    )

    expect(result[alphaOrigin].advertisedOrigins).toEqual(['https://beta.example'])
  })
})

describe('reconcileServerTopology', () => {
  const alphaOrigin = canonicalServerOrigin('https://alpha.example')
  const betaOrigin = canonicalServerOrigin('https://beta.example')
  const gammaOrigin = canonicalServerOrigin('https://gamma.example')

  const details = (name: string, url: string): { name: string; address: string; client_port: number; url: string } => ({
    name,
    address: new URL(url).hostname,
    client_port: 9090,
    url
  })

  it('removes a peer omitted from the direct server latest successful snapshot', () => {
    let servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin)] })
    )
    servers = reconcileServerTopology(servers, alphaOrigin)

    servers = mergeServerPollResult(servers, alphaOrigin, statusData())
    servers = reconcileServerTopology(servers, alphaOrigin)

    expect(Object.keys(servers)).toEqual([alphaOrigin])
  })

  it('retains the direct root even when no snapshot advertises it', () => {
    const servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('direct', '127.0.0.1', 0, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin)] })
    )

    expect(Object.keys(reconcileServerTopology(servers, alphaOrigin)).sort()).toEqual([alphaOrigin, betaOrigin])
  })

  it('retains topology across failed and unauthenticated polls', () => {
    let servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin)] })
    )

    servers = { ...servers, [alphaOrigin]: serverConnectFailed(servers[alphaOrigin]) }
    expect(Object.keys(reconcileServerTopology(servers, alphaOrigin)).sort()).toEqual([alphaOrigin, betaOrigin])

    servers = { ...servers, [alphaOrigin]: serverUnauthenticated(servers[alphaOrigin]) }
    expect(Object.keys(reconcileServerTopology(servers, alphaOrigin)).sort()).toEqual([alphaOrigin, betaOrigin])
  })

  it('keeps a peer advertised by another retained server and reports disagreement', () => {
    let servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin), details('gamma', gammaOrigin)] })
    )
    servers = mergeServerPollResult(servers, gammaOrigin, statusData({ servers: [details('alpha', alphaOrigin), details('beta', betaOrigin)] }))
    servers = mergeServerPollResult(servers, alphaOrigin, statusData({ servers: [details('gamma', gammaOrigin)] }))
    servers = reconcileServerTopology(servers, alphaOrigin)

    expect(Object.keys(servers).sort()).toEqual([alphaOrigin, betaOrigin, gammaOrigin])
    expect(serverTopologyMismatch(Object.values(servers)).map((snapshot) => snapshot.serverName)).toEqual(['alpha', 'gamma'])
  })

  it('replaces an obsolete peer URL without disturbing the root', () => {
    let servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin)] })
    )
    servers = reconcileServerTopology(servers, alphaOrigin)

    servers = mergeServerPollResult(servers, alphaOrigin, statusData({ servers: [details('gamma', gammaOrigin)] }))
    servers = reconcileServerTopology(servers, alphaOrigin)

    expect(Object.keys(servers).sort()).toEqual([alphaOrigin, gammaOrigin])
  })

  it('treats symmetric peer lists as the same complete topology', () => {
    let servers = mergeServerPollResult(
      { [alphaOrigin]: createServer('alpha', '10.0.0.1', 8080, alphaOrigin) },
      alphaOrigin,
      statusData({ servers: [details('beta', betaOrigin)] })
    )
    servers = mergeServerPollResult(servers, betaOrigin, statusData({ servers: [details('alpha', alphaOrigin)] }))

    expect(serverTopologyMismatch(Object.values(servers))).toEqual([])
  })
})
