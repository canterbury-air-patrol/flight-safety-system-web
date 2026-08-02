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

export interface CommandSubmissionGuard {
  acquire(): boolean
  release(): void
}

export class CommandDispatchError extends Error {
  constructor(
    message: string,
    readonly retry: () => Promise<void>
  ) {
    super(message)
    this.name = 'CommandDispatchError'
  }
}

class CommandRequestError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
    message: string
  ) {
    super(message)
    this.name = 'CommandRequestError'
  }
}

class SkippedTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkippedTargetError'
  }
}

interface CommandTargetState {
  target: AssetTarget
  confirmationToken?: string
}

const commandFailureMessage = (response: Response, responseBody: string): string => {
  if (response.status === 403) return 'not authenticated — please refresh and log in'
  if (response.status === 409 && responseBody.startsWith('Asset is disconnected')) return 'asset disconnected — no recent RTT response'
  if (responseBody) return responseBody
  return `${response.status} ${response.statusText}`.trim()
}

export const sendAssetCommand = async (knownServers: Record<string, ServerState>, asset: AssetState, data: CommandPayload, submissionGuard?: CommandSubmissionGuard) => {
  const operationId = crypto.randomUUID()
  const entries: [string, string][] = [...Object.entries(data).map(([k, v]) => [k, String(v)] as [string, string]), ['operation_id', operationId]]
  const resolvedTargets = resolveAssetTargets(knownServers, asset)
  if (resolvedTargets.length === 0) {
    throw new Error(`Command not sent — ${asset.name} has no commandable server (no known management server)`)
  }

  let unresolvedTargets: CommandTargetState[] = resolvedTargets.map((target) => ({ target }))
  let activeDispatch: Promise<void> | undefined

  const post = async (target: AssetTarget, path: string, bodyEntries: [string, string][]) => {
    const response = await fetch(getAssetServerURL(target.server, target.assetServer, path), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-CSRFToken': target.server.csrfToken ?? ''
      },
      body: new URLSearchParams(bodyEntries)
    })
    if (!response.ok) {
      const responseBody = typeof response.text === 'function' ? await response.text() : ''
      throw new CommandRequestError(response.status, responseBody, commandFailureMessage(response, responseBody))
    }
    return response
  }

  const prepareDestructiveCommand = async (state: CommandTargetState): Promise<boolean> => {
    const response = await post(state.target, 'command/confirm/', [
      ['command', data.command],
      ['operation_id', operationId]
    ])
    const confirmation = (await response.json()) as { confirmation_token?: unknown; operation_committed?: unknown }
    if (confirmation.operation_committed === true) {
      state.confirmationToken = undefined
      return true
    }
    if (typeof confirmation.confirmation_token !== 'string') {
      throw new Error('server returned an invalid confirmation token')
    }
    state.confirmationToken = confirmation.confirmation_token
    return false
  }

  const dispatchTarget = async (state: CommandTargetState) => {
    if (!isDestructiveCommand(data.command)) {
      await post(state.target, 'command/set/', entries)
      return
    }

    if (!state.confirmationToken) {
      const alreadyCommitted = await prepareDestructiveCommand(state)
      if (alreadyCommitted) {
        await post(state.target, 'command/set/', entries)
        return
      }
    }

    try {
      await post(state.target, 'command/set/', [...entries, ['confirmation_token', state.confirmationToken!]])
    } catch (error) {
      const confirmationExpired = error instanceof CommandRequestError && error.status === 400 && error.responseBody === 'Valid confirmation required'
      if (!confirmationExpired) throw error
      state.confirmationToken = undefined
      const alreadyCommitted = await prepareDestructiveCommand(state)
      if (alreadyCommitted) {
        await post(state.target, 'command/set/', entries)
      } else {
        await post(state.target, 'command/set/', [...entries, ['confirmation_token', state.confirmationToken!]])
      }
    }
  }

  const dispatchUnresolved = async (initial: boolean) => {
    const attemptedTargets = unresolvedTargets
    const results = await Promise.allSettled(
      attemptedTargets.map(async (state) => {
        if (initial && state.target.blockedReason) {
          throw new SkippedTargetError(state.target.blockedReason)
        }
        await dispatchTarget(state)
      })
    )
    const failures = results.map((result, index) => ({ result, state: attemptedTargets[index] })).filter(({ result }) => result.status === 'rejected')
    unresolvedTargets = failures.map(({ state }) => state)

    if (failures.length === 0) return

    const skipped = failures.filter(({ result }) => (result as PromiseRejectedResult).reason instanceof SkippedTargetError)
    const attemptedFailures = failures.filter(({ result }) => !((result as PromiseRejectedResult).reason instanceof SkippedTargetError))
    const failureMessages = attemptedFailures
      .map(({ result, state }) => {
        const reason = (result as PromiseRejectedResult).reason
        const msg = reason instanceof Error ? reason.message : String(reason)
        return `${state.target.assetServer.serverName}: ${msg}`
      })
      .join(', ')
    const successCount = resolvedTargets.length - failures.length
    if (successCount === 0 && attemptedFailures.length === 0) {
      const reasons = skipped.map(({ state }) => `${state.target.assetServer.serverName}: ${state.target.blockedReason}`).join(', ')
      throw new CommandDispatchError(`Command not sent — ${asset.name} has no commandable server (${reasons})`, () => dispatch(false))
    }
    const prefix = successCount > 0 ? `Command was queued on ${successCount} of ${resolvedTargets.length} server(s) — aircraft may already be affected. ` : ''
    const skippedMessage = skipped.length > 0 ? `Skipped: ${skipped.map(({ state }) => `${state.target.assetServer.serverName}: ${state.target.blockedReason}`).join(', ')}. ` : ''
    const failedMessage = attemptedFailures.length > 0 ? `Failed on: ${failureMessages}` : ''
    throw new CommandDispatchError(`${prefix}${skippedMessage}${failedMessage}`.trim(), () => dispatch(false))
  }

  const dispatch = (initial: boolean): Promise<void> => {
    if (activeDispatch) return activeDispatch
    if (submissionGuard && !submissionGuard.acquire()) return Promise.resolve()
    activeDispatch = dispatchUnresolved(initial).finally(() => {
      activeDispatch = undefined
      submissionGuard?.release()
    })
    return activeDispatch
  }

  return dispatch(true)
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

// Reconcile asset-server entries after topology reconciliation removes an
// origin. This is separate from per-poll asset reconciliation because topology
// removal may be triggered by a different server's advertised peer snapshot.
export const pruneAssetServers = (currentAssets: Record<string, AssetState>, retainedServerKeys: Set<string>): Record<string, AssetState> => {
  const nextAssets: Record<string, AssetState> = {}
  for (const [assetName, assetState] of Object.entries(currentAssets)) {
    const remainingServers = Object.fromEntries(Object.entries(assetState.servers).filter(([serverKey]) => retainedServerKeys.has(serverKey)))
    const remainingServerKeys = Object.keys(remainingServers)
    if (remainingServerKeys.length === 0) continue
    nextAssets[assetName] = {
      ...assetState,
      servers: remainingServers,
      selectedServerKey: assetState.selectedServerKey && retainedServerKeys.has(assetState.selectedServerKey) ? assetState.selectedServerKey : remainingServerKeys[0]
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

export const createAssetController = (knownServers: Record<string, ServerState>, asset: AssetState, submissionGuard?: CommandSubmissionGuard): AssetController => {
  const send = (data: CommandPayload) => sendAssetCommand(knownServers, asset, data, submissionGuard)
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
