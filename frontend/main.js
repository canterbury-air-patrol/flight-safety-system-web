import { deg_to_dm, dm_to_deg } from './dgm.js';
import { Server } from './server.js';
import { createAsset } from './asset.js';
import $ from 'jquery';
import 'bootstrap';
import 'bootstrap/dist/css/bootstrap.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './fssweb.css';
import 'leaflet/dist/images/marker-shadow.png';

var known_servers = [];
var known_assets = [];

/* definitions */
const asset_position_time_warn = 30 * 1000;
const asset_position_time_old = 60 * 1000;

const battery_critical = 20;
const battery_warn = 50;
const battery_time_warn = 60 * 1000;
const battery_time_old = 120 * 1000;

const search_time_warn = 300 * 1000;
const search_time_old = 600 * 1000;

const rtt_time_warn = 10 * 1000;
const rtt_time_old = 60 * 1000;

function dialogCreate(title, text, buttons, classes)
{
    $("#dialog-header").html(title);
    $("#dialog-body").html(text);
    if(classes){
        $("#dialog-modal").addClass(classes);
    }
    var button_html = '';
    for (var b in buttons)
    {
        var btn = buttons[b];
        button_html += `<button class="btn ${btn.btn_class}" id="${btn.btn_id}">${btn.label}</button>`;
    }
    button_html += '<button type="button" class="btn btn-primary" data-dismiss="modal">Cancel</button>';
    $("#dialog-buttons").html(button_html);
    $("#dialog-modal").modal('show');
}

function dialogHide()
{
    $('#dialog-modal').on('shown.bs.modal', () => {});
    $("#dialog-modal").modal('hide');
    $("#dialog-modal").removeClass().addClass('modal fade');
}

function serverFind(name)
{
    for (var ks in known_servers)
    {
        if (known_servers[ks].name === name)
        {
            return known_servers[ks];
        }
    }
    return null;
}

function UIServerNew(server)
{
    let html = `
        <div class="server" id="server_${server.name}">
            <div id="server_label_${server.name}" class="server-label">${server.name}</div>
            <table id="server_status_${server.name}" class="server-status">
                <tr><td>Connecting</td></tr>
            </table>
            <div id="server_login_info_${server.name}" class="server-login">Unknown</div>
        </div>`;
    $("div#servers").append(html);
}

function serverAdd(server)
{
    var existing = serverFind(server.name);
    if (existing === null)
    {
        let new_server = new Server(server.name, server.address, server.client_port, server.url)
        known_servers.push(new_server);
        return new_server;
    }
    return existing;
}

function assetFind(name)
{
    for (var ka in known_assets)
    {
        if (known_assets[ka].name === name)
        {
            return known_assets[ka];
        }
    }
    return null;
}

function assetGotoDialog(asset)
{
    // Find the most recent position report
    let position = asset.positionMostRecent();
    if (position === null)
    {
        position = {
            lat: -43.5,
            lng: 172.5
        }
    }
    let html =`<div>
                <input type="text" id="asset-goto-latitude" value="${deg_to_dm(position.lat, true)}"></input>
                <input type="text" id="asset-goto-longitude" value="${deg_to_dm(position.lng, false)}"></input>
                <div id="map" class="dialog-map"/>
                </div>`
    dialogCreate(`Send ${asset.name} to`,
        html,
        [{
            btn_class: 'btn-light',
            label: 'Goto',
            btn_id: 'dialog_button_goto',
        }], 'map-modal')
    $("#dialog_button_goto").on("click", function() {
        dialogHide()
        asset.Goto(dm_to_deg($('#asset-goto-latitude').val()), dm_to_deg($('#asset-goto-longitude').val()))
    })

    var map = L.map('map').setView([position.lat, position.lng], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map)
    var m = L.marker([position.lat, position.lng], {draggable: true, autopan: true })
    m.addTo(map)
    m.on('dragend', function() {
            var markerCoords = m.getLatLng()
            $("#asset-goto-latitude").val(deg_to_dm(markerCoords.lat, true))
            $("#asset-goto-longitude").val(deg_to_dm(markerCoords.lng, false))
            });
    $('#dialog-modal.map-modal').on('shown.bs.modal', () => {map.invalidateSize()})
}

