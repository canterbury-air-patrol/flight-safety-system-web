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
  }

  getURL (path) {
    return this.url + path
  }

  updateAssetsData () {
    const self = this
    $.getJSON(this.getURL('/assets.json'),
      function (data) {
        const assets = []
        $.each(data.assets, function (key, val) {
          assets.push(val)
        })
        self.assets = assets
      }).fail(function () {})
  }

  updateLoginInfo () {
    const self = this
    $.get(this.getURL('/current_user/'), function (data) {
      self.userName = data.currentUser
    })
  }

  updateStatus () {
    const self = this
    $.get(this.getURL('/status/'), function (data) {
      self.status = data
      self.connected = true
      self.updateLoginInfo()
      self.updateAssetsData()
    }).fail(function () {
      self.status = 'Unreachable'
      self.connected = false
    })
  }
}
