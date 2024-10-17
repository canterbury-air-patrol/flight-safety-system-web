import { degToDM, DMToDegrees } from './dgm'
import { Server } from './server'
import { Asset } from './asset'
import $ from 'jquery'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'
import React from 'react'
import PropTypes from 'prop-types'

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

class ModalWithButton extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      isOpen: false
    }

    this.buttonLabel = 'Unlabelled'
    this.buttonVariant = 'primary'

    this.handleClose = this.handleClose.bind(this)
    this.handleShow = this.handleShow.bind(this)
  }

  handleClose() {
    this.setState({ isOpen: false })
  }

  handleShow() {
    this.setState({ isOpen: true })
  }

  render() {
    return (
      <>
        <Button onClick={this.handleShow} variant={this.buttonVariant}>
          {this.buttonLabel}
        </Button>
        <Modal show={this.state.isOpen} onHide={this.handleClose}>
          <Modal.Header>
            <Modal.Title>{this.renderModalTitle()}</Modal.Title>
          </Modal.Header>
          <Modal.Body>{this.renderModalBody()}</Modal.Body>
          <Modal.Footer>{this.renderModalButtons()}</Modal.Footer>
        </Modal>
      </>
    )
  }
}

class AltitudeSelect extends ModalWithButton {
  constructor(props) {
    super(props)

    this.state.newAltitude = 100

    this.buttonLabel = 'Altitude'
    this.buttonVariant = 'outline-secondary'

    this.handleChange = this.handleChange.bind(this)
    this.handleSet = this.handleSet.bind(this)
  }

  handleChange(event) {
    const target = event.target
    const value = target.value

    this.setState({ newAltitude: value })
  }

  handleSet() {
    this.props.asset.Altitude(this.state.newAltitude)
    this.handleClose()
  }

  renderModalTitle() {
    return <>Set Target Altitude:</>
  }

  renderModalBody() {
    return (
      <>
        New Altitude: <input type="text" size="3" maxLength="3" min="0" max="999" onChange={this.handleChange} value={this.state.newAltitude}></input>ft
      </>
    )
  }

  renderModalButtons() {
    return (
      <>
        <Button variant="light" onClick={this.handleSet}>
          Set Altitude
        </Button>
        <Button variant="primary" onClick={this.handleClose}>
          Cancel
        </Button>
      </>
    )
  }
}

class Goto extends ModalWithButton {
  constructor(props) {
    super(props)

    this.state.position = this.props.asset.positionMostRecent()

    this.markerRef = null

    L.Icon.Default.prototype.options.iconUrl = markerIcon
    L.Icon.Default.prototype.options.iconRetinaUrl = markerIcon2x
    L.Icon.Default.prototype.options.shadowUrl = markerIconShadow

    this.buttonLabel = 'Goto'
    this.buttonVariant = 'outline-secondary'

    this.handleShow = this.handleShow.bind(this)
    this.handleGoto = this.handleGoto.bind(this)
    this.handleLat = this.handleLat.bind(this)
    this.handleLng = this.handleLng.bind(this)
    this.dragEnd = this.dragEnd.bind(this)
  }

  dragEnd(event) {
    const target = event.target
    const newPosition = target.getLatLng()
    this.setState({ position: newPosition })
  }

  handleShow() {
    this.setState(() => ({
      isOpen: true,
      position: this.props.asset.positionMostRecent()
    }))
  }

  handleGoto() {
    this.props.asset.Goto(this.state.position.lat, this.state.position.lng)
    this.handleClose()
  }

  updateLat(lat) {
    this.setState(function (prevState) {
      prevState.position.lat = lat
      return { position: prevState.position }
    })
  }

  updateLng(lng) {
    this.setState(function (prevState) {
      prevState.position.lat = lng
      return { position: prevState.position }
    })
  }

  handleLat(event) {
    const target = event.target
    const value = target.value
    this.updateLat(DMToDegrees(value))
  }

  handleLng(event) {
    const target = event.target
    const value = target.value
    this.updateLng(DMToDegrees(value))
  }

  renderModalTitle() {
    return <>Send {this.props.asset.name} to:</>
  }

  renderModalBody() {
    let position = this.state.position
    if (position === null) {
      position = {
        lat: 0,
        lng: 0
      }
    }
    return (
      <>
        <input type="text" value={degToDM(position.lat, true)} onChange={this.handleLat}></input>
        <input type="text" value={degToDM(position.lng, false)} onChange={this.handleLng}></input>
        <MapContainer center={position} zoom={13} className="dialog-map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker draggable={true} eventHandlers={{ dragend: this.dragEnd }} position={position} ref={this.markerRef} />
        </MapContainer>
      </>
    )
  }

  renderModalButtons() {
    return (
      <>
        <Button variant="light" onClick={this.handleGoto}>
          Goto
        </Button>
        <Button variant="primary" onClick={this.handleClose}>
          Cancel
        </Button>
      </>
    )
  }
}

class DisArm extends ModalWithButton {
  constructor(props) {
    super(props)

    this.buttonLabel = 'DisArm'
    this.buttonVariant = 'danger'

    this.handleDisArm = this.handleDisArm.bind(this)
  }

