/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.wiffi-wz.0
const adapter = utils.adapter('wiffi-wz');
const adapter_db_prefix = 'wiffi-wz' + adapter.instance;  // shortcut for the adapter prefix in the database

let channels = {};

// load a json file with settings for wiffi-wz and weatherman
const wiffi_configs = require(__dirname + '/wiffi_config.json');

const net = require('net');  // for opening a socket listener
const semver = require('semver');  // for dealing with different wiffi firmwares
const JSONPath = require('jsonpath');

// max buffer size
const maxBufferSize = 100000; // the buffer should not be bigger than this number to prevent DOS attacks

// server handle
let server;

// triggered when the adapter is installed
adapter.on('install', function () {
  // create a node for subsequent wiffis
  adapter.createDevice('root', {});
});

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
  adapter.setState('info.connection', false);
  try {
    adapter.log.info('Stopping adapter ...');
    server.close();
    adapter.log.info('Adapter stopped.');
    callback(true);
  } catch (e) {
    callback(e);
  }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
  // Warning, obj can be null if it was deleted
  adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes (not used at the moment, dummy only)
adapter.on('stateChange', function (id, state) {
  // Warning, state can be null if it was deleted
  adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

  // you can use the ack flag to detect if it is status (true) or command (false)
  if (state && !state.ack) {
    adapter.log.debug('ack is not set!');
  }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
  main();
});

function main() {
  // The adapters config (in the instance object everything under the attribute "native") is accessible via

  // check setup of all wiffis
  syncConfig();

  // start socket listening on port 8181
  openSocket();
}

function openSocket() {
  let host = adapter.config.local_server_ip;
  let port = adapter.config.local_server_port;

  // Create a server instance, and chain the listen function to it
  // The function passed to net.createServer() becomes the event handler for the 'connection' event
  // The sock object the callback function receives UNIQUE for each connection

  adapter.log.info('Opening local server on ' + host + ':' + port);
  let buffer = '';

   server = net.createServer(function(sock) {

    sock.on('data', function(data) {
      let remote_address = sock.remoteAddress;

      let jsonContent; // holds the parsed data
      let buffer_cond; // holds a buffer prepared for parsing
      let endpos;
      let startpos;

      buffer += data.toString('utf8'); // collect buffer until it is full or we found a terminator

      // workaround for nans in the buffer
      buffer = buffer.replaceAll(':nan', ':"nan"');
      buffer = buffer.replaceAll(':\'nan\'', ':"nan"');

      // check if the buffer is larger than the allowed maximum
      if (buffer.length > maxBufferSize) {
        // clear buffer
        adapter.log.warn('JSON larger than allowed size of ' + maxBufferSize + ', clearing buffer');
        adapter.log.debug('Received datagram: ' + buffer);
        buffer = '';
      }

      // look for a terminator
      // check if we have a valid JSON
      buffer_cond = buffer.replace(/\s/g, '').split('\u0003');
      for (let i=0;i<buffer_cond.length;i++) {
        try {
          jsonContent = JSON.parse(buffer_cond[i].trim());
        } catch (e) {}
        if (jsonContent) break;
      }

      if (!jsonContent) {
        buffer_cond = buffer.replace(/\s/g, '').split('\u0004');
        for (let i=0;i<buffer_cond.length;i++) {
          try {
            jsonContent = JSON.parse(buffer_cond[i].trim());
          } catch (e) {}
          if (jsonContent) break;
        }
      }

      // maybe there is no terminator?
      if (!jsonContent) {
        try {
          jsonContent = JSON.parse(buffer_cond.trim());
        } catch (e) {}
      }

      // ok, last resort, try to find start and ending in buffer
      if (!jsonContent) {
        startpos = buffer.indexOf('{"modultyp"');
        endpos = buffer.indexOf('}}');

        try {
          jsonContent = JSON.parse(buffer.substring(startpos, endpos+2));
        } catch(e) {}
      }

      if(jsonContent) {
        adapter.log.debug('Received JSON data from Wiffi. Full message: ' + buffer);

        // get the ip of the wiffi
        let ip;
        if(jsonContent.hasOwnProperty('vars') && Array.isArray(jsonContent.vars) && jsonContent.vars.length > 0) {
          // datagram seems to be fine, look for an ip
          for(let j=0;j<jsonContent.vars.length;j++) {
            if(jsonContent.vars[j].homematic_name.search(/_ip/i)  !== -1) {
              ip = jsonContent.vars[j].value;
              break;
            }
          }
        }

        if(!ip) {
          adapter.log.error('Datagram error, could not find an ip!');
          buffer = '';
          return;
        }

        let wiffi_in_config = JSONPath.query(adapter.config, '$.devices[?(@.ip=="' + ip + '")]');
        // check if wiffi-ip is registered, i.e. it is in the database
        if (wiffi_in_config.length === 0) {
          adapter.log.warn('Received data from unregistered Wiffi with ip ' + ip);
          return;
        }

        // wiffi found, check if the type in the database is equal to the type that the wiffi sends
        adapter.getState('root.' + ip_to_id(ip) + '.Type', function(err, state) {
          if(err || !state) {
            adapter.log.error('State type does not exists for wiffi with ip ' + ip + ' !');
            return;
          }
          if(!jsonContent.hasOwnProperty('modultyp')) {
            adapter.log.error('Modultyp not present in wiffi datagram');
            return;
          }
          if(jsonContent.modultyp.toUpperCase() === state.val.toUpperCase()) {
            // all fine, update the states
          } else {
            // wiffi type has been changed (or not prepared yet), update states of the database

          }
        });

        // check if received type is identical to the type in the database
        if (jsonContent.modultyp.toUpperCase() !== wiffi[0].type.toUpperCase()) {
          adapter.log.warn('Received a datagram from a Wiffi of type ' + jsonContent.modultyp + ', but database holds type ' + wiffi.type);
        }

        // TODO: check version and create or remove states if necessary


        // update wiffi states
        setStatesFromJSON(jsonContent, wiffi[0], function (err) {
          if (!err) {
            adapter.log.debug('Wiffi states successfully updated.');
          } else {
            adapter.log.error('An error when updating the states.');
          }
        });

        // clear buffer
        buffer = '';
      }
    });
  });

  // Add a 'close' event handler to this instance of socket
  server.on('listening', function() {
    adapter.log.info('Server listening on ' + host +':'+ port);
    adapter.setState('info.connection', true);
  });

  server.on('close', function(err) {
    if (err) adapter.log.error('An error occurred closing the server.');
    adapter.log.debug('Server closed');
    adapter.setState('info.connection', false);
  });

  server.on('error', function(err){
    adapter.log.error('Error: ' + err.message);
    adapter.setState('info.connection', false);
  });

  server.listen(port, host);
}

