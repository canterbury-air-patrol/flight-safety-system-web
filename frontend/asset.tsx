import { AssetPositionData, AssetStatus, ServerState, getServerURL } from './server'

export type Command = 'GOTO' | 'ALT' | 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'
type DestructiveCommand = Extract<Command, 'DISARM' | 'TERM'>

export type CommandPayload =
  | { command: 'GOTO'; latitude: number; longitude: number }
  | { command: 'ALT'; altitude: number }
  | { command: Extract<Command, 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'> }

export interface AssetServerState {
  serverName: string
  assetPk: number
  data?: AssetStatus
  // The server's current time (epoch-ms) from the poll that produced `data`.
  // Lets command ages be computed against this server's clock alone.
  serverNow?: number
}

export interface AssetState {
  name: string
  selectedServerKey?: string
  servers: Record<string, AssetServerState>
}

export const createAsset = (name: string): AssetState => ({
  name,
  servers: {}
})

export const getAssetServerURL = (server: ServerState, assetServer: AssetServerState, path: string) => getServerURL(server, `/assets/${assetServer.assetPk}/${path}`)

interface AssetTarget {
  server: ServerState
  assetServer: AssetServerState
  blockedReason?: string
}

const isDestructiveCommand = (command: Command): command is DestructiveCommand => command === 'DISARM' || command === 'TERM'

const assetTargetBlockReason = (server: ServerState, assetServer: AssetServerState): string | undefined => {
  if (!server.connected) return 'management server unreachable'
  if (!server.userName || !server.csrfToken) return 'login required'
  if (assetServer.data?.connected !== true) return 'asset disconnected'
  return undefined
}

const resolveAssetTargets = (knownServers: Record<string, ServerState>, asset: AssetState): AssetTarget[] => {
  const targetsByOrigin = new Map<string, AssetTarget>()
  for (const [serverKey, assetServer] of Object.entries(asset.servers)) {
    const server = knownServers[serverKey]
    if (!server) continue
    const target = { assetServer, server, blockedReason: assetTargetBlockReason(server, assetServer) }
    const existing = targetsByOrigin.get(server.url)
    // Prefer a commandable entry when old aliases for the same origin coexist.
    if (!existing || (existing.blockedReason && !target.blockedReason)) {
      targetsByOrigin.set(server.url, target)
    }
  }

  return Array.from(targetsByOrigin.values())
}

export interface AssetCommandAvailability {
  commandable: boolean
  blockedReasons: string[]
}

export const assetCommandAvailability = (knownServers: Record<string, ServerState>, asset: AssetState): AssetCommandAvailability => {
  const targets = resolveAssetTargets(knownServers, asset)
  const blockedReasons = targets.filter((target) => target.blockedReason).map((target) => `${target.assetServer.serverName}: ${target.blockedReason}`)
  if (targets.length === 0) {
    blockedReasons.push('no known management server')
  }
  return {
    commandable: targets.some((target) => !target.blockedReason),
    blockedReasons
  }
}

export const sendAssetCommand = async (knownServers: Record<string, ServerState>, asset: AssetState, data: CommandPayload) => {
  const entries: [string, string][] = Object.entries(data).map(([k, v]) => [k, String(v)])
  const resolvedTargets = resolveAssetTargets(knownServers, asset)
  const targets = resolvedTargets.filter((target) => !target.blockedReason)
  const skipped = resolvedTargets.filter((target) => target.blockedReason)
  if (targets.length === 0) {
    const reasons = skipped.length > 0 ? skipped.map((target) => `${target.assetServer.serverName}: ${target.blockedReason}`).join(', ') : 'no known management server'
    throw new Error(`Command not sent — ${asset.name} has no commandable server (${reasons})`)
  }
  const results = await Promise.allSettled(
    targets.map(async ({ assetServer, server }) => {
      const post = (path: string, bodyEntries: [string, string][]) =>
        fetch(getAssetServerURL(server, assetServer, path), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-CSRFToken': server.csrfToken ?? ''
          },
          body: new URLSearchParams(bodyEntries)
        }).then((response) => {
          if (response.status === 403) throw new Error('not authenticated — please refresh and log in')
          if (response.status === 409) throw new Error('asset disconnected — no recent RTT response')
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
          return response
        })

      let commandEntries = entries
      if (isDestructiveCommand(data.command)) {
        const confirmationResponse = await post('command/confirm/', [['command', data.command]])
        const confirmation = (await confirmationResponse.json()) as { confirmation_token?: unknown }
        if (typeof confirmation.confirmation_token !== 'string') {
          throw new Error('server returned an invalid confirmation token')
        }
        commandEntries = [...entries, ['confirmation_token', confirmation.confirmation_token]]
      }
      await post('command/set/', commandEntries)
    })
  )

  const failures = results.map((result, i) => ({ result, serverName: targets[i].assetServer.serverName })).filter(({ result }) => result.status === 'rejected')

  if (failures.length > 0 || skipped.length > 0) {
    const failureMessages = failures
      .map(({ result, serverName }) => {
        const reason = (result as PromiseRejectedResult).reason
        const msg = reason instanceof Error ? reason.message : String(reason)
        return `${serverName}: ${msg}`
      })
      .join(', ')
    const successCount = targets.length - failures.length
    const prefix = successCount > 0 ? `Command was queued on ${successCount} of ${resolvedTargets.length} server(s) — aircraft may already be affected. ` : ''
    const skippedMessage = skipped.length > 0 ? `Skipped: ${skipped.map((target) => `${target.assetServer.serverName}: ${target.blockedReason}`).join(', ')}. ` : ''
    const failedMessage = failures.length > 0 ? `Failed on: ${failureMessages}` : ''
    throw new Error(`${prefix}${skippedMessage}${failedMessage}`.trim())
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

// Reconcile this server's reported assets against what it reported last poll,
// dropping its entry from any asset it no longer reports and pruning the
// asset entirely once that was its last server. Only call this for a
// server's *successful* poll — a failed/unreachable/unauthenticated poll
// should leave last-known data + age styling in place instead.
const pruneStaleServerEntries = (currentAssets: Record<string, AssetState>, serverKey: string, reportedNames: Set<string>): Record<string, AssetState> => {
  const nextAssets = { ...currentAssets }
  for (const [assetName, assetState] of Object.entries(nextAssets)) {
    if (reportedNames.has(assetName) || !(serverKey in assetState.servers)) continue
    const remainingServers = { ...assetState.servers }
    delete remainingServers[serverKey]
    const remainingServerKeys = Object.keys(remainingServers)
    if (remainingServerKeys.length === 0) {
      delete nextAssets[assetName]
    } else {
      nextAssets[assetName] = {
        ...assetState,
        servers: remainingServers,
        selectedServerKey: assetState.selectedServerKey === serverKey ? remainingServerKeys[0] : assetState.selectedServerKey
      }
    }
  }
  return nextAssets
}

export const mergeServerAssets = (
  currentAssets: Record<string, AssetState>,
  serverKey: string,
  serverName: string,
  assets: AssetStatus[],
  serverNow?: number
): Record<string, AssetState> => {
  const reportedNames = new Set(assets.map((assetData) => assetData.asset.name))
  const nextAssets = pruneStaleServerEntries(currentAssets, serverKey, reportedNames)
  for (const assetData of assets) {
    const assetName = assetData.asset.name
    const existing = nextAssets[assetName] ?? createAsset(assetName)
    const assetServer: AssetServerState = {
      serverName,
      assetPk: assetData.asset.pk,
      data: assetData,
      serverNow
    }
    nextAssets[assetName] = {
      ...existing,
      servers: { ...existing.servers, [serverKey]: assetServer },
      selectedServerKey: existing.selectedServerKey ?? serverKey
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