  handleDisArm() {
    this.props.asset.DisArm()
    this.handleClose()
  }

  renderModalTitle() {
    return <>Disarm {this.props.asset.name}</>
  }

  renderModalBody() {
    return <>Warning this will probably result in the aircraft crashing. Use only when all other options are unsafe.</>
  }

  renderModalButtons() {
    return (
      <>
        <Button variant="danger" onClick={this.handleDisArm}>
          DisArm
        </Button>
        <Button variant="primary" onClick={this.handleClose}>
          Cancel
        </Button>
      </>
    )
  }
}
DisArm.propTypes = {
  asset: PropTypes.object.isRequired
}

class Terminate extends ModalWithButton {
  constructor(props) {
    super(props)

    this.buttonLabel = 'Terminate'
    this.buttonVariant = 'danger'

    this.handleTerminate = this.handleTerminate.bind(this)
    this.handleRTL = this.handleRTL.bind(this)
    this.handleHold = this.handleHold.bind(this)
  }

  handleTerminate() {
    this.props.asset.Terminate()
    this.handleClose()
  }

  handleRTL() {
    this.props.asset.RTL()
    this.handleClose()
  }

  handleHold() {
    this.props.asset.Hold()
    this.handleClose()
  }

  renderModalTitle() {
    return <>Terminate {this.props.asset.name}</>
  }

  renderModalBody() {
    return (
      <>
        Warning this will cause the aircraft to immediately terminate flight and most certainly destroy it. Ensure the area directly under the aircraft is free of any people and
        property. Use RTL or Hold instead.
      </>
    )
  }

  renderModalButtons() {
    return (
      <>
        <Button variant="danger" onClick={this.handleTerminate}>
          Terminate Flight
        </Button>
        <Button variant="light" onClick={this.handleRTL}>
          RTL
        </Button>
        <Button variant="light" onClick={this.handleHold}>
          Hold
        </Button>
        <Button variant="primary" onClick={this.handleClose}>
          Cancel
        </Button>
      </>
    )
  }
}
Terminate.propTypes = {
  asset: PropTypes.object.isRequired
}

class FSSAssetControls extends React.Component {
  constructor(props) {
    super(props)

    this.RTL = this.RTL.bind(this)
    this.Hold = this.Hold.bind(this)
    this.Continue = this.Continue.bind(this)
    this.Manual = this.Manual.bind(this)
  }

  RTL() {
    this.props.asset.RTL()
  }

  Hold() {
    this.props.asset.Hold()
  }

  Continue() {
    this.props.asset.Continue()
  }

  Manual() {
    this.props.asset.Manual()
  }

  render() {
    return (
      <div className="asset-buttons btn-group" role="group">
        <button className="btn btn-outline-secondary" onClick={this.RTL}>
          RTL
        </button>
        <button className="btn btn-outline-secondary" onClick={this.Hold}>
          Hold
        </button>
        <AltitudeSelect asset={this.props.asset} />
        <Goto asset={this.props.asset} />
        <button className="btn btn-outline-secondary" onClick={this.Continue}>
          Continue
        </button>
        <button className="btn btn-info" onClick={this.Manual}>
          Manual
        </button>
        <DisArm asset={this.props.asset} />
        <Terminate asset={this.props.asset} />
      </div>
    )
  }
}
FSSAssetControls.propTypes = {
  asset: PropTypes.object.isRequired
}

