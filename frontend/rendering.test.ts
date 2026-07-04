import { describe, expect, it, vi } from 'vitest'

import { AssetCommandData } from './server'
import { assetPositionTimeOld, assetPositionTimeWarn, batteryTimeOld, batteryTimeWarn, commandAckAge, dataAgeClass } from './rendering'

const SERVER_NOW = 1_700_000_000_000

const isoAt = (offsetMs: number) => new Date(SERVER_NOW - offsetMs).toISOString()

const makeCommand = (overrides: Partial<AssetCommandData> = {}): AssetCommandData => ({
  timestamp: isoAt(0),
  command: 'Return to Launch',
  command_code: 'RTL',
  ack_state: 'pending',
  ...overrides
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

  it('is old once older than the old threshold', () => {
    const cls = dataAgeClass(isoAt(assetPositionTimeOld + 1), assetPositionTimeOld, assetPositionTimeWarn, 'asset-position', SERVER_NOW)
    expect(cls).toBe('asset-position-old')
  })

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
