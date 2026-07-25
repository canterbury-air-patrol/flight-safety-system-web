import React, { ReactNode, useState } from 'react'
import { Button, Modal } from 'react-bootstrap'

import { AssetController } from './asset'

export type CommandExecutor = (fn: () => Promise<void> | void, onClose?: () => void) => () => Promise<void>

interface ModalWithButtonProps {
  label: string
  variant: string
  title: ReactNode
  body: ReactNode
  footer: (onClose: () => void) => ReactNode
  onShow?: () => void
  disabled?: boolean
}

export const ModalWithButton: React.FC<ModalWithButtonProps> = ({ label, variant, title, body, footer, onShow, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false)
  const handleClose = () => setIsOpen(false)
  const handleShow = () => {
    onShow?.()
    setIsOpen(true)
  }

  return (
    <>
      <Button onClick={handleShow} variant={variant} disabled={disabled}>
        {label}
      </Button>
      <Modal show={isOpen} onHide={handleClose}>
        <Modal.Header>
          <Modal.Title>{title}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{body}</Modal.Body>
        <Modal.Footer>{footer(handleClose)}</Modal.Footer>
      </Modal>
    </>
  )
}

interface DestructiveCommandProps {
  controller: AssetController
  command: CommandExecutor
  disabled?: boolean
}

export const DisArm: React.FC<DestructiveCommandProps> = ({ controller, command, disabled = false }) => (
  <ModalWithButton
    label="DisArm"
    variant="danger"
    title={<>Disarm {controller.name}</>}
    body={<>Warning this will probably result in the aircraft crashing. Use only when all other options are unsafe.</>}
    disabled={disabled}
    footer={(onClose) => (
      <>
        <Button variant="danger" onClick={command(controller.DisArm, onClose)} disabled={disabled}>
          DisArm
        </Button>
        <Button variant="primary" onClick={onClose}>
          Cancel
        </Button>
      </>
    )}
  />
)

export const Terminate: React.FC<DestructiveCommandProps> = ({ controller, command, disabled = false }) => (
  <ModalWithButton
    label="Terminate"
    variant="danger"
    title={<>Terminate {controller.name}</>}
    body={
      <>
        Warning this will cause the aircraft to immediately terminate flight and most certainly destroy it. Ensure the area directly under the aircraft is free of any people and
        property. Use RTL or Hold instead.
      </>
    }
    disabled={disabled}
    footer={(onClose) => (
      <>
        <Button variant="danger" onClick={command(controller.Terminate, onClose)} disabled={disabled}>
          Terminate Flight
        </Button>
        <Button variant="light" onClick={command(controller.RTL, onClose)} disabled={disabled}>
          RTL
        </Button>
        <Button variant="light" onClick={command(controller.Hold, onClose)} disabled={disabled}>
          Hold
        </Button>
        <Button variant="primary" onClick={onClose}>
          Cancel
        </Button>
      </>
    )}
  />
)
