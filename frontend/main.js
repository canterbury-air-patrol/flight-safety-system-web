import { degToDM, DMToDegrees } from './dgm.js'
import { Server } from './server.js'
import { createAsset } from './asset.js'
import $ from 'jquery'
import 'bootstrap'
import 'bootstrap/dist/css/bootstrap.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './fssweb.css'

import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIconShadow from 'leaflet/dist/images/marker-shadow.png'

const knownServers = []
const knownAssets = []

/* definitions */
const assetPositionTimeWarn = 30 * 1000
const assetPositionTimeOld = 60 * 1000

const batteryCritical = 20
const batteryWarn = 50
const batteryTimeWarn = 60 * 1000
const batteryTimeOld = 120 * 1000

const searchTimeWarn = 300 * 1000
const searchTimeOld = 600 * 1000

const rttTimeWarn = 10 * 1000
const rttTimeOld = 60 * 1000

function dialogCreate (title, text, buttons, classes) {
  $('#dialog-header').html(title)
  $('#dialog-body').html(text)
  if (classes) {
    $('#dialog-modal').addClass(classes)
  }
  let buttonHtml = ''
  for (const b in buttons) {
    const btn = buttons[b]
    buttonHtml += `<button class="btn ${btn.btn_class}" id="${btn.btn_id}">${btn.label}</button>`
  }
  buttonHtml += '<button type="button" class="btn btn-primary" data-dismiss="modal">Cancel</button>'
  $('#dialog-buttons').html(buttonHtml)
  $('#dialog-modal').modal('show')
}

function dialogHide () {
  $('#dialog-modal').on('shown.bs.modal', () => {})
  $('#dialog-modal').modal('hide')
  $('#dialog-modal').removeClass().addClass('modal fade')
}

function serverFind (name) {
  for (const ks in knownServers) {
    if (knownServers[ks].name === name) {
      return knownServers[ks]
    }
  }
  return null
}

function UIServerNew (server) {
  const html = `
      <div class="server" id="server_${server.name}">
          <div id="server_label_${server.name}" class="server-label">${server.name}</div>
          <table id="server_status_${server.name}" class="server-status">
              <tr><td>Connecting</td></tr>
          </table>
          <div id="server_login_info_${server.name}" class="server-login">Unknown</div>
      </div>`
  $('div#servers').append(html)
}

function serverAdd (server) {
  const existing = serverFind(server.name)
  if (existing === null) {
    const newServer = new Server(server.name, server.address, server.client_port, server.url)
    knownServers.push(newServer)
    return newServer
  }
  return existing
}

function assetFind (name) {
  for (const ka in knownAssets) {
    if (knownAssets[ka].name === name) {
      return knownAssets[ka]
    }
  }
  return null
}

function assetGotoDialog (asset) {
  // Find the most recent position report
  let position = asset.positionMostRecent()
  if (position === null) {
    position = {
      lat: -43.5,
      lng: 172.5
    }
  }
  const html = `<div>
                <input type="text" id="asset-goto-latitude" value="${degToDM(position.lat, true)}"></input>
                <input type="text" id="asset-goto-longitude" value="${degToDM(position.lng, false)}"></input>
                <div id="map" class="dialog-map"/>
                </div>`
  dialogCreate(`Send ${asset.name} to`,
    html,
    [{
      btn_class: 'btn-light',
      label: 'Goto',
      btn_id: 'dialog_button_goto'
    }], 'map-modal')
  $('#dialog_button_goto').on('click', function () {
    dialogHide()
    asset.Goto(DMToDegrees($('#asset-goto-latitude').val()), DMToDegrees($('#asset-goto-longitude').val()))
  })

  const map = L.map('map').setView([position.lat, position.lng], 13)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map)
  const m = L.marker([position.lat, position.lng], { draggable: true, autopan: true })
  m.addTo(map)
  m.on('dragend', function () {
    const markerCoords = m.getLatLng()
    $('#asset-goto-latitude').val(degToDM(markerCoords.lat, true))
    $('#asset-goto-longitude').val(degToDM(markerCoords.lng, false))
  })
  $('#dialog-modal.map-modal').on('shown.bs.modal', () => { map.invalidateSize() })
}

