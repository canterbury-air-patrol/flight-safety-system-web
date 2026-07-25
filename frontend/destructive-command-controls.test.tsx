// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssetController } from './asset'
import { CommandExecutor, DisArm, Terminate } from './destructive-command-controls'

const makeController = (): AssetController => ({
  name: 'Test Drone',
  RTL: vi.fn().mockResolvedValue(undefined),
  Hold: vi.fn().mockResolvedValue(undefined),
  Continue: vi.fn().mockResolvedValue(undefined),
  Goto: vi.fn().mockResolvedValue(undefined),
  Altitude: vi.fn().mockResolvedValue(undefined),
  DisArm: vi.fn().mockResolvedValue(undefined),
  Terminate: vi.fn().mockResolvedValue(undefined),
  Manual: vi.fn().mockResolvedValue(undefined),
  positionMostRecent: vi.fn()
})

const command: CommandExecutor = (fn, onClose) => async () => {
  await Promise.resolve(fn())
  onClose?.()
}

afterEach(cleanup)

describe('DisArm confirmation dialog', () => {
  it('runs DISARM only from the confirmation button', async () => {
    const controller = makeController()
    render(<DisArm controller={controller} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: 'DisArm' }))
    const dialog = await screen.findByRole('dialog')
    expect(controller.DisArm).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'DisArm' }))
    await waitFor(() => expect(controller.DisArm).toHaveBeenCalledTimes(1))
  })

  it('sends nothing when cancelled', async () => {
    const controller = makeController()
    render(<DisArm controller={controller} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: 'DisArm' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(controller.DisArm).not.toHaveBeenCalled()
  })
})

describe('Terminate confirmation dialog', () => {
  it('runs TERM only from the confirmation button', async () => {
    const controller = makeController()
    render(<Terminate controller={controller} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminate' }))
    const dialog = await screen.findByRole('dialog')
    expect(controller.Terminate).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Terminate Flight' }))
    await waitFor(() => expect(controller.Terminate).toHaveBeenCalledTimes(1))
  })

  it('keeps RTL and Hold as non-terminate alternatives', async () => {
    const controller = makeController()
    render(<Terminate controller={controller} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminate' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'RTL' }))

    await waitFor(() => expect(controller.RTL).toHaveBeenCalledTimes(1))
    expect(controller.Terminate).not.toHaveBeenCalled()
  })

  it('sends nothing when cancelled', async () => {
    const controller = makeController()
    render(<Terminate controller={controller} command={command} />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminate' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(controller.Terminate).not.toHaveBeenCalled()
    expect(controller.RTL).not.toHaveBeenCalled()
    expect(controller.Hold).not.toHaveBeenCalled()
  })
})
