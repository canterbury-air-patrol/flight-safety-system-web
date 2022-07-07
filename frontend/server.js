import $ from 'jquery'

export class Server {
  constructor (serverName, address, clientPort, url) {
    this.name = serverName
    this.address = address
    this.clientPort = clientPort
    this.url = url
    this.connected = false
    this.userName = null
    this.assets = []
    this.servers = []
  }

  getURL (path) {
    return this.url + path
  }

  updateStatus () {
    const self = this
    $.get(this.getURL('/current/all.json/'), function (data) {
      self.connected = true
      self.status = `Known Assets: ${data.assets.length}`
      self.userName = data.currentUser
      self.assets = data.assets
      self.servers = data.servers
    }).fail(function () {
      self.status = 'Unreachable'
      self.connected = false
      self.currentUser = null
    })
  }
}
