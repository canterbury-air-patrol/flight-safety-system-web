import { describe, expect, it, vi } from 'vitest'

import { AssetServerState, AssetState } from './asset'
import { AssetCommandData } from './server'
import {
  assetPositionTimeOld,
  assetPositionTimeWarn,
  assetServerMisalignment,
  batteryTimeOld,
  batteryTimeWarn,
  commandAckAge,
  commandAckDisplay,
  commandAckOutcome,
  commandAckTimeout,
  dataAgeClass,
  supersededRtlInEffect
} from './rendering'

const SERVER_NOW = 1_700_000_000_000

const isoAt = (offsetMs: number) => new Date(SERVER_NOW - offsetMs).toISOString()

const makeCommand = (overrides: Partial<AssetCommandData> = {}): AssetCommandData => ({
  timestamp: isoAt(0),
  command: 'Return to Launch',
  command_code: 'RTL',
  ack_state: 'pending',
  ...overrides
})

const makeAssetServer = (serverName: string, command: AssetCommandData, serverNow = SERVER_NOW): AssetServerState => ({
  serverName,
  assetPk: 1,
  data: { asset: { name: 'Drone', pk: 1 }, command },
  serverNow
})

const makeAsset = (servers: AssetServerState[]): AssetState => ({
  name: 'Drone',
  servers: Object.fromEntries(servers.map((s) => [`https://${s.serverName}.example`, s]))
})

