export interface AssetPositionData {
  timestamp: string
  lat: number
  lng: number
  alt?: number
}

export interface AssetStatusData {
  timestamp: string
  battery_percent: number
  battery_used: number
  battery_voltage: number
}

export interface AssetSearchData {
  timestamp: string
  id: number
  progress: number
  total: number
}

export interface AssetRTTData {
  timestamp: string
  rtt: number
  rtt_min: number
  rtt_max: number
  rtt_avg: number
}

export interface AssetCommandData {
  timestamp: string
  command: string
  lat?: number
  lng?: number
  alt?: number
}

export interface AssetStatus {
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

export interface ServerDetails {
  name: string
  address: string
  client_port: number
  url: string
}

export interface StatusData {
  currentUser?: string
  csrfToken: string
  servers: Array<ServerDetails>
  assets: Array<AssetStatus>
}

export interface ServerState {
  name: string
  address: string
  clientPort: number
  url: string
  connected: boolean
  userName?: string
  csrfToken?: string
  status: string
  assets: Array<AssetStatus>
  servers: Array<ServerDetails>
}

export const createServer = (name: string, address: string, clientPort: number, url: string): ServerState => ({
  name,
  address,
  clientPort,
  url,
  connected: false,
  status: 'Connecting ...',
  assets: [],
  servers: []
})

export const getServerURL = (server: ServerState, path: string) => server.url + path

export const updateServerData = (server: ServerState, data: StatusData): ServerState => ({
  ...server,
  connected: true,
  status: `Known Assets: ${data.assets.length}`,
  userName: data.currentUser,
  csrfToken: data.csrfToken,
  assets: data.assets,
  servers: data.servers
})

export const serverConnectFailed = (server: ServerState): ServerState => ({
  ...server,
  status: 'Unreachable',
  connected: false,
  userName: undefined
})

export const mergeServerPollResult = (currentServers: Record<string, ServerState>, serverName: string, data: StatusData): Record<string, ServerState> => {
  const nextServers = { ...currentServers, [serverName]: updateServerData(currentServers[serverName], data) }
  for (const s of data.servers) {
    if (!nextServers[s.name]) {
      nextServers[s.name] = createServer(s.name, s.address, s.client_port, s.url)
    }
  }
  return nextServers
}