class FSSAssetServerStatus extends React.Component {
  dataAgeClass(timestamp, old, warn, prefix) {
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
    const data = this.props.server.data
    let rttTable = []
    if ('rtt' in data) {
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
    let posTable = []
    if ('position' in data) {
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
              <td>{degToDM(data.position.lat, true)}</td>
              <td>{degToDM(data.position.lng, false)}</td>
            </tr>
          </tbody>
        </table>
      )
    }
    let batteryTable = []
    if ('status' in data) {
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
    let searchTable = []
    if ('search' in data) {
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
    let commandTxt = ''
    if ('command' in data) {
      commandTxt = data.command.command
      if (data.command.command === 'Goto Position') {
        commandTxt += ` ${degToDM(data.command.lat, true)}, ${degToDM(data.command.lng)}`
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
FSSAssetServerStatus.propTypes = {
  server: PropTypes.object.isRequired
}

class FSSAssetStatus extends React.Component {
  constructor(props) {
    super(props)

    this.selectServer = this.selectServer.bind(this)
  }

  selectServer(e) {
    this.props.setSelected(this.props.asset.name, e.target.name)
  }

  render() {
    const serverSelector = []
    let serverData = []
    for (const s in this.props.asset.servers) {
      const server = this.props.asset.servers[s]
      if (server.data.length !== 0) {
        serverSelector.push(
          <li className="nav-item" key={server.server.name}>
            <button data-toggle="tab" className="nav-link server-tab-btn" name={server.server.name} onClick={this.selectServer}>
              {server.server.name}
            </button>
          </li>
        )
      }
    }
    if (this.props.asset.selectedServer !== null) {
      serverData = <FSSAssetServerStatus server={this.props.asset.selectedServer} />
    }
    return (
      <div className="container card">
        <ul className="nav nav-tabs server-tab-btn">{serverSelector}</ul>
        <div className="asset-status">{serverData}</div>
      </div>
    )
  }
}
FSSAssetStatus.propTypes = {
  asset: PropTypes.object.isRequired,
  setSelected: PropTypes.func.isRequired
}

class FSSAsset extends React.Component {
  render() {
    return (
      <div className="asset">
        <div className="asset-label">{this.props.asset.name}</div>
        <FSSAssetControls asset={this.props.asset} />
        <FSSAssetStatus asset={this.props.asset} setSelected={this.props.setSelected} />
      </div>
    )
  }
}
FSSAsset.propTypes = {
  asset: PropTypes.object.isRequired,
  setSelected: PropTypes.func.isRequired
}

class FSSAssetSet extends React.Component {
  render() {
    const assets = []
    for (const a in this.props.knownAssets) {
      assets.push(<FSSAsset key={this.props.knownAssets[a].name} asset={this.props.knownAssets[a]} setSelected={this.props.setSelected} />)
    }
    return <div className="bar-assets">{assets}</div>
  }
}
FSSAssetSet.propTypes = {
  knownAssets: PropTypes.array.isRequired,
  setSelected: PropTypes.func.isRequired
}

class FSSServer extends React.Component {
  render() {
    return (
      <div className="server">
        <div className={`server-label server-label-${this.props.server.connected ? 'connected' : 'failure'}`}>{this.props.server.name}</div>
        <table className="server-status">
          <tbody>
            <tr>
              <td>{this.props.server.status}</td>
            </tr>
          </tbody>
        </table>
        <div className="server-login">
          {this.props.server.userName ? `Logged in as: ${this.props.server.userName}` : <a href={this.props.server.getURL('/login/')}>Login Here</a>}
        </div>
      </div>
    )
  }
}
FSSServer.propTypes = {
  server: PropTypes.object.isRequired
}

class FSSServerBar extends React.Component {
  render() {
    const servers = []
    for (const s in this.props.knownServers) {
      servers.push(<FSSServer server={this.props.knownServers[s]} key={this.props.knownServers[s].name} />)
    }

    return <div className="bar-server">{servers}</div>
  }
}
FSSServerBar.propTypes = {
  knownServers: PropTypes.array.isRequired
}

export class FSSMainPage extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      knownServers: [],
      knownAssets: []
    }

    this.state.knownServers.push(new Server('direct', '127.0.0.1', '0', window.location.href.slice(0, -1)))
    this.setAssetSelectedServer = this.setAssetSelectedServer.bind(this)
  }

  componentDidMount() {
    this.updateData()
    $.ajaxSetup({ timeout: 2500 })
    this.timer = setInterval(() => this.updateData(), 3000)
  }

  componentWillUnmount() {
    clearInterval(this.timer)
    this.timer = null
  }

  serversUpdateKnown() {
    for (const ks in this.state.knownServers) {
      const server = this.state.knownServers[ks]
      for (const s in server.servers) {
        this.serverAdd(server.servers[s])
      }
    }
  }

  assetAdd(assetName) {
    const existing = this.assetFind(assetName)
    if (existing === null) {
      const newAsset = new Asset(assetName)
      this.setState(function (prevState) {
        prevState.knownAssets.push(newAsset)
        return { knownAssets: prevState.knownAssets }
      })
      return newAsset
    }
    return existing
  }

  assetFind(assetName) {
    for (const ka in this.state.knownAssets) {
      if (this.state.knownAssets[ka].name === assetName) {
        return this.state.knownAssets[ka]
      }
    }
    return null
  }

  assetUpdate(assetName, server, assetData) {
    const asset = this.assetAdd(assetName)
    const assetServer = asset.serverAdd(server, assetData.asset.pk)
    assetServer.updateData(assetData)
  }

  async updateData() {
    this.serversUpdateKnown()
    for (const ks in this.state.knownServers) {
      const server = this.state.knownServers[ks]
      await server.updateStatus()
      for (const a in server.assets) {
        const asset = server.assets[a]
        this.assetUpdate(asset.asset.name, server, asset)
      }
    }
    this.setState({})
  }

  serverAdd(server) {
    const existing = this.serverFind(server.name)
    if (existing === null) {
      const newServer = new Server(server.name, server.address, server.client_port, server.url)
      this.setState(function (prevState) {
        prevState.knownServers.push(newServer)
        return { knownServers: prevState.knownServers }
      })
      return newServer
    }
    return existing
  }

  serverFind(name) {
    for (const ks in this.state.knownServers) {
      if (this.state.knownServers[ks].name === name) {
        return this.state.knownServers[ks]
      }
    }
    return null
  }

  setAssetSelectedServer(assetName, serverName) {
    const asset = this.assetFind(assetName)
    asset.setSelected(serverName)
    this.setState({ knownAssets: this.state.knownAssets })
  }

  render() {
    return (
      <div>
        <FSSServerBar knownServers={this.state.knownServers} />
        <FSSAssetSet knownAssets={this.state.knownAssets} setSelected={this.setAssetSelectedServer} />
      </div>
    )
  }
}