function assetAltitudeDialog(asset)
{
    dialogCreate('Adjust ' + asset.name + ' Altitude',
        'New altitude: <input type="text" size="3" maxlength="3" min="0" max="999" value="100" id="asset-altitude"></input>ft',
        [{ btn_class: 'btn-light', label: 'Set Altitude', btn_id: 'dialog_button_setalt'}]);
    $("#dialog_button_setalt").on("click", function() {
        dialogHide();
        asset.Altitude($("#asset-altitude").val());
    });
}

function assetDisArmDialog(asset)
{
    dialogCreate('Disarm ' + asset.name,
        'Warning this will probably result in the aircraft crashing use only when all other options are unsafe',
        [{ btn_class: 'btn-danger', label: 'DisArm', btn_id: 'dialog_button_disarm'}]);
    $("#dialog_button_disarm").on("click", function() {
        dialogHide();
        asset.DisArm();
    });
}

function assetTerminateDialog(asset)
{
    dialogCreate('Terminate ' + asset.name,
        'Warning this will cause the aircraft to immediately terminate flight and most certainly destroy it, be sure the area directly under the aircraft is free of any people and property. Use RTL or Hold instead.',
        [{
            btn_class: 'btn-danger',
            label: 'Terminate Flight',
            btn_id: 'dialog_button_terminate'
        },{
            btn_class: 'btn-light',
            label: 'RTL',
            btn_id: 'dialog_button_rtl'
        }, {
            btn_class: 'btn-light',
            label: 'Hold',
            btn_id: 'dialog_button_hold'
        }]);
    $("#dialog_button_terminate").on("click", function() {
        dialogHide();
        asset.Terminate();
    });
    $("#dialog_button_rtl").on("click", function() {
        dialogHide();
        asset.RTL();
    });
    $("#dialog_button_hold").on("click", function() {
        dialogHide();
        asset.Hold();
    });
}

function assetAddIfNew(asset_data)
{
    var existing = assetFind(asset_data.name);
    if (existing === null)
    {
        var asset = createAsset(asset_data.name);
        known_assets.push(asset);
        
        let html = `
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
            </div>`;

        $("div#assets").append(html);
        $("#asset_buttons_" + asset.name + "_rtl").on("click", function() {asset.RTL()});
        $("#asset_buttons_" + asset.name + "_hold").on("click", function() {asset.Hold()});
        $("#asset_buttons_" + asset.name + "_altitude").on("click", function() {assetAltitudeDialog(asset)});
        $("#asset_buttons_" + asset.name + "_goto").on("click", function() {assetGotoDialog(asset)});
        $("#asset_buttons_" + asset.name + "_continue").on("click", function() {asset.Continue()});
        $("#asset_buttons_" + asset.name + "_manual").on("click", function() {asset.Manual()});
        $("#asset_buttons_" + asset.name + "_disarm").on("click", function() {assetDisArmDialog(asset)});
        $("#asset_buttons_" + asset.name + "_terminate").on("click", function() {assetTerminateDialog(asset)});
        return asset;
    }
    return existing;
}

function UIAssetStatus(asset)
{
    return $('#asset_status_' + asset.name);
}

function UIAssetServerSelect(asset)
{
    return $('#asset_server_select_' + asset.name);
}

function UIAssetServerIdPrefix(server_entry)
{
    return 'asset_status_' + server_entry.asset.name + '_server_' + server_entry.server.name;
}

function shouldBeActiveAssetServerTab(asset) {
    return asset.getServerCount() === 1;
}

