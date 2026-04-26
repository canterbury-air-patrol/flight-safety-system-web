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
    return this.servers.find((s) => s.server.name === name)
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
    return this.servers.reduce<AssetPositionData | undefined>((best, s) => {
      const pos = s.data?.position
      if (!pos) return best
      if (!best || pos.timestamp > best.timestamp) return pos
      return best
    }, undefined)
  }

  setSelected(serverName: string) {
    this.selectedServer = this.serverFind(serverName)
  }
}
