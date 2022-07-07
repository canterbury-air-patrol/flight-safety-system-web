import $ from 'jquery'

class AssetServer {
  constructor (server, asset, pk) {
    this.server = server
    this.asset = asset
    this.pk = pk
    this.data = []
  }

  getURL (path) {
    return this.server.getURL(`/assets/${this.pk}/${path}`)
  }

  updateData (assetData) {
    this.data = assetData
  }
}

export class Asset {
  constructor (assetName) {
    this.name = assetName
    this.selectedServer = null
    this.servers = []
  }

  serverFind (name) {
    for (const s in this.servers) {
      if (this.servers[s].server.name === name) {
        return this.servers[s]
      }
    }
    return null
  }

  serverAdd (server, pk) {
    const serverEntry = this.serverFind(server.name)
    if (serverEntry === null) {
      const newAssetServer = new AssetServer(server, this, pk)
      this.servers.push(newAssetServer)
      if (this.selectedServer === null) {
        this.selectedServer = newAssetServer
      }
      return newAssetServer
    }
    return serverEntry
  }

  getServerCount () {
    return this.servers.length
  }

  sendCommand (data) {
    for (const s in this.servers) {
      const url = this.servers[s].getURL('command/set/')
      $.post(url, data)
    }
  }

  RTL () {
    const data = { command: 'RTL' }
    this.sendCommand(data)
  }

  Hold () {
    const data = { command: 'HOLD' }
    this.sendCommand(data)
  }

  Continue () {
    const data = { command: 'RON' }
    this.sendCommand(data)
  }

  Goto (lat, lng) {
    const data = {
      command: 'GOTO',
      latitude: lat,
      longitude: lng
    }
    this.sendCommand(data)
  }

  Altitude (alt) {
    const data = { command: 'ALT', altitude: alt }
    this.sendCommand(data)
  }

  DisArm () {
    const data = { command: 'DISARM' }
    this.sendCommand(data)
  }

  Terminate () {
    const data = { command: 'TERM' }
    this.sendCommand(data)
  }

  Manual () {
    const data = { command: 'MAN' }
    this.sendCommand(data)
  }

  positionMostRecent () {
    let position = null
    for (const s in this.servers) {
      const serverEntry = this.servers[s]
      if (serverEntry.data.position && (position === null || serverEntry.data.position.timestamp > position.timestamp)) {
        position = serverEntry.data.position
      }
    }
    return position
  }

  setSelected (serverName) {
    this.selectedServer = this.serverFind(serverName)
  }
}