function assetAltitudeDialog (asset) {
  dialogCreate('Adjust ' + asset.name + ' Altitude',
    'New altitude: <input type="text" size="3" maxlength="3" min="0" max="999" value="100" id="asset-altitude"></input>ft',
    [{ btn_class: 'btn-light', label: 'Set Altitude', btn_id: 'dialog_button_setalt' }])
  $('#dialog_button_setalt').on('click', function () {
    dialogHide()
    asset.Altitude($('#asset-altitude').val())
  })
}

function assetDisArmDialog (asset) {
  dialogCreate('Disarm ' + asset.name,
    'Warning this will probably result in the aircraft crashing use only when all other options are unsafe',
    [{ btn_class: 'btn-danger', label: 'DisArm', btn_id: 'dialog_button_disarm' }])
  $('#dialog_button_disarm').on('click', function () {
    dialogHide()
    asset.DisArm()
  })
}

function assetTerminateDialog (asset) {
  dialogCreate('Terminate ' + asset.name,
    'Warning this will cause the aircraft to immediately terminate flight and most certainly destroy it, be sure the area directly under the aircraft is free of any people and property. Use RTL or Hold instead.',
    [{
      btn_class: 'btn-danger',
      label: 'Terminate Flight',
      btn_id: 'dialog_button_terminate'
    }, {
      btn_class: 'btn-light',
      label: 'RTL',
      btn_id: 'dialog_button_rtl'
    }, {
      btn_class: 'btn-light',
      label: 'Hold',
      btn_id: 'dialog_button_hold'
    }])
  $('#dialog_button_terminate').on('click', function () {
    dialogHide()
    asset.Terminate()
  })
  $('#dialog_button_rtl').on('click', function () {
    dialogHide()
    asset.RTL()
  })
  $('#dialog_button_hold').on('click', function () {
    dialogHide()
    asset.Hold()
  })
}

function assetAddIfNew (assetData) {
  const existing = assetFind(assetData.name)
  if (existing === null) {
    const asset = createAsset(assetData.name)
    knownAssets.push(asset)

    const html = `
            <div class="asset" id="asset_${asset.name}">
                <div class="asset-label" id="asset_label_${asset.name}">${asset.name}</div>
                <div class="asset-buttons btn-group" role="group" id="asset_buttons_${asset.name}">
                    <button class="btn btn-outline-secondary" id="asset_buttons_${asset.name}_rtl">RTL</button>
                    <button class="btn btn-outline-secondary" id="asset_buttons_${asset.name}_hold">Hold</button>
                    <button class="btn btn-outline-secondary" id="asset_buttons_${asset.name}_altitude">Altitude</button>
                    <button class="btn btn-outline-secondary" id="asset_buttons_${asset.name}_goto">Goto</button>
                    <button class="btn btn-outline-secondary" id="asset_buttons_${asset.name}_continue">Continue</button>
                    <button class="btn btn-info" id="asset_buttons_${asset.name}_manual">Manual</button>
                    <button class="btn btn-danger" id="asset_buttons_${asset.name}_disarm">DisArm</button>
                    <button class="btn btn-danger" id="asset_buttons_${asset.name}_terminate">Terminate</button>
                </div>  
                <div class="container card">
                    <ul class="nav nav-tabs server-tab-btn" id="asset_server_select_${asset.name}">    
                    </ul>
                    <div class="asset-status tab-content" id="asset_status_${asset.name}"></div>
                </div>
            </div>`

    $('div#assets').append(html)
    $(`#asset_buttons_${asset.name}_rtl`).on('click', function () { asset.RTL() })
    $(`#asset_buttons_${asset.name}_hold`).on('click', function () { asset.Hold() })
    $(`#asset_buttons_${asset.name}_altitude`).on('click', function () { assetAltitudeDialog(asset) })
    $(`#asset_buttons_${asset.name}_goto`).on('click', function () { assetGotoDialog(asset) })
    $(`#asset_buttons_${asset.name}_continue`).on('click', function () { asset.Continue() })
    $(`#asset_buttons_${asset.name}_manual`).on('click', function () { asset.Manual() })
    $(`#asset_buttons_${asset.name}_disarm`).on('click', function () { assetDisArmDialog(asset) })
    $(`#asset_buttons_${asset.name}_terminate`).on('click', function () { assetTerminateDialog(asset) })
    return asset
  }
  return existing
}

function UIAssetStatus (asset) {
  return $('#asset_status_' + asset.name)
}

function UIAssetServerSelect (asset) {
  return $('#asset_server_select_' + asset.name)
}