function UIAssetServerAdd(server_entry)
{
    let id_prefix = UIAssetServerIdPrefix(server_entry);
    let active = '';
    if(shouldBeActiveAssetServerTab(server_entry.asset)) {
            active = 'active';
    }
    let html = `
    <div class="asset-status-server tab-pane ${active}" id="${id_prefix}">
        <div class="asset-status-server-label">${server_entry.server.name}</div>
        <div class="asset-status-command" id="${id_prefix}_command"></div>
        <table class="asset-rtt-status" id="${id_prefix}_rtt">
            <tr><td>RTT (ms)</td><td>min</td><td>max</td><td>avg</td></tr>
            <tr>
                <td class="asset-rtt" id="${id_prefix}_rtt_value"></td>
                <td class="asset-rtt" id="${id_prefix}_rtt_min"></td>
                <td class="asset-rtt" id="${id_prefix}_rtt_max"></td>
                <td class="asset-rtt" id="${id_prefix}_rtt_avg"></td>
            </tr>
        </table>
        <div class="asset-position" id="${id_prefix}_position">Waiting for position ...</div>
        <table class="asset-battery-status" id="${id_prefix}_battery">
            <tr>
                <td>Remaining %</td>
                <td>Used (mAh)</td>
                <td>Voltage</td>
            </tr>
            <tr>
                <td id="${id_prefix}_battery_remaining">Unknown</td>
                <td id="${id_prefix}_battery_used">Unknown</td>
                <td id="${id_prefix}_battery_voltage">Unknown</td>
            </tr>
        </table>
            <table class="asset-search-status" id="${id_prefix}_search">
                <tr><td>Search</td><td>Completed</td><td>Total</td></tr>
                <tr>
                    <td id="${id_prefix}_search_id">Unknown</td>
                    <td id="${id_prefix}_search_current">Unknown</td>
                    <td id="${id_prefix}_search_total">Unknown</td>
                </tr>
            </table>
    </div>`;
    UIAssetStatus(server_entry.asset).append(html);

    const serverEntry = `
            <li class="nav-item">
                <button data-toggle="tab" class="nav-link server-tab-btn ${active}" href="#${id_prefix}">
                    ${server_entry.server.name}
                </button>
            </li>`
    UIAssetServerSelect(server_entry.asset).append(serverEntry);
}

function fieldMarkOld(field, timestamp, old, warn, prefix)
{
    var dbTime = new Date(timestamp);
    var timeDelta = (new Date()).getTime() - dbTime.getTime();
    if (timeDelta > old)
    {
        $(field).addClass(prefix + "-old");
    }
    else if (timeDelta > warn)
    {
        $(field).addClass(prefix + "-warn");
    }
    else
    {
        $(field).removeClass(prefix + "-old");
        $(field).removeClass(prefix + "-warn");
    }
}

function UIAssetServerPopulateStatus(server_entry, data)
{
    let id_prefix = UIAssetServerIdPrefix(server_entry);
    if ('position' in data)
    {
        $("#" + id_prefix + "_position").html(deg_to_dm(data.position.lat, true) + ' ' + deg_to_dm(data.position.lng, false));
        fieldMarkOld("#" + id_prefix + "_position", data.position.timestamp, asset_position_time_old, asset_position_time_warn, "asset-position");
        server_entry.position = data['position'];
    }
    if ('status' in data)
    {
        $("#" + id_prefix + "_battery_remaining").html(data['status']['battery_percent']);
        $("#" + id_prefix + "_battery_used").html(data['status']['battery_used']);
        $("#" + id_prefix + "_battery_voltage").html(data['status']['battery_voltage']);
        if (data['status']['battery_percent'] < battery_critical)
        {
            $("#" + id_prefix + "_battery").addClass("asset-battery-critical");
        }
        else if(data['status']['battery_percent'] < battery_warn)
        {
            $("#" + id_prefix + "_battery").addClass("asset-battery-warn");
        }
        fieldMarkOld("#" + id_prefix + "_battery", data.status.timestamp, battery_time_old, battery_time_warn, "asset-battery-time");
    }
    if ('search' in data)
    {
        $("#" + id_prefix + "_search_id").html(data['search']['id']);
        $("#" + id_prefix + "_search_current").html(data['search']['progress']);
        $("#" + id_prefix + "_search_total").html(data['search']['total']);
        fieldMarkOld("#" + id_prefix + "_search", data.search.timestamp, search_time_old, search_time_warn, "asset-search-time");
    }
    if ('rtt' in data)
    {
        $("#" + id_prefix + "_rtt_value").html(data['rtt']['rtt']);
        $("#" + id_prefix + "_rtt_min").html(data['rtt']['rtt_min']);
        $("#" + id_prefix + "_rtt_max").html(data['rtt']['rtt_max']);
        $("#" + id_prefix + "_rtt_avg").html(data['rtt']['rtt_avg']);
        fieldMarkOld("#" + id_prefix + "_rtt", data.rtt.timestamp, rtt_time_old, rtt_time_warn, "asset-rtt-time");
    }
    if ('command' in data)
    {
        var command_txt = data['command']['command'];
        if (data['command']['command'] == "Goto Position")
        {
            command_txt += " " + deg_to_dm(data['command']['lat'], true) + ", " + deg_to_dm(data['command']['lng']);
        }
        if (data['command']['command'] == "Adjust Altitude")
        {
            command_txt += " to " + data['command']['alt'] + "ft";
        }
        if (data['command']['command'] == "Manual")
        {
            command_txt = " <strong>Take Manual Control Now</strong>";
        }
        $("#" + id_prefix + "_command").html(command_txt);
    }
}

