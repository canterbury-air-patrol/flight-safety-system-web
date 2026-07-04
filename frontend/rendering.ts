// Pure rendering-decision helpers for the operator status board: staleness
// classification and the command acknowledgement / server-misalignment state
// machine. Kept free of React/DOM so they're cheap to unit test directly -
// see rendering.test.ts.

import { AssetState } from './asset'
import { AckSupersedeReason, AssetCommandData } from './server'

/* Staleness thresholds (ms) */
export const assetPositionTimeWarn = 30 * 1000
export const assetPositionTimeOld = 60 * 1000

export const batteryCritical = 20
export const batteryWarn = 50
export const batteryTimeWarn = 60 * 1000
export const batteryTimeOld = 120 * 1000

export const searchTimeWarn = 300 * 1000
export const searchTimeOld = 600 * 1000

export const rttTimeWarn = 10 * 1000
export const rttTimeOld = 60 * 1000

// How long a command may sit unacknowledged before we treat the missing ack
// as a problem rather than transient latency.
export const commandAckTimeout = 15 * 1000

// Age (ms) of a data point, measured against the server's clock (serverNow,
// epoch-ms from the same poll) rather than the browser clock: a laptop that's
// even a minute or two off (no NTP, VM drift, DST bugs) would otherwise paint
// fresh data as stale, or worse, genuinely stale telemetry as current. Mirrors
// commandAckAge's documented fallback to the browser clock when serverNow is
// unavailable, so a data point still eventually ages rather than looking
// permanently fresh.
export const dataAgeClass = (timestamp: string, old: number, warn: number, prefix: string, serverNow?: number) => {
  const dbTime = new Date(timestamp).getTime()
  const now = serverNow ?? Date.now()
  const timeDelta = now - dbTime
  if (timeDelta > old) {
    return `${prefix}-old`
  } else if (timeDelta > warn) {
    return `${prefix}-warn`
  }
  return ''
}

// Label for the reason a command was superseded. The failsafe latches always
// engage an RTL, so name those as such for the operator; a newer command
// simply overrides the older one and is not an RTL.
export const supersedeReasonLabel: Record<AckSupersedeReason, string> = {
  none: '',
  low_battery: 'low-battery RTL',
  comms_loss: 'comms-loss RTL',
  newer_command: 'newer command'
}

// Short name for the failsafe latch that engaged an RTL, used when an operator
// RTL was 'superseded' by a latch that ALSO flies RTL — the aircraft is doing
// what was asked, so we report it as in-effect rather than as a failure.
export const supersedeLatchLabel: Partial<Record<AckSupersedeReason, string>> = {
  low_battery: 'low-battery',
  comms_loss: 'comms-loss'
}

// True when a 'superseded' RTL command is in effect anyway: the operator asked
// for RTL and a failsafe latch (low-battery / comms-loss) that also flies RTL
// took over. The operator's intent is satisfied, so this should not read as a
// red ✗ failure. A newer-command supersede or any non-RTL command is a real
// override and keeps the ✗.
export const supersededRtlInEffect = (command: AssetCommandData): boolean =>
  command.command_code === 'RTL' && command.ack_superseded_by !== undefined && command.ack_superseded_by in supersedeLatchLabel

// Age (ms) of a command since it was dispatched, measured entirely on the
// server's clock: serverNow (epoch-ms from the same poll) minus the command's
// dispatch timestamp. This deliberately avoids the browser clock and the
// FMU-stamped ack_timestamp — mixing clocks lets skew (corrected elsewhere via
// RTT offset) produce a false 'no ack' or a timeout that never fires. When the
// server clock is unavailable, fall back to the browser clock so a missing
// ack still eventually surfaces rather than appearing stuck forever.
export const commandAckAge = (command: AssetCommandData, serverNow?: number): number => {
  const dispatched = new Date(command.timestamp).getTime()
  const now = serverNow ?? Date.now()
  return now - dispatched
}