function UIAssetServerIdPrefix (serverEntry) {
  return 'asset_status_' + serverEntry.asset.name + '_server_' + serverEntry.server.name
}

function shouldBeActiveAssetServerTab (asset) {
  return asset.getServerCount() === 1
}

function UIAssetServerAdd (serverEntry) {
  const idPrefix = UIAssetServerIdPrefix(serverEntry)
  let active = ''
  if (shouldBeActiveAssetServerTab(serverEntry.asset)) {
    active = 'active'
  }
  const html = `
    <div class="asset-status-server tab-pane ${active}" id="${idPrefix}">
        <div class="asset-status-server-label">${serverEntry.server.name}</div>
        <div class="asset-status-command" id="${idPrefix}_command"></div>
        <table class="asset-rtt-status" id="${idPrefix}_rtt">
            <tr><td>RTT (ms)</td><td>min</td><td>max</td><td>avg</td></tr>
            <tr>
                <td class="asset-rtt" id="${idPrefix}_rtt_value"></td>
                <td class="asset-rtt" id="${idPrefix}_rtt_min"></td>
                <td class="asset-rtt" id="${idPrefix}_rtt_max"></td>
                <td class="asset-rtt" id="${idPrefix}_rtt_avg"></td>
            </tr>
        </table>
        <div class="asset-position" id="${idPrefix}_position">Waiting for position ...</div>
        <table class="asset-battery-status" id="${idPrefix}_battery">
            <tr>
                <td>Remaining %</td>
                <td>Used (mAh)</td>
                <td>Voltage</td>
            </tr>
            <tr>
                <td id="${idPrefix}_battery_remaining">Unknown</td>
                <td id="${idPrefix}_battery_used">Unknown</td>
                <td id="${idPrefix}_battery_voltage">Unknown</td>
            </tr>
        </table>
            <table class="asset-search-status" id="${idPrefix}_search">
                <tr><td>Search</td><td>Completed</td><td>Total</td></tr>
                <tr>
                    <td id="${idPrefix}_search_id">Unknown</td>
                    <td id="${idPrefix}_search_current">Unknown</td>
                    <td id="${idPrefix}_search_total">Unknown</td>
                </tr>
            </table>
    </div>`
  UIAssetStatus(serverEntry.asset).append(html)

  const serverEntryHTML = `
            <li class="nav-item">
                <button data-toggle="tab" class="nav-link server-tab-btn ${active}" href="#${idPrefix}">
                    ${serverEntry.server.name}
                </button>
            </li>`
  UIAssetServerSelect(serverEntry.asset).append(serverEntryHTML)
}

function fieldMarkOld (field, timestamp, old, warn, prefix) {
  const dbTime = new Date(timestamp)
  const timeDelta = (new Date()).getTime() - dbTime.getTime()
  if (timeDelta > old) {
    $(field).addClass(`${prefix}-old`)
  } else if (timeDelta > warn) {
    $(field).addClass(`${prefix}-warn`)
  } else {
    $(field).removeClass(`${prefix}-old`)
    $(field).removeClass(`${prefix}-warn`)
  }
}

