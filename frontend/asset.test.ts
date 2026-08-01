import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssetState, CommandDispatchError, createAsset, mergeServerAssets, sendAssetCommand } from './asset'
import { ServerState, createServer } from './server'
import { AssetStatus } from './server'

const makeServer = (name: string, csrfToken = 'tok', url = `https://${name}.example`): ServerState => ({
  ...createServer(name, '10.0.0.1', 8080, url),
  connected: true,
  userName: 'pilot',
  csrfToken
})

const makeAsset = (name: string, servers: Array<{ serverKey: string; serverName?: string; assetPk: number; connected?: boolean }>): AssetState => ({
  name,
  servers: Object.fromEntries(
    servers.map((s) => [
      s.serverKey,
      {
        serverName: s.serverName ?? s.serverKey,
        assetPk: s.assetPk,
        data: statusFor(name, s.assetPk, s.connected ?? true)
      }
    ])
  )
})

const statusFor = (name: string, pk: number, connected = true): AssetStatus => ({ asset: { name, pk }, connected })

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
    expect(body.get('operation_id')).toMatch(/^[0-9a-f-]{36}$/)
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

  it('prepares destructive commands and submits the returned token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ confirmation_token: 'confirm-123' })
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha', 'csrf-123') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 42 }])

    await sendAssetCommand(servers, asset, { command: 'TERM' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://alpha.example/assets/42/command/confirm/')
    expect((fetchMock.mock.calls[0][1].body as URLSearchParams).get('command')).toBe('TERM')
    expect(fetchMock.mock.calls[1][0]).toBe('https://alpha.example/assets/42/command/set/')
    const commandBody = fetchMock.mock.calls[1][1].body as URLSearchParams
    expect(commandBody.get('command')).toBe('TERM')
    expect(commandBody.get('confirmation_token')).toBe('confirm-123')
    expect(commandBody.get('operation_id')).toBe((fetchMock.mock.calls[0][1].body as URLSearchParams).get('operation_id'))
  })

  it('uses a separate confirmation token for each server target', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/command/confirm/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ confirmation_token: url.includes('alpha') ? 'alpha-token' : 'beta-token' })
        }
      }
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha'), beta: makeServer('beta') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2 }
    ])

    await sendAssetCommand(servers, asset, { command: 'DISARM' })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const setRequests = fetchMock.mock.calls.filter((call) => (call[0] as string).endsWith('/command/set/'))
    expect((setRequests.find((call) => (call[0] as string).includes('alpha'))![1].body as URLSearchParams).get('confirmation_token')).toBe('alpha-token')
    expect((setRequests.find((call) => (call[0] as string).includes('beta'))![1].body as URLSearchParams).get('confirmation_token')).toBe('beta-token')
  })

  it('does not submit a destructive command when confirmation fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    await expect(sendAssetCommand(servers, asset, { command: 'TERM' })).rejects.toThrow(/alpha: 500 Server Error/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://alpha.example/assets/1/command/confirm/')
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
    const operationIds = fetchMock.mock.calls.map((call) => (call[1].body as URLSearchParams).get('operation_id'))
    expect(new Set(operationIds).size).toBe(1)
  })

  it('uses a new operation ID for a separate operator action', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    await sendAssetCommand(servers, asset, { command: 'RTL' })
    await sendAssetCommand(servers, asset, { command: 'RTL' })

    const operationIds = fetchMock.mock.calls.map((call) => (call[1].body as URLSearchParams).get('operation_id'))
    expect(operationIds[0]).not.toBe(operationIds[1])
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

  it('does not submit when no server reports a live asset connection', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1, connected: false }])

    await expect(sendAssetCommand(servers, asset, { command: 'RTL' })).rejects.toThrow(/Drone has no commandable server.*alpha: asset disconnected/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips and reports an unauthenticated peer while dispatching to a commandable server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = {
      alpha: makeServer('alpha'),
      beta: { ...makeServer('beta'), userName: undefined, csrfToken: undefined }
    }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2 }
    ])

    await expect(sendAssetCommand(servers, asset, { command: 'RTL' })).rejects.toThrow(/queued on 1 of 2 server\(s\).*Skipped: beta: login required/s)
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

  it('retries only unresolved peers with the original operation ID', async () => {
    let betaAttempts = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('beta') && ++betaAttempts === 1) {
        return { ok: false, status: 500, statusText: 'Server Error' }
      }
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha'), beta: makeServer('beta') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2 }
    ])

    let failure: CommandDispatchError | undefined
    try {
      await sendAssetCommand(servers, asset, { command: 'RTL' })
    } catch (error) {
      failure = error as CommandDispatchError
    }
    expect(failure).toBeInstanceOf(CommandDispatchError)
    await failure!.retry()

    const alphaRequests = fetchMock.mock.calls.filter((call) => (call[0] as string).includes('alpha'))
    const betaRequests = fetchMock.mock.calls.filter((call) => (call[0] as string).includes('beta'))
    expect(alphaRequests).toHaveLength(1)
    expect(betaRequests).toHaveLength(2)
    const operationIds = fetchMock.mock.calls.map((call) => (call[1].body as URLSearchParams).get('operation_id'))
    expect(new Set(operationIds).size).toBe(1)
  })

  it('retries a previously skipped peer without resending to a successful peer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha'), beta: makeServer('beta') }
    const asset = makeAsset('Drone', [
      { serverKey: 'alpha', assetPk: 1 },
      { serverKey: 'beta', assetPk: 2, connected: false }
    ])

    let failure: CommandDispatchError | undefined
    try {
      await sendAssetCommand(servers, asset, { command: 'RTL' })
    } catch (error) {
      failure = error as CommandDispatchError
    }
    await failure!.retry()

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['https://alpha.example/assets/1/command/set/', 'https://beta.example/assets/2/command/set/'])
  })

  it('preserves destructive confirmation evidence when retrying an uncertain peer', async () => {
    let setAttempts = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/command/confirm/')) {
        return { ok: true, status: 200, json: async () => ({ confirmation_token: 'confirm-123' }) }
      }
      setAttempts += 1
      return setAttempts === 1 ? { ok: false, status: 500, statusText: 'Server Error' } : { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    let failure: CommandDispatchError | undefined
    try {
      await sendAssetCommand(servers, asset, { command: 'TERM' })
    } catch (error) {
      failure = error as CommandDispatchError
    }
    await failure!.retry()

    const confirmRequests = fetchMock.mock.calls.filter((call) => (call[0] as string).endsWith('/command/confirm/'))
    const setRequests = fetchMock.mock.calls.filter((call) => (call[0] as string).endsWith('/command/set/'))
    expect(confirmRequests).toHaveLength(1)
    expect(setRequests).toHaveLength(2)
    expect((setRequests[0][1].body as URLSearchParams).get('confirmation_token')).toBe('confirm-123')
    expect((setRequests[1][1].body as URLSearchParams).get('confirmation_token')).toBe('confirm-123')
  })

  it('refreshes expired destructive evidence against the same operation on retry', async () => {
    let confirmAttempts = 0
    let setAttempts = 0
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/command/confirm/')) {
        confirmAttempts += 1
        return { ok: true, status: 200, json: async () => ({ confirmation_token: `confirm-${confirmAttempts}` }) }
      }
      setAttempts += 1
      if (setAttempts === 1) return { ok: false, status: 500, statusText: 'Server Error' }
      if (setAttempts === 2) return { ok: false, status: 400, text: async () => 'Valid confirmation required' }
      return { ok: true, status: 200 }
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    let failure: CommandDispatchError | undefined
    try {
      await sendAssetCommand(servers, asset, { command: 'DISARM' })
    } catch (error) {
      failure = error as CommandDispatchError
    }
    await failure!.retry()

    const requests = fetchMock.mock.calls.map((call) => ({
      url: call[0] as string,
      body: call[1].body as URLSearchParams
    }))
    const operationIds = requests.map(({ body }) => body.get('operation_id'))
    expect(new Set(operationIds).size).toBe(1)
    expect(requests.filter(({ url }) => url.endsWith('/command/confirm/'))).toHaveLength(2)
    expect(requests[requests.length - 1].body.get('confirmation_token')).toBe('confirm-2')
  })

  it('surfaces an operation conflict instead of calling it a disconnect', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => 'Operation ID conflicts with an existing command'
    })
    vi.stubGlobal('fetch', fetchMock)

    const servers = { alpha: makeServer('alpha') }
    const asset = makeAsset('Drone', [{ serverKey: 'alpha', assetPk: 1 }])

    await expect(sendAssetCommand(servers, asset, { command: 'RTL' })).rejects.toThrow(/Operation ID conflicts with an existing command/)
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