describe('dataAgeClass', () => {
  it('is fresh when the data point is newer than the warn threshold', () => {
    const cls = dataAgeClass(isoAt(assetPositionTimeWarn - 1), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
    expect(cls).toBe('')
  })

  it('is warn once older than the warn threshold but not yet old', () => {
    const cls = dataAgeClass(isoAt(assetPositionTimeWarn + 1), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
    expect(cls).toBe('asset-position-warn')
  })

  // satisfies: TC-WEB-006
  it('is old once older than the old threshold', () => {
    const cls = dataAgeClass(isoAt(assetPositionTimeOld + 1), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
    expect(cls).toBe('asset-position-old')
  })

  // satisfies: TC-WEB-020, TC-WEB-021
  it('computes each indicator independently: stale battery does not affect a fresh position', () => {
    const positionClass = dataAgeClass(isoAt(0), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
    const batteryClass = dataAgeClass(isoAt(batteryTimeOld + 1), batteryTimeOld, batteryTimeWarn, 'asset-battery-time', SERVER_NOW)

    expect(positionClass).toBe('')
    expect(batteryClass).toBe('asset-battery-time-old')
  })

  it('ages against serverNow, unaffected by a skewed browser clock', () => {
    const realNow = Date.now
    try {
      // Browser clock is 5 minutes ahead of the server; a fresh data point
      // would misreport as stale if the age were computed against it.
      Date.now = () => SERVER_NOW + 5 * 60 * 1000
      const cls = dataAgeClass(isoAt(0), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
      expect(cls).toBe('')
    } finally {
      Date.now = realNow
    }
  })

  it('falls back to the browser clock when serverNow is absent', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(SERVER_NOW)
      const cls = dataAgeClass(isoAt(assetPositionTimeOld + 1), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position')
      expect(cls).toBe('asset-position-old')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('commandAckAge', () => {
  it('falls back to the browser clock when serverNow is absent', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(SERVER_NOW)
      const command = makeCommand({ timestamp: isoAt(5000) })
      expect(commandAckAge(command)).toBe(5000)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('commandAckDisplay', () => {
  it.each([
    ['actioned', '✓ actioned', 'asset-command-ack-actioned'],
    ['noop', '✓ no change', 'asset-command-ack-noop'],
    ['rejected', '✗ rejected', 'asset-command-ack-rejected']
  ] as const)('renders %s', (ack_state, text, className) => {
    const result = commandAckDisplay(makeCommand({ ack_state }), SERVER_NOW)
    expect(result).toEqual({ text, className })
  })

  it('shows "awaiting ack" for a pending command within the timeout', () => {
    const command = makeCommand({ ack_state: 'pending', timestamp: isoAt(commandAckTimeout - 1) })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '… awaiting ack', className: 'asset-command-ack-pending' })
  })

  it('shows "no ack" once a pending command outlives the timeout', () => {
    const command = makeCommand({ ack_state: 'pending', timestamp: isoAt(commandAckTimeout + 1) })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '⚠ no ack', className: 'asset-command-ack-missing' })
  })

  it('shows "received" for a received command within the timeout', () => {
    const command = makeCommand({ ack_state: 'received', timestamp: isoAt(commandAckTimeout - 1) })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '… received', className: 'asset-command-ack-received' })
  })

  it('shows "received, no result" once a received command outlives the timeout', () => {
    const command = makeCommand({ ack_state: 'received', timestamp: isoAt(commandAckTimeout + 1) })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '⚠ received, no result', className: 'asset-command-ack-missing' })
  })

  it('shows the RTL-active label when a superseded RTL is actually in effect', () => {
    const command = makeCommand({ command_code: 'RTL', ack_state: 'superseded', ack_superseded_by: 'low_battery' })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '✓ RTL active (low-battery)', className: 'asset-command-ack-actioned' })
  })

  it('shows a real supersede for a newer command overriding RTL', () => {
    const command = makeCommand({ command_code: 'RTL', ack_state: 'superseded', ack_superseded_by: 'newer_command' })
    expect(commandAckDisplay(command, SERVER_NOW)).toEqual({ text: '✗ superseded by newer command', className: 'asset-command-ack-superseded' })
  })
})

describe('supersededRtlInEffect', () => {
  it('is in effect when RTL was superseded by the low-battery latch', () => {
    const command = makeCommand({ command_code: 'RTL', ack_superseded_by: 'low_battery' })
    expect(supersededRtlInEffect(command)).toBe(true)
  })

  it('is in effect when RTL was superseded by the comms-loss latch', () => {
    const command = makeCommand({ command_code: 'RTL', ack_superseded_by: 'comms_loss' })
    expect(supersededRtlInEffect(command)).toBe(true)
  })

  it('is a real supersede when RTL was overridden by a newer command', () => {
    const command = makeCommand({ command_code: 'RTL', ack_superseded_by: 'newer_command' })
    expect(supersededRtlInEffect(command)).toBe(false)
  })

  it('is a real supersede for a non-RTL command', () => {
    const command = makeCommand({ command_code: 'HOLD', ack_superseded_by: 'low_battery' })
    expect(supersededRtlInEffect(command)).toBe(false)
  })
})

describe('commandAckOutcome', () => {
  it('buckets a superseded-but-in-effect RTL as actioned', () => {
    const command = makeCommand({ command_code: 'RTL', ack_state: 'superseded', ack_superseded_by: 'comms_loss' })
    expect(commandAckOutcome(command, SERVER_NOW)).toBe('actioned')
  })

  it('does not flag pending/received within the timeout as disagreeing buckets', () => {
    const pending = makeCommand({ ack_state: 'pending', timestamp: isoAt(1000) })
    const received = makeCommand({ ack_state: 'received', timestamp: isoAt(1000) })
    expect(commandAckOutcome(pending, SERVER_NOW)).toBe('in-flight')
    expect(commandAckOutcome(received, SERVER_NOW)).toBe('in-flight')
  })
})

describe('assetServerMisalignment', () => {
  it('does not disagree when both servers report the same command and outcome', () => {
    const command = makeCommand({ ack_state: 'actioned' })
    const asset = makeAsset([makeAssetServer('alpha', command), makeAssetServer('beta', command)])

    expect(assetServerMisalignment(asset).disagree).toBe(false)
  })

  it('disagrees when servers report different command codes', () => {
    const asset = makeAsset([makeAssetServer('alpha', makeCommand({ command_code: 'RTL' })), makeAssetServer('beta', makeCommand({ command_code: 'HOLD' }))])

    expect(assetServerMisalignment(asset).disagree).toBe(true)
  })

  it('disagrees when servers report the same command code but divergent outcomes', () => {
    const asset = makeAsset([
      makeAssetServer('alpha', makeCommand({ command_code: 'TERM', ack_state: 'actioned' })),
      makeAssetServer('beta', makeCommand({ command_code: 'TERM', ack_state: 'rejected' }))
    ])

    expect(assetServerMisalignment(asset).disagree).toBe(true)
  })

  it('never disagrees with fewer than two servers reporting command data', () => {
    const asset = makeAsset([makeAssetServer('alpha', makeCommand({ ack_state: 'rejected' }))])

    expect(assetServerMisalignment(asset).disagree).toBe(false)
  })

  it('ignores servers with no command data at all', () => {
    const withCommand = makeAssetServer('alpha', makeCommand({ command_code: 'RTL' }))
    const withoutCommand: AssetServerState = {
      serverName: 'beta',
      assetPk: 1,
      data: { asset: { name: 'Drone', pk: 1 } },
      serverNow: SERVER_NOW
    }
    const asset = makeAsset([withCommand, withoutCommand])

    const result = assetServerMisalignment(asset)
    expect(result.disagree).toBe(false)
    expect(result.servers).toHaveLength(1)
  })
})