function UIAssetServerUpdateStatus(server_entry)
{
    $.getJSON(server_entry.getURL('status.json'), function(data){
              UIAssetServerPopulateStatus(server_entry, data);
              });
}

function serverUpdateAssets(server)
{
    $.getJSON(server.getURL("/assets.json"),
    function(data) {
        var assets = [];
        $.each(data['assets'], function(key, val) {
            assets.push(val);
        });
        for (var a in assets)
        {
            var asset = assetAddIfNew(assets[a]);
            let server_entry = asset.serverFind(server.name);
            if (server_entry === null)
            {
                server_entry = asset.serverAdd(server, assets[a].pk);
                UIAssetServerAdd(server_entry);
            }
            UIAssetServerUpdateStatus(server_entry);
          }
      }).fail(function() {});
}

function serverUpdateStatus(server)
{
    $.get(server.getURL('/status/'), function(data) {
          $("#server_status_" + server.name).html(data);
          $("#server_label_" + server.name).removeClass('server-label-failure');
          $("#server_label_" + server.name).addClass('server-label-connected');
          serverUpdateAssets(server);
          }).fail(function() {
              $("#server_status_" + server.name).html('<tr><td>Unreachable<td></tr>');
              $("#server_label_" + server.name).removeClass('server-label-connected');
              $("#server_label_" + server.name).addClass('server-label-failure');
          });
    $.get(server.getURL("/current_user/"), function(data) {
        if (data['currentUser'] == null)
        {
            $("#server_login_info_" + server.name).html(`<a href="${server.getURL('/login/')}">Login Here</a>`);
        }
        else
        {
            $("#server_login_info_" + server.name).html(`Logged in as: ${data.currentUser}`);
        }
    });
}

function serversUpdateKnown()
{
    // Load the known servers
    $.getJSON("../servers.json", function (data) {
              var servers = [];
              $.each(data['servers'], function(key, val) {
                     servers.push(val);
              });
              for (var s in servers)
              {
                var server = serverFind(servers[s].name);
                if (server === null)
                {
                    server = serverAdd (servers[s]);
                    /* Present new server */
                    UIServerNew(server);
                }
                serverUpdateStatus (server);
              }
    });
}

function setupPage()
{
    $.ajaxSetup({timeout: 2500 });
    let direct = serverAdd ({name: 'direct', address: '127.0.0.1', client_port: '0', url: window.location.href.slice(0, -1) });
    UIServerNew (direct);
    serverUpdateStatus(direct);
    serversUpdateKnown();
    setInterval(function () {
        for (var ks in known_servers)
        {
            serverUpdateStatus(known_servers[ks]);
        }
    }, 3000);
    setInterval(serversUpdateKnown, 30000);
}

setupPage();