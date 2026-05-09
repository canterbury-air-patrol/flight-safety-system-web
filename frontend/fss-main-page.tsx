import { degreesToDM, DMToDegrees } from '@canterbury-air-patrol/deg-converter'
import { AssetState, AssetServerState, AssetController, createAssetController, mergeServerAssets } from './asset'
import { ServerState, createServer, getServerURL, serverConnectFailed, AssetPositionData, mergeServerPollResult } from './server'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L, { DragEndEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'
import React, { ReactNode, useState, useEffect, useRef, useCallback, useMemo } from 'react'

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

L.Icon.Default.prototype.options.iconUrl = markerIcon
L.Icon.Default.prototype.options.iconRetinaUrl = markerIcon2x
L.Icon.Default.prototype.options.shadowUrl = markerIconShadow

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

  const handleSet = (onClose: () => void) => {
    controller.Altitude(newAltitude)
    onClose()
  }

  return (
    <ModalWithButton
      label="Altitude"
      variant="outline-secondary"
      title="Set Target Altitude:"
      body={
        <>
          New Altitude: <input type="text" size={3} maxLength={3} min="0" max="999" onChange={(e) => setNewAltitude(Number(e.target.value))} value={newAltitude}></input>
          ft
        </>
      }
      footer={(onClose) => (
        <>
          <Button variant="light" onClick={() => handleSet(onClose)}>
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

  const onShow = () => {
    setPosition(controller.positionMostRecent())
  }

  const handleGoto = (onClose: () => void) => {
    if (position) {
      controller.Goto(position.lat, position.lng)
    }
    onClose()
  }

  const handlePositionChange = (event: React.ChangeEvent<HTMLInputElement>, isLat: boolean) => {
    const { value } = event.target
    const positionValue = DMToDegrees(value)
    setPosition((prev) => {
      const current = prev || getDefaultPosition()
      return { ...current, [isLat ? 'lat' : 'lng']: positionValue }
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
          <input type="text" value={degreesToDM(pos.lat, true)} onChange={(e) => handlePositionChange(e, true)}></input>
          <input type="text" value={degreesToDM(pos.lng, false)} onChange={(e) => handlePositionChange(e, false)}></input>
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
          <Button variant="light" onClick={() => handleGoto(onClose)}>
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
  return (
    <ModalWithButton
      label="DisArm"
      variant="danger"
      title={<>Disarm {controller.name}</>}
      body={<>Warning this will probably result in the aircraft crashing. Use only when all other options are unsafe.</>}
      footer={(onClose) => (
        <>
          <Button
            variant="danger"
            onClick={() => {
              controller.DisArm()
              onClose()
            }}
          >
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
          <Button
            variant="danger"
            onClick={() => {
              controller.Terminate()
              onClose()
            }}
          >
            Terminate Flight
          </Button>
          <Button
            variant="light"
            onClick={() => {
              controller.RTL()
              onClose()
            }}
          >
            RTL
          </Button>
          <Button
            variant="light"
            onClick={() => {
              controller.Hold()
              onClose()
            }}
          >
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
  return (
    <div className="asset-buttons btn-group" role="group">
      <button className="btn btn-outline-secondary" onClick={controller.RTL}>
        RTL
      </button>
      <button className="btn btn-outline-secondary" onClick={controller.Hold}>
        Hold
      </button>
      <AltitudeSelect controller={controller} />
      <Goto controller={controller} />
      <button className="btn btn-outline-secondary" onClick={controller.Continue}>
        Continue
      </button>
      <button className="btn btn-info" onClick={controller.Manual}>
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
            <td>{degreesToDM(data.position.lat, true)}</td>
            <td>{degreesToDM(data.position.lng, false)}</td>
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
            <td>{data.status.battery_voltage}</td>
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
  if (data?.command) {
    commandTxt = data.command.command
    if (data.command.command === 'Goto Position') {
      if (data.command.lat && data.command.lng) {
        commandTxt += ` ${degreesToDM(data.command.lat, true)}, ${degreesToDM(data.command.lng, false)}`
      }
    }
    if (data.command.command === 'Adjust Altitude') {
      commandTxt += ` to ${data.command.alt}ft`
    }
    if (data.command.command === 'Manual') {
      commandTxt = <strong>Take Manual Control Now</strong>
    }
  }
  return (
    <div className="asset-status-server">
      <div className="asset-status-server-label">{serverLabel}</div>
      <div className="asset-status-command">{commandTxt}</div>
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
    direct: createServer('direct', '127.0.0.1', 0, window.location.href.slice(0, -1))
  })
  const [knownAssets, setKnownAssets] = useState<Record<string, AssetState>>({})

  // Latest-value refs for polling
  const knownServersRef = useRef(knownServers)
  const knownAssetsRef = useRef(knownAssets)
  knownServersRef.current = knownServers
  knownAssetsRef.current = knownAssets

  const updateData = useCallback(async () => {
    const snapshotServers = knownServersRef.current
    const serverNames = Object.keys(snapshotServers)

    const results = await Promise.all(
      serverNames.map(async (serverName) => {
        const server = snapshotServers[serverName]
        try {
          const response = await fetch(getServerURL(server, '/current/all.json/'))
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          return { serverName, data }
        } catch (error) {
          console.error(`Error fetching server status for ${serverName}:`, error)
          return { serverName, data: null }
        }
      })
    )

    let currentServers = { ...knownServersRef.current }
    let currentAssets = { ...knownAssetsRef.current }

    for (const { serverName, data } of results) {
      if (data === null) {
        currentServers = { ...currentServers, [serverName]: serverConnectFailed(currentServers[serverName]) }
      } else {
        currentServers = mergeServerPollResult(currentServers, serverName, data)
        currentAssets = mergeServerAssets(currentAssets, serverName, data.assets)
      }
    }

    setKnownServers(currentServers)
    setKnownAssets(currentAssets)
  }, [])

  useEffect(() => {
    updateData()
    const timer = setInterval(() => updateData(), 3000)
    return () => clearInterval(timer)
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
    <div>
      <FSSServerBar knownServers={Object.values(knownServers)} />
      <FSSAssetSet knownAssets={Object.values(knownAssets)} knownServers={knownServers} setSelected={setAssetSelectedServer} />
    </div>
  )
}
