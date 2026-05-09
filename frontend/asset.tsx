import { AssetPositionData, AssetStatus, ServerState, getServerURL } from './server'

export type Command = 'GOTO' | 'ALT' | 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'

export type CommandPayload =
  | { command: 'GOTO'; latitude: number; longitude: number }
  | { command: 'ALT'; altitude: number }
  | { command: Extract<Command, 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'> }

export interface AssetServerState {
  serverName: string
  assetPk: number
  data?: AssetStatus
}

export interface AssetState {
  name: string
  selectedServerName?: string
  servers: Record<string, AssetServerState>
}

export const createAsset = (name: string): AssetState => ({
  name,
  servers: {}
})

export const getAssetServerURL = (server: ServerState, assetServer: AssetServerState, path: string) => getServerURL(server, `/assets/${assetServer.assetPk}/${path}`)

export const sendAssetCommand = async (knownServers: Record<string, ServerState>, asset: AssetState, data: CommandPayload) => {
  const entries: [string, string][] = Object.entries(data).map(([k, v]) => [k, String(v)])
  const assetServers = Object.values(asset.servers)
  const results = await Promise.allSettled(
    assetServers.map((assetServer) => {
      const server = knownServers[assetServer.serverName]
      if (!server) return Promise.resolve()
      return fetch(getAssetServerURL(server, assetServer, 'command/set/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(entries)
      }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      })
    })
  )

  const failures = results.map((result, i) => ({ result, serverName: assetServers[i].serverName })).filter(({ result }) => result.status === 'rejected')

  if (failures.length > 0) {
    const errorMessages = failures
      .map(({ result, serverName }) => {
        const reason = (result as PromiseRejectedResult).reason
        const msg = reason instanceof Error ? reason.message : String(reason)
        return `${serverName}: ${msg}`
      })
      .join(', ')
    const successCount = assetServers.length - failures.length
    throw new Error(`Command reached ${successCount} of ${assetServers.length} server(s) for ${asset.name}; failed: ${errorMessages}`)
  }
}

export const assetPositionMostRecent = (asset: AssetState): AssetPositionData | undefined => {
  let best: AssetPositionData | undefined
  for (const assetServer of Object.values(asset.servers)) {
    const pos = assetServer.data?.position
    if (!pos) continue
    if (!best || pos.timestamp > best.timestamp) {
      best = pos
    }
  }
  return best
}

export const mergeServerAssets = (currentAssets: Record<string, AssetState>, serverName: string, assets: AssetStatus[]): Record<string, AssetState> => {
  const nextAssets = { ...currentAssets }
  for (const assetData of assets) {
    const assetName = assetData.asset.name
    const existing = nextAssets[assetName] ?? createAsset(assetName)
    const assetServer: AssetServerState = {
      serverName,
      assetPk: assetData.asset.pk,
      data: assetData
    }
    nextAssets[assetName] = {
      ...existing,
      servers: { ...existing.servers, [serverName]: assetServer },
      selectedServerName: existing.selectedServerName ?? serverName
    }
  }
  return nextAssets
}

export interface AssetController {
  name: string
  RTL(): Promise<void>
  Hold(): Promise<void>
  Continue(): Promise<void>
  Goto(lat: number, lng: number): Promise<void>
  Altitude(alt: number): Promise<void>
  DisArm(): Promise<void>
  Terminate(): Promise<void>
  Manual(): Promise<void>
  positionMostRecent(): AssetPositionData | undefined
}

export const createAssetController = (knownServers: Record<string, ServerState>, asset: AssetState): AssetController => {
  const send = (data: CommandPayload) => sendAssetCommand(knownServers, asset, data)
  return {
    name: asset.name,
    RTL: () => send({ command: 'RTL' }),
    Hold: () => send({ command: 'HOLD' }),
    Continue: () => send({ command: 'RON' }),
    Goto: (latitude, longitude) => send({ command: 'GOTO', latitude, longitude }),
    Altitude: (altitude) => send({ command: 'ALT', altitude }),
    DisArm: () => send({ command: 'DISARM' }),
    Terminate: () => send({ command: 'TERM' }),
    Manual: () => send({ command: 'MAN' }),
    positionMostRecent: () => assetPositionMostRecent(asset)
  }
}
