import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssetState, createAsset, mergeServerAssets, sendAssetCommand } from './asset'
import { ServerState, createServer } from './server'
import { AssetStatus } from './server'

const makeServer = (name: string, csrfToken = 'tok', url = `https://${name}.example`): ServerState => ({
  ...createServer(name, '10.0.0.1', 8080, url),
  csrfToken
})

const makeAsset = (name: string, servers: Array<{ serverKey: string; serverName?: string; assetPk: number }>): AssetState => ({
  name,
  servers: Object.fromEntries(servers.map((s) => [s.serverKey, { serverKey: s.serverKey, serverName: s.serverName ?? s.serverKey, assetPk: s.assetPk }]))
})

const statusFor = (name: string, pk: number): AssetStatus => ({ asset: { name, pk } })

describe('sendAssetCommand', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to the per-server command URL with the command body and CSRF header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha', 'csrf-123') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 42 }])

    await sendAssetCommand(servers, asset, { command: 'RTL' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://alpha.example/assets/42/command/set/')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('include')
    expect(options.headers['X-CSRFToken']).toBe('csrf-123')
    const body = options.body as URLSearchParams
    expect(body.get('command')).toBe('RTL')
  })

  it('serialises GOTO coordinates into the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 7 }])

    await sendAssetCommand(servers, asset, { command: 'GOTO', latitude: -43.5, longitude: 172.6 })

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get('command')).toBe('GOTO')
    expect(body.get('latitude')).toBe('-43.5')
    expect(body.get('longitude')).toBe('172.6')
  })

  it('dispatches to every server the asset is known on', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha'), beta: makeServer('beta') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2 }
    ])

    await sendAssetCommand(servers, asset, { command: 'HOLD' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('https://alpha.example/assets/1/command/set/')
    expect(urls).toContain('https://beta.example/assets/2/command/set/')
  })

  it('skips servers that are not in the known-servers map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'ghost', assetPk: 2 }
    ])

    await sendAssetCommand(servers, asset, { command: 'RTL' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://alpha.example/assets/1/command/set/')
  })

  it('aggregates partial failures and reports how many servers succeeded', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha'), beta: makeServer('beta') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2 }
    ])

    await expect(sendAssetCommand(servers, asset, { command: 'RTL' })).rejects.toThrow(/queued on 1 of 2 server\(s\).*beta: 500 Server Error/s)
  })

  it('surfaces a clear message when a server returns 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    await expect(sendAssetCommand(servers, asset, { command: 'RTL' })).rejects.toThrow(/not authenticated/)
  })

  it('dispatches only once when legacy aliases point at the same origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const origin = 'https://fss1.example'
    const servers = {
      direct: makeServer('direct', 'tok', origin),
      fss1: makeServer('fss1', 'tok', `${origin}:443/`)
    }
    const asset = makeAsset('Drone', [
      { serverKey: 'direct', assetPk: 1 },
      { serverKey: 'fss1', assetPk: 1 }
    ])

    await sendAssetCommand(servers, asset, { command: 'RTL' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('mergeServerAssets', () => {
  it('adds a previously-unseen asset keyed by name', () => {
    const result = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])

    expect(Object.keys(result)).toEqual(['Drone'])
    expect(result.Drone.servers['alpha-origin'].assetPk).toBe(5)
    expect(result.Drone.servers['alpha-origin'].serverName).toBe('alpha')
    expect(result.Drone.selectedServerKey).toBe('alpha-origin')
  })

  it('merges a second server into an existing asset without dropping the first', () => {
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const result = mergeServerAssets(first, 'beta-origin', 'beta', [statusFor('Drone', 9)])

    expect(Object.keys(result.Drone.servers).sort()).toEqual(['alpha-origin', 'beta-origin'])
    expect(result.Drone.servers['alpha-origin'].assetPk).toBe(5)
    expect(result.Drone.servers['beta-origin'].assetPk).toBe(9)
  })

  it('keeps an already-selected server when merging more data', () => {
    const existing = { Drone: { ...createAsset('Drone'), selectedServerKey: 'beta-origin' } }
    const result = mergeServerAssets(existing, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])

    expect(result.Drone.selectedServerKey).toBe('beta-origin')
  })

  it('records the server clock alongside the merged data', () => {
    const result = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)], 1700000000000)

    expect(result.Drone.servers['alpha-origin'].serverNow).toBe(1700000000000)
  })

  it('drops a server entry once that server no longer reports the asset', () => {
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const result = mergeServerAssets(first, 'alpha-origin', 'alpha', [])

    expect(result.Drone).toBeUndefined()
  })

  it('prunes only the reporting server, keeping other servers intact', () => {
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const both = mergeServerAssets(first, 'beta-origin', 'beta', [statusFor('Drone', 9)])
    const result = mergeServerAssets(both, 'alpha-origin', 'alpha', [])

    expect(Object.keys(result.Drone.servers)).toEqual(['beta-origin'])
  })

  it('falls back to a remaining server when the pruned one was selected', () => {
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const both = mergeServerAssets(first, 'beta-origin', 'beta', [statusFor('Drone', 9)])
    const result = mergeServerAssets(both, 'alpha-origin', 'alpha', [])

    expect(result.Drone.selectedServerKey).toBe('beta-origin')
  })

  it('does not prune a server that simply was not polled this cycle', () => {
    // A failed/unreachable/unauthenticated poll never calls mergeServerAssets
    // for that server at all - only a *different* server's successful poll
    // runs here, and it must not touch entries it has no data about.
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const result = mergeServerAssets(first, 'beta-origin', 'beta', [])

    expect(result.Drone.servers['alpha-origin'].assetPk).toBe(5)
  })

  it('leaves an asset untouched when the same server reports it again', () => {
    const first = mergeServerAssets({}, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])
    const result = mergeServerAssets(first, 'alpha-origin', 'alpha', [statusFor('Drone', 5)])

    expect(Object.keys(result)).toEqual(['Drone'])
    expect(result.Drone.servers['alpha-origin'].assetPk).toBe(5)
  })
})
