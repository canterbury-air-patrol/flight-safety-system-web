export class Server {
  constructor (serverName, address, clientPort, url) {
    this.name = serverName
    this.address = address
    this.clientPort = clientPort
    this.url = url
  }

  getURL (path) {
    return this.url + path
  }
}
