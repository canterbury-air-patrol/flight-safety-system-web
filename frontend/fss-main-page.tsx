import { type Axis, degreesToDM, DMToDegrees } from '@canterbury-air-patrol/deg-converter'
import { AssetState, AssetServerState, AssetController, createAssetController, mergeServerAssets } from './asset'
import {
  ServerState,
  createServer,
  getServerURL,
  serverConnectFailed,
  serverUnauthenticated,
  AssetPositionData,
  AssetCommandData,
  AckSupersedeReason,
  mergeServerPollResult
} from './server'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L, { DragEndEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'
import React, { ReactNode, useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIconShadow from 'leaflet/dist/images/marker-shadow.png'
import { Button, Modal } from 'react-bootstrap'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'

/* definitions */
const assetPositionTimeWarn = 30 * 1000
const assetPositionTimeOld = 60 * 1000

const batteryCritical = 20
const batteryWarn = 50
const batteryTimeWarn = 60 * 1000
const batteryTimeOld = 120 * 1000

const searchTimeWarn = 300 * 1000
const searchTimeOld = 600 * 1000

const rttTimeWarn = 10 * 1000
const rttTimeOld = 60 * 1000

// How long a command may sit unacknowledged before we treat the missing ack
// as a problem rather than transient latency.
const commandAckTimeout = 15 * 1000

L.Icon.Default.prototype.options.iconUrl = markerIcon
L.Icon.Default.prototype.options.iconRetinaUrl = markerIcon2x
L.Icon.Default.prototype.options.shadowUrl = markerIconShadow

const ErrorContext = React.createContext<(msg: string | null) => void>(() => {})

const useCommand = () => {
  const setLastError = useContext(ErrorContext)
  return (fn: () => Promise<void> | void, onClose?: () => void) => async () => {
    try {
      await Promise.resolve(fn())
      onClose?.()
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    }
  }
}

interface ModalWithButtonProps {
  label: string
  variant: string
  title: ReactNode
  body: ReactNode
  footer: (onClose: () => void) => ReactNode
  onShow?: () => void
}

const ModalWithButton: React.FC<ModalWithButtonProps> = ({ label, variant, title, body, footer, onShow }) => {
  const [isOpen, setIsOpen] = useState(false)
  const handleClose = () => setIsOpen(false)
  const handleShow = () => {
    if (onShow) onShow()
    setIsOpen(true)
  }

  return (
    <>
      <Button onClick={handleShow} variant={variant}>
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

interface AssetProps {
  controller: AssetController
}

const AltitudeSelect: React.FC<AssetProps> = ({ controller }) => {
  const [newAltitude, setNewAltitude] = useState(100)
  const command = useCommand()

  return (
    <ModalWithButton
      label="Altitude"
      variant="outline-secondary"
      title="Set Target Altitude:"
      body={
        <>
          New Altitude: <input type="number" size={3} min="0" max="999" onChange={(e) => setNewAltitude(Number(e.target.value))} value={newAltitude}></input>
          ft
        </>
      }
      footer={(onClose) => (
        <>
          <Button variant="light" onClick={command(() => controller.Altitude(newAltitude), onClose)}>
            Set Altitude
          </Button>
          <Button variant="primary" onClick={onClose}>
            Cancel
          </Button>
        </>
      )}
    />
  )
}

const getDefaultPosition = (): AssetPositionData => ({ timestamp: '', lat: 0, lng: 0 })

const Goto: React.FC<AssetProps> = ({ controller }) => {
  const [position, setPosition] = useState<AssetPositionData | undefined>(undefined)
  const command = useCommand()

  const onShow = () => {
    setPosition(controller.positionMostRecent())
  }

  const handleGoto = (onClose: () => void) => command(() => controller.Goto(position!.lat, position!.lng), onClose)

  const handlePositionChange = (event: React.ChangeEvent<HTMLInputElement>, axis: Axis) => {
    const { value } = event.target
    const positionValue = DMToDegrees(value)
    setPosition((prev) => {
      const current = prev || getDefaultPosition()
      return { ...current, [axis === 'lat' ? 'lat' : 'lng']: positionValue }
    })
  }

  const dragEnd = (event: DragEndEvent) => {
    const latLng = event.target.getLatLng()
    setPosition((prev) => ({
      ...(prev || getDefaultPosition()),
      lat: latLng.lat,
      lng: latLng.lng
    }))
  }

  const pos = position || getDefaultPosition()

  return (
    <ModalWithButton
      label="Goto"
      variant="outline-secondary"
      onShow={onShow}
      title={<>Send {controller.name} to:</>}
      body={
        <>
          <input type="text" value={degreesToDM(pos.lat, 'lat')} onChange={(e) => handlePositionChange(e, 'lat')}></input>
          <input type="text" value={degreesToDM(pos.lng, 'lon')} onChange={(e) => handlePositionChange(e, 'lon')}></input>
          <MapContainer center={pos} zoom={13} className="dialog-map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker draggable={true} eventHandlers={{ dragend: dragEnd }} position={pos} />
          </MapContainer>
        </>
      }
      footer={(onClose) => (
        <>
          <Button variant="light" onClick={handleGoto(onClose)} disabled={!position}>
            Goto
          </Button>
          <Button variant="primary" onClick={onClose}>
            Cancel
          </Button>
        </>
      )}
    />
  )
}

const DisArm: React.FC<AssetProps> = ({ controller }) => {
  const command = useCommand()
  return (
    <ModalWithButton
      label="DisArm"
      variant="danger"
      title={<>Disarm {controller.name}</>}
      body={<>Warning this will probably result in the aircraft crashing. Use only when all other options are unsafe.</>}
      footer={(onClose) => (
        <>
          <Button variant="danger" onClick={command(controller.DisArm, onClose)}>
            DisArm
          </Button>
          <Button variant="primary" onClick={onClose}>
            Cancel
          </Button>
        </>
      )}
    />
  )
}

const Terminate: React.FC<AssetProps> = ({ controller }) => {
  const command = useCommand()
  return (
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
      footer={(onClose) => (
        <>
          <Button variant="danger" onClick={command(controller.Terminate, onClose)}>
            Terminate Flight
          </Button>
          <Button variant="light" onClick={command(controller.RTL, onClose)}>
            RTL
          </Button>
          <Button variant="light" onClick={command(controller.Hold, onClose)}>
            Hold
          </Button>
          <Button variant="primary" onClick={onClose}>
            Cancel
          </Button>
        </>
      )}
    />
  )
}

const FSSAssetControls: React.FC<AssetProps> = ({ controller }) => {
  const command = useCommand()

  return (
    <div className="asset-buttons btn-group" role="group">
      <button className="btn btn-outline-secondary" onClick={command(controller.RTL)}>
        RTL
      </button>
      <button className="btn btn-outline-secondary" onClick={command(controller.Hold)}>
        Hold
      </button>
      <AltitudeSelect controller={controller} />
      <Goto controller={controller} />
      <button className="btn btn-outline-secondary" onClick={command(controller.Continue)}>
        Continue
      </button>
      <button className="btn btn-info" onClick={command(controller.Manual)}>
        Manual
      </button>
      <DisArm controller={controller} />
      <Terminate controller={controller} />
    </div>
  )
}

const dataAgeClass = (timestamp: string, old: number, warn: number, prefix: string) => {
  const dbTime = new Date(timestamp)
  const timeDelta = new Date().getTime() - dbTime.getTime()
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
const supersedeReasonLabel: Record<AckSupersedeReason, string> = {
  none: '',
  low_battery: 'low-battery RTL',
  comms_loss: 'comms-loss RTL',
  newer_command: 'newer command'
}

// Short name for the failsafe latch that engaged an RTL, used when an operator
// RTL was 'superseded' by a latch that ALSO flies RTL — the aircraft is doing
// what was asked, so we report it as in-effect rather than as a failure.
const supersedeLatchLabel: Partial<Record<AckSupersedeReason, string>> = {
  low_battery: 'low-battery',
  comms_loss: 'comms-loss'
}

// True when a 'superseded' RTL command is in effect anyway: the operator asked
// for RTL and a failsafe latch (low-battery / comms-loss) that also flies RTL
// took over. The operator's intent is satisfied, so this should not read as a
// red ✗ failure. A newer-command supersede or any non-RTL command is a real
// override and keeps the ✗.
const supersededRtlInEffect = (command: AssetCommandData): boolean =>
  command.command_code === 'RTL' && command.ack_superseded_by !== undefined && command.ack_superseded_by in supersedeLatchLabel

// Age (ms) of a command since it was dispatched, measured entirely on the
// server's clock: serverNow (epoch-ms from the same poll) minus the command's
// dispatch timestamp. This deliberately avoids the browser clock and the
// FMU-stamped ack_timestamp — mixing clocks lets skew (corrected elsewhere via
// RTT offset) produce a false 'no ack' or a timeout that never fires. When the
// server clock is unavailable, fall back to the browser clock so a missing
// ack still eventually surfaces rather than appearing stuck forever.
const commandAckAge = (command: AssetCommandData, serverNow?: number): number => {
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
const commandAckDisplay = (command: AssetCommandData, serverNow?: number): { text: string; className: string } => {
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
type AckOutcome = 'actioned' | 'noop' | 'in-flight' | 'no-ack' | 'received-stalled' | 'superseded' | 'rejected'

const commandAckOutcome = (command: AssetCommandData, serverNow?: number): AckOutcome => {
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
interface ServerCommandView {
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
const assetServerMisalignment = (asset: AssetState): { disagree: boolean; servers: ServerCommandView[] } => {
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

// Asset-level banner shown when an asset's servers disagree about its command.
// Surfaces a split that is otherwise buried in the separate per-server tabs:
// the operator can see at a glance that the servers are out of step and, by
// expanding, exactly which server differs and how.
const FSSAssetCommandMisalignment: React.FC<{ asset: AssetState }> = ({ asset }) => {
  const [expanded, setExpanded] = useState(false)
  const { disagree, servers } = assetServerMisalignment(asset)
  if (!disagree) {
    return null
  }
  return (
    <div className="asset-command-misalignment">
      <button type="button" className="asset-command-misalignment-badge" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        ⚠ servers disagree {expanded ? '▾' : '▸'}
      </button>
      {expanded && (
        <table className="asset-command-misalignment-detail">
          <thead>
            <tr>
              <td>Server</td>
              <td>Command</td>
              <td>Ack</td>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.serverName}>
                <td>{s.serverName}</td>
                <td>{s.commandCode ?? '—'}</td>
                <td className={s.ack.className}>{s.ack.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const FSSAssetServerStatus: React.FC<{ server: AssetServerState; serverLabel: string }> = ({ server, serverLabel }) => {
  const { data } = server
  let rttTable
  if (data?.rtt) {
    rttTable = (
      <table className={'asset-rtt-status ' + dataAgeClass(data.rtt.timestamp, rttTimeOld, rttTimeWarn, 'asset-rtt-time')}>
        <thead>
          <tr>
            <td>RTT (ms)</td>
            <td>min</td>
            <td>max</td>
            <td>avg</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="asset-rtt">{data.rtt.rtt}</td>
            <td className="asset-rtt">{data.rtt.rtt_min}</td>
            <td className="asset-rtt">{data.rtt.rtt_max}</td>
            <td className="asset-rtt">{data.rtt.rtt_avg}</td>
          </tr>
        </tbody>
      </table>
    )
  }
  let posTable
  if (data?.position) {
    posTable = (
      <table className={'asset-positon ' + dataAgeClass(data.position.timestamp, assetPositionTimeOld, assetPositionTimeWarn, 'asset-position')}>
        <thead>
          <tr>
            <td>Latitude</td>
            <td>Longitude</td>
            <td>Altitude (ft)</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{degreesToDM(data.position.lat, 'lat')}</td>
            <td>{degreesToDM(data.position.lng, 'lon')}</td>
            <td>{data.position.alt ?? 'N/A'}</td>
          </tr>
        </tbody>
      </table>
    )
  }
  let batteryTable
  if (data?.status) {
    let batteryClass = 'asset-battery-status'
    batteryClass += dataAgeClass(data.status.timestamp, batteryTimeOld, batteryTimeWarn, ' asset-battery-time')

    if (data.status.battery_percent < batteryCritical) {
      batteryClass += ' asset-battery-critical'
    } else if (data.status.battery_percent < batteryWarn) {
      batteryClass += ' asset-battery-warn'
    }
    batteryTable = (
      <table className={batteryClass}>
        <thead>
          <tr>
            <td>Remaining %</td>
            <td>Used (mAh)</td>
            <td>Voltage</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{data.status.battery_percent}</td>
            <td>{data.status.battery_used}</td>
            <td>{data.status.battery_voltage ?? 'N/A'}</td>
          </tr>
        </tbody>
      </table>
    )
  }
  let searchTable
  if (data?.search) {
    searchTable = (
      <table className={'asset-search-status ' + dataAgeClass(data.search.timestamp, searchTimeOld, searchTimeWarn, 'asset-search-time')}>
        <thead>
          <tr>
            <td>Search</td>
            <td>Completed</td>
            <td>Total</td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{data.search.id}</td>
            <td>{data.search.progress}</td>
            <td>{data.search.total}</td>
          </tr>
        </tbody>
      </table>
    )
  }
  let commandTxt: ReactNode = ''
  let commandAck: ReactNode = ''
  if (data?.command) {
    let text = data.command.command
    if (data.command.command_code === 'GOTO') {
      if (data.command.lat && data.command.lng) {
        text += ` ${degreesToDM(data.command.lat, 'lat')}, ${degreesToDM(data.command.lng, 'lon')}`
      }
    }
    if (data.command.command_code === 'ALT') {
      text += ` to ${data.command.alt}ft`
    }
    commandTxt = data.command.command_code === 'MAN' ? <strong>Take Manual Control Now</strong> : text
    const ack = commandAckDisplay(data.command, server.serverNow)
    commandAck = <span className={'asset-status-command-ack ' + ack.className}> {ack.text}</span>
  }
  return (
    <div className="asset-status-server">
      <div className="asset-status-server-label">{serverLabel}</div>
      <div className="asset-status-command">
        {commandTxt}
        {commandAck}
      </div>
      {rttTable}
      {posTable}
      {batteryTable}
      {searchTable}
    </div>
  )
}

interface FSSAssetStatusProps {
  asset: AssetState
  setSelected: (asset: string, server: string) => void
}

const FSSAssetStatus: React.FC<FSSAssetStatusProps> = ({ asset, setSelected }) => {
  const selectServer = (e: React.MouseEvent<HTMLButtonElement>) => {
    setSelected(asset.name, e.currentTarget.name)
  }

  const assetServers = Object.values(asset.servers).filter((s) => s.data)

  return (
    <div className="container card">
      <FSSAssetCommandMisalignment asset={asset} />
      <ul className="nav nav-tabs server-tab-btn">
        {assetServers.map((server) => (
          <li className="nav-item" key={server.serverName}>
            <button data-toggle="tab" className="nav-link server-tab-btn" name={server.serverName} onClick={selectServer}>
              {server.serverName}
            </button>
          </li>
        ))}
      </ul>
      <div className="asset-status">
        {asset.selectedServerName && asset.servers[asset.selectedServerName] && (
          <FSSAssetServerStatus server={asset.servers[asset.selectedServerName]} serverLabel={asset.selectedServerName} />
        )}
      </div>
    </div>
  )
}

interface FSSAssetContainerProps {
  asset: AssetState
  knownServers: Record<string, ServerState>
  setSelected: (asset: string, server: string) => void
}

function FSSAsset(props: FSSAssetContainerProps) {
  const { asset, knownServers, setSelected } = props
  const controller = useMemo(() => createAssetController(knownServers, asset), [knownServers, asset])
  return (
    <div className="asset">
      <div className="asset-label">{asset.name}</div>
      <FSSAssetControls controller={controller} />
      <FSSAssetStatus asset={asset} setSelected={setSelected} />
    </div>
  )
}

interface FSSAssetSetProps {
  knownAssets: AssetState[]
  knownServers: Record<string, ServerState>
  setSelected: (asset: string, server: string) => void
}

function FSSAssetSet(props: FSSAssetSetProps) {
  const { knownAssets, knownServers, setSelected } = props
  return (
    <div className="bar-assets">
      {knownAssets.map((asset) => (
        <FSSAsset key={asset.name} asset={asset} knownServers={knownServers} setSelected={setSelected} />
      ))}
    </div>
  )
}

interface FSSServerProps {
  server: ServerState
}

function FSSServer(props: FSSServerProps) {
  const { server } = props
  return (
    <div className="server">
      <div className={`server-label server-label-${server.connected ? 'connected' : 'failure'}`}>{server.name}</div>
      <table className="server-status">
        <tbody>
          <tr>
            <td>{server.status}</td>
          </tr>
        </tbody>
      </table>
      <div className="server-login">{server.userName ? `Logged in as: ${server.userName}` : <a href={getServerURL(server, '/login/')}>Login Here</a>}</div>
    </div>
  )
}

interface FSSServerBarProps {
  knownServers: ServerState[]
}

function FSSServerBar(props: FSSServerBarProps) {
  const { knownServers } = props
  return (
    <div className="bar-server">
      {knownServers.map((server) => (
        <FSSServer key={server.name} server={server} />
      ))}
    </div>
  )
}

export const FSSMainPage: React.FC = () => {
  const [knownServers, setKnownServers] = useState<Record<string, ServerState>>({
    direct: createServer('direct', '127.0.0.1', 0, window.location.origin)
  })
  const [knownAssets, setKnownAssets] = useState<Record<string, AssetState>>({})
  const [lastError, setLastError] = useState<string | null>(null)

  // Latest-value refs for polling
  const knownServersRef = useRef(knownServers)
  const knownAssetsRef = useRef(knownAssets)
  knownServersRef.current = knownServers
  knownAssetsRef.current = knownAssets

  const pollAbortRef = useRef<AbortController | null>(null)

  const updateData = useCallback(async () => {
    pollAbortRef.current?.abort()
    const ac = new AbortController()
    pollAbortRef.current = ac

    const snapshotServers = knownServersRef.current
    const serverNames = Object.keys(snapshotServers)

    const results = await Promise.all(
      serverNames.map(async (serverName) => {
        const server = snapshotServers[serverName]
        try {
          const response = await fetch(getServerURL(server, '/current/all.json/'), { credentials: 'include', signal: ac.signal })
          if (response.status === 403) return { serverName, data: null, unauthenticated: true }
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          return { serverName, data, unauthenticated: false }
        } catch {
          return { serverName, data: null, unauthenticated: false }
        }
      })
    )

    if (ac.signal.aborted) return

    let currentServers = { ...knownServersRef.current }
    let currentAssets = { ...knownAssetsRef.current }

    for (const { serverName, data, unauthenticated } of results) {
      if (data === null) {
        if (unauthenticated) {
          currentServers = { ...currentServers, [serverName]: serverUnauthenticated(currentServers[serverName]) }
        } else {
          currentServers = { ...currentServers, [serverName]: serverConnectFailed(currentServers[serverName]) }
        }
      } else {
        currentServers = mergeServerPollResult(currentServers, serverName, data)
        currentAssets = mergeServerAssets(currentAssets, serverName, data.assets, data.server_now)
      }
    }

    setKnownServers(currentServers)
    setKnownAssets(currentAssets)
  }, [])

  useEffect(() => {
    updateData()
    const timer = setInterval(() => updateData(), 3000)
    return () => {
      clearInterval(timer)
      pollAbortRef.current?.abort()
    }
  }, [updateData])

  const setAssetSelectedServer = (assetName: string, serverName: string) => {
    setKnownAssets((prev) => {
      const asset = prev[assetName]
      if (!asset) return prev
      return {
        ...prev,
        [assetName]: {
          ...asset,
          selectedServerName: serverName
        }
      }
    })
  }

  return (
    <ErrorContext.Provider value={setLastError}>
      <div>
        {lastError && (
          <div className="alert alert-danger alert-dismissible fade show m-3" role="alert">
            <strong>Command Failure:</strong> {lastError}
            <button type="button" className="btn-close" onClick={() => setLastError(null)} aria-label="Close"></button>
          </div>
        )}
        <FSSServerBar knownServers={Object.values(knownServers)} />
        <FSSAssetSet knownAssets={Object.values(knownAssets)} knownServers={knownServers} setSelected={setAssetSelectedServer} />
      </div>
    </ErrorContext.Provider>
  )
}
