import $ from 'jquery'

export class Server {
  constructor(serverName, address, clientPort, url) {
    this.name = serverName
    this.address = address
    this.clientPort = clientPort
    this.url = url
    this.connected = false
    this.userName = null
    this.assets = []
    this.servers = []

    this.updateData = this.updateData.bind(this)
    this.connectFailed = this.connectFailed.bind(this)
  }

  getURL(path) {
    return this.url + path
  }

  updateData(data) {
    this.connected = true
    this.status = `Known Assets: ${data.assets.length}`
    this.userName = data.currentUser
    this.assets = data.assets
    this.servers = data.servers
  }

  connectFailed() {
    self.status = 'Unreachable'
    self.connected = false
    self.currentUser = null
  }

  async updateStatus() {
    await $.get(this.getURL('/current/all.json/'), this.updateData).fail(this.connectFailed)
  }
}
