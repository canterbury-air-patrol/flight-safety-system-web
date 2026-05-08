import { degreesToDM, DMToDegrees } from '@canterbury-air-patrol/deg-converter'
import { Server, ServerDetails, AssetPositionData, AssetStatus } from './server'
import { Asset, AssetServer } from './asset'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L, { DragEndEvent } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'
import React, { ReactNode, useState } from 'react'

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
  asset: Asset
}

const AltitudeSelect: React.FC<AssetProps> = ({ asset }) => {
  const [newAltitude, setNewAltitude] = useState(100)

  const handleSet = (onClose: () => void) => {
    asset.Altitude(newAltitude)
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

const Goto: React.FC<AssetProps> = ({ asset }) => {
  const [position, setPosition] = useState<AssetPositionData | undefined>(undefined)

  const onShow = () => {
    setPosition(asset.positionMostRecent())
  }

  const handleGoto = (onClose: () => void) => {
    if (position) {
      asset.Goto(position.lat, position.lng)
    }
    onClose()
  }

  const handlePositionChange = (event: React.ChangeEvent<HTMLInputElement>, isLat: boolean) => {
    const { value } = event.target
    const positionValue = DMToDegrees(value)
    setPosition((prev) => {
      const current = prev || { timestamp: '', lat: 0, lng: 0 }
      return { ...current, [isLat ? 'lat' : 'lng']: positionValue }
    })
  }

  const dragEnd = (event: DragEndEvent) => {
    setPosition(event.target.getLatLng())
  }

  const pos = position || { timestamp: '', lat: 0, lng: 0 }

  return (
    <ModalWithButton
      label="Goto"
      variant="outline-secondary"
      onShow={onShow}
      title={<>Send {asset.name} to:</>}
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

const DisArm: React.FC<AssetProps> = ({ asset }) => {
  return (
    <ModalWithButton
      label="DisArm"
      variant="danger"
      title={<>Disarm {asset.name}</>}
      body={<>Warning this will probably result in the aircraft crashing. Use only when all other options are unsafe.</>}
      footer={(onClose) => (
        <>
          <Button
            variant="danger"
            onClick={() => {
              asset.DisArm()
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

const Terminate: React.FC<AssetProps> = ({ asset }) => {
  return (
    <ModalWithButton
      label="Terminate"
      variant="danger"
      title={<>Terminate {asset.name}</>}
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
              asset.Terminate()
              onClose()
            }}
          >
            Terminate Flight
          </Button>
          <Button
            variant="light"
            onClick={() => {
              asset.RTL()
              onClose()
            }}
          >
            RTL
          </Button>
          <Button
            variant="light"
            onClick={() => {
              asset.Hold()
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

const FSSAssetControls: React.FC<AssetProps> = ({ asset }) => {
  return (
    <div className="asset-buttons btn-group" role="group">
      <button className="btn btn-outline-secondary" onClick={() => asset.RTL()}>
        RTL
      </button>
      <button className="btn btn-outline-secondary" onClick={() => asset.Hold()}>
        Hold
      </button>
      <AltitudeSelect asset={asset} />
      <Goto asset={asset} />
      <button className="btn btn-outline-secondary" onClick={() => asset.Continue()}>
        Continue
      </button>
      <button className="btn btn-info" onClick={() => asset.Manual()}>
        Manual
      </button>
      <DisArm asset={asset} />
      <Terminate asset={asset} />
    </div>
  )
}

interface FSSAssetServerStatusProps {
  server: AssetServer
}

class FSSAssetServerStatus extends React.Component<FSSAssetServerStatusProps, never> {
  dataAgeClass(timestamp: string, old: number, warn: number, prefix: string) {
    const dbTime = new Date(timestamp)
    const timeDelta = new Date().getTime() - dbTime.getTime()
    if (timeDelta > old) {
      return `${prefix}-old`
    } else if (timeDelta > warn) {
      return `${prefix}-warn`
    }
    return ''
  }

  render() {
    const { data } = this.props.server
    let rttTable
    if (data?.rtt) {
      rttTable = (
        <table className={'asset-rtt-status ' + this.dataAgeClass(data.rtt.timestamp, rttTimeOld, rttTimeWarn, 'asset-rtt-time')}>
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
        <table className={'asset-positon ' + this.dataAgeClass(data.position.timestamp, assetPositionTimeOld, assetPositionTimeWarn, 'asset-position')}>
          <thead>
            <tr>
              <td>Latitude</td>
              <td>Longitude</td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{degreesToDM(data.position.lat, true)}</td>
              <td>{degreesToDM(data.position.lng, false)}</td>
            </tr>
          </tbody>
        </table>
      )
    }
    let batteryTable
    if (data?.status) {
      let batteryClass = 'asset-battery-status'
      batteryClass += this.dataAgeClass(data.status.timestamp, batteryTimeOld, batteryTimeWarn, ' asset-battery-time')

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
        <table className={'asset-search-status ' + this.dataAgeClass(data.search.timestamp, searchTimeOld, searchTimeWarn, 'asset-search-time')}>
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
        <div className="asset-status-server-label">{this.props.server.server.name}</div>
        <div className="asset-status-command">{commandTxt}</div>
        {rttTable}
        {posTable}
        {batteryTable}
        {searchTable}
      </div>
    )
  }
}

interface FSSAssetStatusProps {
  asset: Asset
  setSelected: (asset: string, server: string) => void
}

class FSSAssetStatus extends React.Component<FSSAssetStatusProps, never> {
  constructor(props: FSSAssetStatusProps) {
    super(props)

    this.selectServer = this.selectServer.bind(this)
  }

  selectServer(e: React.MouseEvent<HTMLButtonElement>) {
    this.props.setSelected(this.props.asset.name, e.target.name)
  }

  render() {
    const { asset } = this.props
    return (
      <div className="container card">
        <ul className="nav nav-tabs server-tab-btn">
          {asset.servers
            .filter((server) => server.data)
            .map((server) => (
              <li className="nav-item" key={server.server.name}>
                <button data-toggle="tab" className="nav-link server-tab-btn" name={server.server.name} onClick={this.selectServer}>
                  {server.server.name}
                </button>
              </li>
            ))}
        </ul>
        <div className="asset-status">{asset.selectedServer && <FSSAssetServerStatus server={asset.selectedServer} />}</div>
      </div>
    )
  }
}

interface FSSAssetProps {
  asset: Asset
  setSelected: (asset: string, server: string) => void
}

function FSSAsset(props: FSSAssetProps) {
  const { asset } = props
  return (
    <div className="asset">
      <div className="asset-label">{asset.name}</div>
      <FSSAssetControls asset={asset} />
      <FSSAssetStatus asset={asset} setSelected={props.setSelected} />
    </div>
  )
}

interface FSSAssetSetProps {
  knownAssets: Array<Asset>
  setSelected: (asset: string, server: string) => void
}

function FSSAssetSet(props: FSSAssetSetProps) {
  const { knownAssets, setSelected } = props
  return (
    <div className="bar-assets">
      {knownAssets.map((asset) => (
        <FSSAsset key={asset.name} asset={asset} setSelected={setSelected} />
      ))}
    </div>
  )
}

interface FSSServerProps {
  server: Server
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
      <div className="server-login">{server.userName ? `Logged in as: ${server.userName}` : <a href={server.getURL('/login/')}>Login Here</a>}</div>
    </div>
  )
}

interface FSSServerBarProps {
  knownServers: Array<Server>
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

interface FSSMainPageState {
  knownServers: Array<Server>
  knownAssets: Array<Asset>
}

export class FSSMainPage extends React.Component<never, FSSMainPageState> {
  timer?: number

  constructor(props: never) {
    super(props)

    this.state = {
      knownServers: [],
      knownAssets: []
    }

    this.state.knownServers.push(new Server('direct', '127.0.0.1', 0, window.location.href.slice(0, -1)))
    this.setAssetSelectedServer = this.setAssetSelectedServer.bind(this)
  }

  componentDidMount() {
    this.updateData()
    this.timer = setInterval(() => this.updateData(), 3000)
  }

  componentWillUnmount() {
    clearInterval(this.timer)
    this.timer = undefined
  }

  serversUpdateKnown() {
    const { knownServers } = this.state
    for (const ks in knownServers) {
      const server = knownServers[ks]
      for (const s in server.servers) {
        this.serverAdd(server.servers[s])
      }
    }
  }

  assetAdd(assetName: string): Asset {
    const existing = this.assetFind(assetName)
    if (!existing) {
      const newAsset = new Asset(assetName)
      this.setState((prevState) => ({
        knownAssets: [...prevState.knownAssets, newAsset]
      }))
      return newAsset
    }
    return existing
  }

  assetFind(assetName: string): Asset | undefined {
    return this.state.knownAssets.find((asset) => asset.name === assetName)
  }

  assetUpdate(assetName: string, server: Server, assetData: AssetStatus) {
    const asset = this.assetAdd(assetName)
    const assetServer = asset.serverAdd(server, assetData.asset.pk)
    assetServer.updateData(assetData)
  }

  async updateData() {
    this.serversUpdateKnown()
    const { knownServers } = this.state
    for (const ks in knownServers) {
      const server = knownServers[ks]
      await server.updateStatus()
      for (const a in server.assets) {
        const asset = server.assets[a]
        this.assetUpdate(asset.asset.name, server, asset)
      }
    }
    this.setState({})
  }

  serverAdd(server: ServerDetails) {
    const existing = this.serverFind(server.name)
    if (!existing) {
      const newServer = new Server(server.name, server.address, server.client_port, server.url)
      this.setState((prevState) => ({
        knownServers: [...prevState.knownServers, newServer]
      }))
      return newServer
    }
    return existing
  }

  serverFind(name: string): Server | undefined {
    return this.state.knownServers.find((server) => server.name === name)
  }

  setAssetSelectedServer(assetName: string, serverName: string) {
    const asset = this.assetFind(assetName)
    asset?.setSelected(serverName)
    this.setState({ knownAssets: this.state.knownAssets })
  }

  render() {
    const { knownServers, knownAssets } = this.state
    return (
      <div>
        <FSSServerBar knownServers={knownServers} />
        <FSSAssetSet knownAssets={knownAssets} setSelected={this.setAssetSelectedServer} />
      </div>
    )
  }
}
