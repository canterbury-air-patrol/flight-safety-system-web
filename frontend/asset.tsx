import { AssetPositionData, AssetStatus, Server } from './server'

export class AssetServer {
  server: Server
  asset: Asset
  pk: number
  data?: AssetStatus

  constructor(server: Server, asset: Asset, pk: number) {
    this.server = server
    this.asset = asset
    this.pk = pk
    this.data = undefined
  }

  getURL(path: string) {
    return this.server.getURL(`/assets/${this.pk}/${path}`)
  }

  updateData(assetData: AssetStatus) {
    this.data = assetData
  }
}

export class Asset {
  name: string
  selectedServer?: AssetServer
  servers: Array<AssetServer>

  constructor(assetName: string) {
    this.name = assetName
    this.selectedServer = undefined
    this.servers = []
  }

  serverFind(name: string): AssetServer | undefined {
    for (const s in this.servers) {
      if (this.servers[s].server.name === name) {
        return this.servers[s]
      }
    }
    return undefined
  }

  serverAdd(server: Server, pk: number): AssetServer {
    const serverEntry = this.serverFind(server.name)
    if (serverEntry === undefined) {
      const newAssetServer = new AssetServer(server, this, pk)
      this.servers.push(newAssetServer)
      if (!this.selectedServer) {
        this.selectedServer = newAssetServer
      }
      return newAssetServer
    }
    return serverEntry
  }

  getServerCount() {
    return this.servers.length
  }

  sendCommand(data: { command: string }) {
    for (const s in this.servers) {
      fetch(this.servers[s].getURL('command/set/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(data as Record<string, string>)
      })
    }
  }

  RTL() {
    const data = { command: 'RTL' }
    this.sendCommand(data)
  }

  Hold() {
    const data = { command: 'HOLD' }
    this.sendCommand(data)
  }

  Continue() {
    const data = { command: 'RON' }
    this.sendCommand(data)
  }

  Goto(lat: number, lng: number) {
    const data = {
      command: 'GOTO',
      latitude: lat,
      longitude: lng
    }
    this.sendCommand(data)
  }

  Altitude(alt: number) {
    const data = { command: 'ALT', altitude: alt }
    this.sendCommand(data)
  }

  DisArm() {
    const data = { command: 'DISARM' }
    this.sendCommand(data)
  }

  Terminate() {
    const data = { command: 'TERM' }
    this.sendCommand(data)
  }

  Manual() {
    const data = { command: 'MAN' }
    this.sendCommand(data)
  }

  positionMostRecent(): AssetPositionData | undefined {
    let position = undefined
    for (const s in this.servers) {
      const serverEntry = this.servers[s]
      if (serverEntry.data && serverEntry.data.position && (position === undefined || serverEntry.data.position.timestamp > position.timestamp)) {
        position = serverEntry.data.position
      }
    }
    return position
  }

  setSelected(serverName: string) {
    this.selectedServer = this.serverFind(serverName)
  }
}