function UIAssetServerPopulateStatus (serverEntry, data) {
  const idPrefix = UIAssetServerIdPrefix(serverEntry)
  if ('position' in data) {
    $(`#${idPrefix}_position`).html(degToDM(data.position.lat, true) + ' ' + degToDM(data.position.lng, false))
    fieldMarkOld(`#${idPrefix}_position`, data.position.timestamp, assetPositionTimeOld, assetPositionTimeWarn, 'asset-position')
    serverEntry.position = data.position
  }
  if ('status' in data) {
    $(`#${idPrefix}_battery_remaining`).html(data.status.battery_percent)
    $(`#${idPrefix}_battery_used`).html(data.status.battery_used)
    $(`#${idPrefix}_battery_voltage`).html(data.status.battery_voltage)
    if (data.status.battery_percent < batteryCritical) {
      $(`#${idPrefix}_battery`).addClass('asset-battery-critical')
    } else if (data.status.battery_percent < batteryWarn) {
      $(`#${idPrefix}_battery`).addClass('asset-battery-warn')
    }
    fieldMarkOld(`#${idPrefix}_battery`, data.status.timestamp, batteryTimeOld, batteryTimeWarn, 'asset-battery-time')
  }
  if ('search' in data) {
    $(`#${idPrefix}_search_id`).html(data.search.id)
    $(`#${idPrefix}_search_current`).html(data.search.progress)
    $(`#${idPrefix}_search_total`).html(data.search.total)
    fieldMarkOld(`#${idPrefix}_search`, data.search.timestamp, searchTimeOld, searchTimeWarn, 'asset-search-time')
  }
  if ('rtt' in data) {
    $(`#${idPrefix}_rtt_value`).html(data.rtt.rtt)
    $(`#${idPrefix}_rtt_min`).html(data.rtt.rtt_min)
    $(`#${idPrefix}_rtt_max`).html(data.rtt.rtt_max)
    $(`#${idPrefix}_rtt_avg`).html(data.rtt.rtt_avg)
    fieldMarkOld(`#${idPrefix}_rtt`, data.rtt.timestamp, rttTimeOld, rttTimeWarn, 'asset-rtt-time')
  }
  if ('command' in data) {
    let commandTxt = data.command.command
    if (data.command.command === 'Goto Position') {
      commandTxt += ` ${degToDM(data.command.lat, true)}, ${degToDM(data.command.lng)}`
    }
    if (data.command.command === 'Adjust Altitude') {
      commandTxt += ` to ${data.command.alt}ft`
    }
    if (data.command.command === 'Manual') {
      commandTxt = ' <strong>Take Manual Control Now</strong>'
    }
    $(`#${idPrefix}_command`).html(commandTxt)
  }
}

function UIAssetServerUpdateStatus (serverEntry) {
  $.getJSON(serverEntry.getURL('status.json'), function (data) {
    UIAssetServerPopulateStatus(serverEntry, data)
  })
}

function serverUpdateAssets (server) {
  $.getJSON(server.getURL('/assets.json'),
    function (data) {
      const assets = []
      $.each(data.assets, function (key, val) {
        assets.push(val)
      })
      for (const a in assets) {
        const asset = assetAddIfNew(assets[a])
        let serverEntry = asset.serverFind(server.name)
        if (serverEntry === null) {
          serverEntry = asset.serverAdd(server, assets[a].pk)
          UIAssetServerAdd(serverEntry)
        }
        UIAssetServerUpdateStatus(serverEntry)
      }
    }).fail(function () {})
}

function serverUpdateStatus (server) {
  $.get(server.getURL('/status/'), function (data) {
    $(`#server_status_${server.name}`).html(data)
    $(`#server_label_${server.name}`).removeClass('server-label-failure')
    $(`#server_label_${server.name}`).addClass('server-label-connected')
    serverUpdateAssets(server)
  }).fail(function () {
    $(`#server_status_${server.name}`).html('<tr><td>Unreachable<td></tr>')
    $(`#server_label_${server.name}`).removeClass('server-label-connected')
    $(`#server_label_${server.name}`).addClass('server-label-failure')
  })
  $.get(server.getURL('/current_user/'), function (data) {
    if (data.currentUser === null) {
      $(`#server_login_info_${server.name}`).html(`<a href="${server.getURL('/login/')}">Login Here</a>`)
    } else {
      $(`#server_login_info_${server.name}`).html(`Logged in as: ${data.currentUser}`)
    }
  })
}

function serversUpdateKnown () {
  // Load the known servers
  $.getJSON('../servers.json', function (data) {
    const servers = []
    $.each(data.servers, function (key, val) {
      servers.push(val)
    })
    for (const s in servers) {
      let server = serverFind(servers[s].name)
      if (server === null) {
        server = serverAdd(servers[s])
        /* Present new server */
        UIServerNew(server)
      }
      serverUpdateStatus(server)
    }
  })
}

function setupPage () {
  L.Icon.Default.prototype.options.iconUrl = markerIcon
  L.Icon.Default.prototype.options.iconRetinaUrl = markerIcon2x
  L.Icon.Default.prototype.options.shadowUrl = markerIconShadow

  $.ajaxSetup({ timeout: 2500 })
  const direct = serverAdd({ name: 'direct', address: '127.0.0.1', client_port: '0', url: window.location.href.slice(0, -1) })
  UIServerNew(direct)
  serverUpdateStatus(direct)
  serversUpdateKnown()
  setInterval(function () {
    for (const ks in knownServers) {
      serverUpdateStatus(knownServers[ks])
    }
  }, 3000)
  setInterval(serversUpdateKnown, 30000)
}

setupPage()
