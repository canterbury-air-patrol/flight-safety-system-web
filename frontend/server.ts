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

export type AckState = 'pending' | 'received' | 'actioned' | 'superseded' | 'rejected' | 'noop'
export type AckSupersedeReason = 'none' | 'low_battery' | 'comms_loss' | 'newer_command'

export interface AssetCommandData {
  timestamp: string
  command: string
  command_code: string
  lat?: number
  lng?: number
  alt?: number
  // Acknowledgement state. 'pending' means the command was dispatched but no
  // ack has been recorded yet; 'noop' means it resolved to the already-current
  // state. ack_timestamp is the FMU's wall-clock epoch-ms. ack_superseded_by is
  // the reason a command was superseded (which failsafe latch blocked it),
  // present only when ack_state is 'superseded'.
  ack_state: AckState
  ack_state_display?: string
  ack_timestamp?: number
  ack_superseded_by?: AckSupersedeReason
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
  // The server's current time (epoch-ms) when this status was produced. Used to
  // age commands against a single server clock rather than the browser clock,
  // which clock skew (corrected elsewhere via RTT offset) would corrupt.
  server_now?: number
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

export const serverUnauthenticated = (server: ServerState): ServerState => ({
  ...server,
  connected: true,
  status: 'Login required',
  userName: undefined,
  csrfToken: undefined,
  assets: [],
  servers: []
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