// sync config with database
function syncConfig() {
  channels = {};

  adapter.getDevices(function (err, devices) {
    if (devices && devices.length) {
      // go through all devices
      for (let i=0;i< devices.length;i++) {
        // get channels for device
        adapter.getChannelsOf(devices[i].common.name, function (err, _channels) {
          let configToDelete = [];
          let configToAdd    = [];

          // find new devices
          if(adapter.config.devices) {
            for (let k=0;k<adapter.config.devices.length;k++) {
              configToAdd.push(adapter.config.devices[k].ip);
            }
          }

          // find devices that have to be removed
          if (_channels) {
            for (let j=0;j<_channels.length;j++) {
              let wiffi_in_config = JSONPath.query(adapter.config, '$.devices[?(@.ip=="' + id_to_ip(_channels[j]._id.split('.')[3]) + '")]');
              if(!wiffi_in_config || wiffi_in_config.length === 0) {
                configToDelete.push(_channels[j]._id.split('.')[3]);  // mark these channels for deletion
              }
            }
          }

          // create new states for these devices
          if (configToAdd.length) {
            for (let r=0;r<adapter.config.devices.length;r++) {
              if (adapter.config.devices[r].ip && configToAdd.indexOf(adapter.config.devices[r].ip) !== -1) {
                createBasicStates(adapter.config.devices[r].name, adapter.config.devices[r].ip, adapter.config.devices[r].room)
              }
            }
          }
          if (configToDelete.length) {
            for (let e=0;e<configToDelete.length;e++) {
              adapter.deleteChannelFromEnum('room', 'root', configToDelete[e]);
              adapter.deleteChannel('root', configToDelete[e]);
            }
          }
        });
      }
    } else {
      // there is no device yet, create new
      for (let r=0;r<adapter.config.devices.length;r++) {
        if (!adapter.config.devices[r].ip) continue;
        createBasicStates(adapter.config.devices[r].name, adapter.config.devices[r].ip, adapter.config.devices[r].room)
      }
    }
  });
}

