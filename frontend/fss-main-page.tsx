import { type Axis, degreesToDM, DMToDegrees } from '@canterbury-air-patrol/deg-converter'
import {
  AssetState,
  AssetServerState,
  AssetController,
  CommandDispatchError,
  CommandSubmissionGuard,
  assetCommandAvailability,
  createAssetController,
  mergeServerAssets,
  pruneAssetServers
} from './asset'
import {
  ServerState,
  canonicalServerOrigin,
  createServer,
  getServerURL,
  serverConnectFailed,
  serverUnauthenticated,
  AssetPositionData,
  mergeServerPollResult,
  reconcileServerTopology,
  serverTopologyMismatch
} from './server'
import {
  assetPositionTimeWarn,
  assetPositionTimeOld,
  batteryCritical,
  batteryWarn,
  batteryTimeWarn,
  batteryTimeOld,
  searchTimeWarn,
  searchTimeOld,
  rttTimeWarn,
  rttTimeOld,
  dataAgeClass,
  positionEstimateDeltaSeconds,
  commandAckDisplay,
  assetServerMisalignment
} from './rendering'
import { DisArm, ModalWithButton, Terminate } from './destructive-command-controls'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L, { DragEndEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'
import React, { ReactNode, useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIconShadow from 'leaflet/dist/images/marker-shadow.png'
import { Button } from 'react-bootstrap'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'

/* definitions */
// Poll cadence, and how long a single server's fetch may take before it is
// treated as unreachable. The fetch timeout must stay comfortably below the
// poll interval so one hung/blackholed peer resolves to "unreachable" well
// before the next cycle starts, instead of stalling every server's data
// behind it.
const pollIntervalMs = 3 * 1000
const pollFetchTimeoutMs = 2.5 * 1000

L.Icon.Default.prototype.options.iconUrl = markerIcon
L.Icon.Default.prototype.options.iconRetinaUrl = markerIcon2x
L.Icon.Default.prototype.options.shadowUrl = markerIconShadow

interface CommandFailure {
  message: string
  retry?: () => Promise<void>
}

const commandFailure = (error: unknown): CommandFailure => ({
  message: error instanceof Error ? error.message : String(error),
  retry: error instanceof CommandDispatchError ? error.retry : undefined
})

const ErrorContext = React.createContext<(failure: CommandFailure | null) => void>(() => {})

const useCommand = () => {
  const setLastError = useContext(ErrorContext)
  return (fn: () => Promise<void> | void, onClose?: () => void) => async () => {
    try {
      await Promise.resolve(fn())
      onClose?.()
    } catch (e) {
      setLastError(commandFailure(e))
    }
  }
}

interface AssetProps {
  controller: AssetController
  disabled?: boolean
}

const AltitudeSelect: React.FC<AssetProps> = ({ controller, disabled = false }) => {
  const [newAltitude, setNewAltitude] = useState(100)
  const command = useCommand()

  return (
    <ModalWithButton
      label="Altitude"
      variant="outline-secondary"
      disabled={disabled}
      title="Set Target Altitude:"
      body={
        <>
          New Altitude: <input type="number" size={3} min="0" max="999" onChange={(e) => setNewAltitude(Number(e.target.value))} value={newAltitude}></input>
          ft
        </>
      }
      footer={(onClose) => (
        <>
          <Button variant="light" onClick={command(() => controller.Altitude(newAltitude), onClose)} disabled={disabled}>
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

const Goto: React.FC<AssetProps> = ({ controller, disabled = false }) => {
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
      disabled={disabled}
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
          <Button variant="light" onClick={handleGoto(onClose)} disabled={disabled || !position}>
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

export const FSSAssetControls: React.FC<AssetProps> = ({ controller, disabled = false }) => {
  const command = useCommand()

  return (
    <div className="asset-buttons btn-group" role="group">
      <button className="btn btn-outline-secondary" onClick={command(controller.RTL)} disabled={disabled}>
        RTL
      </button>
      <button className="btn btn-outline-secondary" onClick={command(controller.Hold)} disabled={disabled}>
        Hold
      </button>
      <AltitudeSelect controller={controller} disabled={disabled} />
      <Goto controller={controller} disabled={disabled} />
      <button className="btn btn-outline-secondary" onClick={command(controller.Continue)} disabled={disabled}>
        Continue
      </button>
      <button className="btn btn-info" onClick={command(controller.Manual)} disabled={disabled}>
        Manual
      </button>
      <DisArm controller={controller} command={command} disabled={disabled} />
      <Terminate controller={controller} command={command} disabled={disabled} />
    </div>
  )
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
              <tr key={s.serverKey}>
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

const FSSPositionTable: React.FC<{
  position: AssetPositionData
  label?: string
  agePrefix: string
  serverNow?: number
}> = ({ position, label, agePrefix, serverNow }) => (
  <div className="asset-position-block">
    {label && <div className="asset-position-label">{label}</div>}
    <table className={'asset-position ' + dataAgeClass(position.timestamp, assetPositionTimeOld, assetPositionTimeWarn, agePrefix, serverNow)}>
      <thead>
        <tr>
          <td>Latitude</td>
          <td>Longitude</td>
          <td>Altitude (ft)</td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{degreesToDM(position.lat, 'lat')}</td>
          <td>{degreesToDM(position.lng, 'lon')}</td>
          <td>{position.alt ?? 'N/A'}</td>
        </tr>
      </tbody>
    </table>
  </div>
)

const FSSAssetServerStatus: React.FC<{ server: AssetServerState; serverLabel: string }> = ({ server, serverLabel }) => {
  const { data } = server
  const noGpsFix = data?.gps?.fix_valid === false
  let rttTable
  if (data?.rtt) {
    rttTable = (
      <table className={'asset-rtt-status ' + dataAgeClass(data.rtt.timestamp, rttTimeOld, rttTimeWarn, 'asset-rtt-time', server.serverNow)}>
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
    posTable = <FSSPositionTable position={data.position} label={noGpsFix ? 'Last GPS position' : undefined} agePrefix="asset-position" serverNow={server.serverNow} />
  }
  let positionEstimateTable
  if (noGpsFix && data.position_estimate) {
    positionEstimateTable = <FSSPositionTable position={data.position_estimate} label="Dead-reckoned estimate" agePrefix="asset-position-estimate" serverNow={server.serverNow} />
  }
  let gpsWarning
  if (noGpsFix) {
    let detail
    if (data.position && data.position_estimate) {
      const delta = positionEstimateDeltaSeconds(data.position.timestamp, data.position_estimate.timestamp)
      detail = `Dead-reckoned estimate is ${delta} s after the last GPS fix.`
    } else if (data.position) {
      detail = 'No dead-reckoned position is available; showing the last GPS position.'
    } else if (data.position_estimate) {
      detail = 'No GPS-backed position has been recorded; showing the dead-reckoned estimate.'
    } else {
      detail = 'No GPS-backed or dead-reckoned position is available.'
    }
    gpsWarning = (
      <div className="alert alert-warning asset-gps-warning" role="alert">
        <strong>No GPS Fix</strong> — {detail}
      </div>
    )
  }
  let batteryTable
  if (data?.status) {
    let batteryClass = 'asset-battery-status'
    batteryClass += dataAgeClass(data.status.timestamp, batteryTimeOld, batteryTimeWarn, ' asset-battery-time', server.serverNow)

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
      <table className={'asset-search-status ' + dataAgeClass(data.search.timestamp, searchTimeOld, searchTimeWarn, 'asset-search-time', server.serverNow)}>
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
      if (data.command.lat != null && data.command.lng != null) {
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
      {gpsWarning}
      {rttTable}
      {posTable}
      {positionEstimateTable}
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

  const assetServers = Object.entries(asset.servers).filter(([, server]) => server.data)

  return (
    <div className="container card">
      <FSSAssetCommandMisalignment asset={asset} />
      <ul className="nav nav-tabs server-tab-btn">
        {assetServers.map(([serverKey, server]) => (
          <li className="nav-item" key={serverKey}>
            <button data-toggle="tab" className="nav-link server-tab-btn" name={serverKey} onClick={selectServer}>
              {server.serverName}
            </button>
          </li>
        ))}
      </ul>
      <div className="asset-status">
        {asset.selectedServerKey && asset.servers[asset.selectedServerKey] && (
          <FSSAssetServerStatus server={asset.servers[asset.selectedServerKey]} serverLabel={asset.servers[asset.selectedServerKey].serverName} />
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

export function FSSAsset(props: FSSAssetContainerProps) {
  const { asset, knownServers, setSelected } = props
  const [commandInFlight, setCommandInFlight] = useState(false)
  const commandInFlightRef = useRef(false)
  const submissionGuard = useMemo<CommandSubmissionGuard>(
    () => ({
      acquire: () => {
        if (commandInFlightRef.current) return false
        commandInFlightRef.current = true
        setCommandInFlight(true)
        return true
      },
      release: () => {
        commandInFlightRef.current = false
        setCommandInFlight(false)
      }
    }),
    []
  )
  const controller = useMemo(() => createAssetController(knownServers, asset, submissionGuard), [knownServers, asset, submissionGuard])
  const commandAvailability = useMemo(() => assetCommandAvailability(knownServers, asset), [knownServers, asset])
  const controlsDisabled = commandInFlight || !commandAvailability.commandable
  return (
    <div className="asset">
      <div className="asset-label">{asset.name}</div>
      {!commandAvailability.commandable && (
        <div className="alert alert-warning asset-command-disabled" role="status">
          <strong>Commands disabled:</strong> {commandAvailability.blockedReasons.join(', ')}
        </div>
      )}
      <FSSAssetControls controller={controller} disabled={controlsDisabled} />
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

export function FSSServerBar(props: FSSServerBarProps) {
  const { knownServers } = props
  const reachableServers = knownServers.filter((server) => server.connected).length
  const redundancyLost = reachableServers < 2
  const serverNoun = reachableServers === 1 ? 'server' : 'servers'
  const topologyMismatch = serverTopologyMismatch(knownServers)
  return (
    <div className="bar-server">
      <div className={`alert ${redundancyLost ? 'alert-danger' : 'alert-success'} system-status`} role="status">
        <strong>Systems: {redundancyLost ? 'Critical' : 'Nominal'}</strong>
        {' — '}
        {redundancyLost ? `Redundancy lost: ${reachableServers} FSS ${serverNoun} reachable; 2 required` : `${reachableServers} FSS ${serverNoun} reachable`}
      </div>
      {topologyMismatch.length > 0 && (
        <div className="alert alert-warning topology-mismatch" role="alert">
          <strong>Server topology mismatch</strong> — peers advertise different FSS server sets.
          <ul>
            {topologyMismatch.map((snapshot) => (
              <li key={snapshot.serverOrigin}>
                {snapshot.serverName}: {snapshot.origins.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {knownServers.map((server) => (
        <FSSServer key={server.url} server={server} />
      ))}
    </div>
  )
}

export const FSSMainPage: React.FC = () => {
  const directServerKey = canonicalServerOrigin(window.location.origin)
  const [knownServers, setKnownServers] = useState<Record<string, ServerState>>({
    [directServerKey]: createServer('direct', '127.0.0.1', 0, window.location.origin)
  })
  const [knownAssets, setKnownAssets] = useState<Record<string, AssetState>>({})
  const [lastError, setLastError] = useState<CommandFailure | null>(null)
  const [retryingCommand, setRetryingCommand] = useState(false)

  // Latest-value refs for polling
  const knownServersRef = useRef(knownServers)
  const knownAssetsRef = useRef(knownAssets)
  knownServersRef.current = knownServers
  knownAssetsRef.current = knownAssets

  const pollAbortRef = useRef<AbortController | null>(null)
  const unmountedRef = useRef(false)

  const updateData = useCallback(async () => {
    pollAbortRef.current?.abort()
    const ac = new AbortController()
    pollAbortRef.current = ac

    const snapshotServers = knownServersRef.current
    const serverKeys = Object.keys(snapshotServers)

    const results = await Promise.all(
      serverKeys.map(async (serverKey) => {
        const server = snapshotServers[serverKey]
        // Bound each server's fetch independently so one hung/blackholed peer
        // can't stall the other servers' otherwise-successful data behind it.
        const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(pollFetchTimeoutMs)])
        try {
          const response = await fetch(getServerURL(server, '/current/all.json/'), { credentials: 'include', signal })
          if (response.status === 403) return { serverKey, data: null, unauthenticated: true }
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          return { serverKey, data, unauthenticated: false }
        } catch {
          return { serverKey, data: null, unauthenticated: false }
        }
      })
    )

    // A superseded cycle (aborted by a newer one starting) may still have
    // resolved good data for some servers before being superseded; apply it
    // rather than discarding it wholesale. Only bail if the component itself
    // unmounted meanwhile.
    if (unmountedRef.current) return

    let currentServers = { ...knownServersRef.current }
    let currentAssets = { ...knownAssetsRef.current }

    for (const { serverKey, data, unauthenticated } of results) {
      // A newer cycle may already have pruned a server while this superseded
      // request was resolving. Its stale result must not resurrect the origin.
      if (!currentServers[serverKey]) continue
      if (data === null) {
        if (unauthenticated) {
          currentServers = { ...currentServers, [serverKey]: serverUnauthenticated(currentServers[serverKey]) }
        } else {
          currentServers = { ...currentServers, [serverKey]: serverConnectFailed(currentServers[serverKey]) }
        }
      } else {
        currentServers = mergeServerPollResult(currentServers, serverKey, data)
      }
    }

    currentServers = reconcileServerTopology(currentServers, directServerKey)

    for (const { serverKey, data } of results) {
      if (data !== null && currentServers[serverKey]) {
        currentAssets = mergeServerAssets(currentAssets, serverKey, currentServers[serverKey].name, data.assets, data.server_now)
      }
    }
    currentAssets = pruneAssetServers(currentAssets, new Set(Object.keys(currentServers)))

    setKnownServers(currentServers)
    setKnownAssets(currentAssets)
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    updateData()
    const timer = setInterval(() => updateData(), pollIntervalMs)
    return () => {
      unmountedRef.current = true
      clearInterval(timer)
      pollAbortRef.current?.abort()
    }
  }, [updateData])

  const setAssetSelectedServer = (assetName: string, serverKey: string) => {
    setKnownAssets((prev) => {
      const asset = prev[assetName]
      if (!asset) return prev
      return {
        ...prev,
        [assetName]: {
          ...asset,
          selectedServerKey: serverKey
        }
      }
    })
  }

  const retryLastCommand = async () => {
    if (!lastError?.retry || retryingCommand) return
    setRetryingCommand(true)
    try {
      await lastError.retry()
      setLastError(null)
    } catch (error) {
      setLastError(commandFailure(error))
    } finally {
      setRetryingCommand(false)
    }
  }

  return (
    <ErrorContext.Provider value={setLastError}>
      <div>
        {lastError && (
          <div className="alert alert-danger alert-dismissible fade show m-3" role="alert">
            <strong>Command Failure:</strong> {lastError.message}
            {lastError.retry && (
              <button type="button" className="btn btn-danger ms-2" onClick={retryLastCommand} disabled={retryingCommand}>
                Retry failed servers
              </button>
            )}
            <button type="button" className="btn-close" onClick={() => setLastError(null)} aria-label="Close"></button>
          </div>
        )}
        <FSSServerBar knownServers={Object.values(knownServers)} />
        <FSSAssetSet knownAssets={Object.values(knownAssets)} knownServers={knownServers} setSelected={setAssetSelectedServer} />
      </div>
    </ErrorContext.Provider>
  )
}