// Render the acknowledgement state of a command as a short suffix plus a CSS
// class for styling. An ack that has outlived commandAckTimeout is reported
// distinctly ('no ack') so an ack that never arrives is visible rather than
// looking like it is still in flight. This covers both a 'pending' command
// that was never acknowledged at all and a 'received' command whose terminal
// (actioned/superseded/…) ack never followed the phase-1 ack.
export const commandAckDisplay = (command: AssetCommandData, serverNow?: number): { text: string; className: string } => {
  switch (command.ack_state) {
    case 'actioned':
      return { text: '✓ actioned', className: 'asset-command-ack-actioned' }
    case 'received':
      // A 'received' command reached the asset (phase-1 ack) but no terminal
      // (actioned/superseded/…) ack followed. Distinguish this stalled-result
      // case from a command that was never acknowledged at all ('no ack'): the
      // operator knows it arrived but the outcome is unknown.
      if (commandAckAge(command, serverNow) > commandAckTimeout) {
        return { text: '⚠ received, no result', className: 'asset-command-ack-missing' }
      }
      return { text: '… received', className: 'asset-command-ack-received' }
    case 'noop':
      return { text: '✓ no change', className: 'asset-command-ack-noop' }
    case 'superseded': {
      if (supersededRtlInEffect(command)) {
        const latch = supersedeLatchLabel[command.ack_superseded_by as AckSupersedeReason]
        return { text: `✓ RTL active (${latch})`, className: 'asset-command-ack-actioned' }
      }
      const reason = command.ack_superseded_by && command.ack_superseded_by !== 'none' ? ` by ${supersedeReasonLabel[command.ack_superseded_by]}` : ''
      return { text: `✗ superseded${reason}`, className: 'asset-command-ack-superseded' }
    }
    case 'rejected':
      return { text: '✗ rejected', className: 'asset-command-ack-rejected' }
    case 'pending':
    default:
      if (commandAckAge(command, serverNow) > commandAckTimeout) {
        return { text: '⚠ no ack', className: 'asset-command-ack-missing' }
      }
      return { text: '… awaiting ack', className: 'asset-command-ack-pending' }
  }
}

// A stable category for a command's acknowledgement outcome, used to compare
// servers against each other. Unlike commandAckDisplay's text this collapses the
// transient in-flight phases (pending/received before the timeout) into a single
// 'in-flight' bucket so two servers a poll apart aren't flagged as disagreeing
// over normal latency. A timed-out pending becomes 'no-ack', a timed-out
// received becomes 'received-stalled', and an RTL kept in effect by a failsafe
// latch is treated as actioned (it is doing what was asked).
export type AckOutcome = 'actioned' | 'noop' | 'in-flight' | 'no-ack' | 'received-stalled' | 'superseded' | 'rejected'

export const commandAckOutcome = (command: AssetCommandData, serverNow?: number): AckOutcome => {
  switch (command.ack_state) {
    case 'actioned':
      return 'actioned'
    case 'noop':
      return 'noop'
    case 'rejected':
      return 'rejected'
    case 'superseded':
      return supersededRtlInEffect(command) ? 'actioned' : 'superseded'
    case 'received':
      return commandAckAge(command, serverNow) > commandAckTimeout ? 'received-stalled' : 'in-flight'
    case 'pending':
    default:
      return commandAckAge(command, serverNow) > commandAckTimeout ? 'no-ack' : 'in-flight'
  }
}

// Per-server view of an asset's command, for the misalignment indicator.
export interface ServerCommandView {
  serverName: string
  commandCode?: string
  ack: { text: string; className: string }
  outcome?: AckOutcome
}

// Compare what each of an asset's servers believes about its current command.
// Servers "disagree" when they hold different command_codes (the operator's
// command didn't reach all of them, or they hold different/stale commands) OR
// when they hold the same command but report divergent ack outcomes (e.g.
// actioned on one, no-ack/superseded/rejected on another). Servers without
// command data are ignored. Returns the per-server breakdown plus whether the
// servers that DO have a command disagree; with fewer than two such servers
// there is nothing to disagree about.
export const assetServerMisalignment = (asset: AssetState): { disagree: boolean; servers: ServerCommandView[] } => {
  const servers: ServerCommandView[] = []
  for (const assetServer of Object.values(asset.servers)) {
    const command = assetServer.data?.command
    if (!command) continue
    servers.push({
      serverName: assetServer.serverName,
      commandCode: command.command_code,
      ack: commandAckDisplay(command, assetServer.serverNow),
      outcome: commandAckOutcome(command, assetServer.serverNow)
    })
  }
  let disagree = false
  if (servers.length > 1) {
    const codes = new Set(servers.map((s) => s.commandCode))
    const outcomes = new Set(servers.map((s) => s.outcome))
    disagree = codes.size > 1 || outcomes.size > 1
  }
  return { disagree, servers }
}