// create only states that all wiffis have in common (which is only the firmware state at the moment)
function createBasicStates(name, ip, room, type, callback) {
  adapter.log.debug('Create basic states for Wiffi with ip ' + ip);

  // add the wiffi to the corresponding room enum
  if (room) {
    adapter.addChannelToEnum('room', room, 'root', ip_to_id(ip), function (err) {
      if (err) adapter.log.error('Could not add Wiffi with ' + name + ' (' + ip + ') to enum. Error: ' + err);
    });
  }

  // create channel for the wiffi
  adapter.createChannel('root', ip_to_id(ip), {name: name}, function (err) {
    if (err) {
      adapter.log.error('Could not create channel.');
      if(callback) callback(err);
    } else {
      // add more "native" states here if necessary
      let bstates = [
        {
        "id": "IP",
        "type": "string",
        "read": true,
        "write": false,
        "role": "info.ip",
        "def": ip,
        "desc": "IP-address of the Wiffi"
      }, {
        "id": "Type",
        "type": "string",
        "read": true,
        "write": false,
        "role": "text",
        "def": "",
        "desc": "Type of Wiffi"
      }, {
        "id": "Firmware",
        "type": "string",
        "read": true,
        "write": false,
        "role": "text",
        "def": "",
        "desc": "Firmware installed on the Wiffi"
      }, {
        "id": "MAC-Address",
        "type": "string",
        "read": true,
        "write": false,
        "role": "info.mac",
        "def": "",
        "desc": "MAC-address of Wiffi"
      }, {
        "id": "Sec-since-reset",
        "type": "number",
        "unit": "s",
        "read": true,
        "write": false,
        "role": "value.interval",
        "desc": "Seconds since reset of the Wiffi"
      }, {
        "id": "WLAN-SSID",
        "type": "string",
        "read": true,
        "write": false,
        "role": "text",
        "def": "",
        "desc": "WLAN SSID of the WLAN where the Wiffi is logged in"
      }, {
        "id": "WLAN-Signal-Strength",
        "type": "number",
        "read": true,
        "write": false,
        "role": "value",
        "unit": "dbm",
        "desc": "WLAN signal strength of the WLAN where the Wiffi is logged in"
      }];

      // wait for the states to be created before continue
      let states_todo = bstates.length;

      for(let i=0;i<bstates.length;i++) {
        adapter.createState('root', ip_to_id(ip), bstates[i].id, bstates[i], function (err, cstate) {
          if(err) {
            adapter.log.error('Could not create state ' + cstate.id + '. Error: ' + err);
            if(callback) callback(err);
          } else {
            states_todo--;
            if(states_todo === 0) {
              // we have created all states
              if(callback) callback(false);
            }
          }
        });
      }
    }
  });
}

// create states for a specific wiffi version if they do not exist
function createStatesNotExists(name, ip, room, type, callback) {
  adapter.log.debug('Create states if necessary ' + ip);

    // create channel for the wiffi
    adapter.createChannel('root', id,
      {
        role: 'state',
        name: name || ip
      },{
        ip: ip
      }, function (err) {
        if (err) adapter.log.error('Could not create channel.');
      });

    // add the wiffi to the corresponding room enum
    if (room) {
      adapter.addChannelToEnum('room', room, 'root', id, function (err) {
        if (err) adapter.log.error('Could not create state ' + cstate + '. Error: ' + err);
      });
    }

    // TODO: here we could look for a specific version
    // look for type in states
    let w_conf = wiffi_configs;
    let states;

    for(let j=0; j < w_conf.length; j++) {
      if(w_conf[j].type === type) {
        states = w_conf[j].states;
        break;
      }
    }

    // create all states
    for(let k=0; k < states.length; k++) {
      let cstate = states[k];

      adapter.log.debug('Created state ' + cstate.id);
      if(cstate.id === 'wz_ip' || cstate.id === 'w_ip') {
        cstate.def = ip;
      }

      adapter.createState('root', id, cstate.id, cstate, function (err, cstate) {
        if (err) adapter.log.error('Could not create state ' + cstate.id + '. Error: ' + err);
      });
    }
  }

// set states from the received JSON
function setStatesFromJSON(curStates, wiffi, callback) {
  let arrVar; // hold the array with the wiffi-wz data objects

  arrVar = curStates.vars;

  // go through the array and set states
  for(let i=0; i<arrVar.length; i++) {
    adapter.setState("root." + wiffi.id + "." + arrVar[i].homematic_name,
      {"val": arrVar[i].value, "ack": true}, function (err) {
        if(err) adapter.log.error('Could not set state!');
      });
  }

  callback(false);
}

// enhance string with replace all functionality
String.prototype.replaceAll = function(search, replacement) {
  let target = this;
  return target.replace(new RegExp(search, 'g'), replacement);
};

// convert ip to a valid state id
function ip_to_id(ip) {
  return ip.replace(/[.\s]+/g, '_');
}

// convert a state id to an ip
function id_to_ip(id) {
  return id.replace(/[_\s]+/g, '.');
}

// checks if a state or exists, takes also arrays of states and returns array with true or false
function checkStateExists(states_id, callback) {

  if(Array.isArray(states_id)) {
    // check array of states
    let states_todo = states_id.length;
    let return_vals = [];

    // prepare return array
    for(let j=0;j<states_todo;j++) {
      return_vals.push(false);
    }

    for(let i=0;i<states_todo;i++) {
      adapter.getObject(states_id[i], function(err, state) {
        return_vals[i] = !err && state;
        states_todo--;

        if(states_todo === 0) {
          // we are done
          callback(return_vals);
        }
      });
    }
  } else {
    // check if single state exists
    adapter.getObject(states_id, function(err, state) {
      callback(!err && state);
    });
  }
}
