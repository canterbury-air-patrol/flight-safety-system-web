import { AssetPositionData, AssetStatus, Server } from './server'

export type Command = 'GOTO' | 'ALT' | 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'

export type CommandPayload =
  | { command: 'GOTO'; latitude: number; longitude: number }
  | { command: 'ALT'; altitude: number }
  | { command: Extract<Command, 'RTL' | 'HOLD' | 'RON' | 'DISARM' | 'TERM' | 'MAN'> }

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

  sendCommand(data: CommandPayload) {
    for (const s of this.servers) {
      fetch(s.getURL('command/set/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)]))
      })
    }
  }

  RTL() {
    this.sendCommand({ command: 'RTL' })
  }

  Hold() {
    this.sendCommand({ command: 'HOLD' })
  }

  Continue() {
    this.sendCommand({ command: 'RON' })
  }

  Goto(lat: number, lng: number) {
    this.sendCommand({
      command: 'GOTO',
      latitude: lat,
      longitude: lng
    })
  }

  Altitude(alt: number) {
    this.sendCommand({ command: 'ALT', altitude: alt })
  }

  DisArm() {
    this.sendCommand({ command: 'DISARM' })
  }

  Terminate() {
    this.sendCommand({ command: 'TERM' })
  }

  Manual() {
    this.sendCommand({ command: 'MAN' })
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
