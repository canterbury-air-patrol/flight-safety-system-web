interface AssetPositionData {
  timestamp: string
  lat: number
  lng: number
}

interface AssetStatusData {
  timestamp: string
  battery_percent: number
  battery_used: number
  battery_voltage: number
}

interface AssetSearchData {
  timestamp: string
  id: number
  progress: number
  total: number
}

interface AssetRTTData {
  timestamp: string
  rtt: number
  rtt_min: number
  rtt_max: number
  rtt_avg: number
}

interface AssetCommandData {
  timestamp: string
  command: string
  lat?: number
  lng?: number
  alt?: number
}

interface AssetStatus {
  asset: {
    name: string
    pk: number
  }
  position?: AssetPositionData
  status?: AssetStatusData
  search?: AssetSearchData
  rtt?: AssetRTTData
  command?: AssetCommandData
}

interface ServerDetails {
  name: string
  address: string
  client_port: number
  url: string
}

interface StatusData {
  currentUser?: string
  servers: Array<ServerDetails>
  assets: Array<AssetStatus>
}

class Server {
  name: string
  address: string
  clientPort: number
  url: string
  connected: boolean
  userName?: string
  status: string
  assets: Array<AssetStatus>
  servers: Array<ServerDetails>

  constructor(serverName: string, address: string, clientPort: number, url: string) {
    this.name = serverName
    this.address = address
    this.clientPort = clientPort
    this.url = url
    this.connected = false
    this.userName = undefined
    this.status = 'Connecting ...'
    this.assets = []
    this.servers = []

    this.updateData = this.updateData.bind(this)
    this.connectFailed = this.connectFailed.bind(this)
  }

  getURL(path: string) {
    return this.url + path
  }

  updateData(data: StatusData) {
    this.connected = true
    this.status = `Known Assets: ${data.assets.length}`
    this.userName = data.currentUser
    this.assets = data.assets
    this.servers = data.servers
  }

  connectFailed() {
    this.status = 'Unreachable'
    this.connected = false
    this.userName = undefined
  }

  updateStatus(): Promise<void> {
    return fetch(this.getURL('/current/all.json/'))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(
        (data) => {
          this.updateData(data)
        },
        (error) => {
          console.error('Error fetching server status:', error)
          this.connectFailed()
        }
      )
  }
}

export { Server, ServerDetails, AssetPositionData, AssetStatus }
