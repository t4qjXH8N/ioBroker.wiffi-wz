/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const _ = require('underscore');

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.wiffi-wz.0
let adapter_db_prefix;  // shortcut for the adapter prefix in the database

let channels = {};
let subscribed_states = [];

// load a json file with settings for wiffi-wz and weatherman
//const wiffi_native_states = require(__dirname + '/wiffi_native_states.json');
const state_extensions = require(__dirname + '/state_extensions.json');

const net = require('net');  // for opening a socket listener
const JSONPath = require('jsonpath');
const request = require('request');

// max buffer size
const maxBufferSize = 100000; // the buffer should not be bigger than this number to prevent DOS attacks

// server handle
let server;

let adapter;
function startAdapter(options) {
  options = options || {};
  Object.assign(options, {
    name: "wiffi-wz",
    install: adapter_install,
    unload: adapter_unload,
    objectChange: adapter_objectChange,
    stateChange: adapter_stateChange,
    ready: adapter_ready
  });
  adapter = new utils.Adapter(options);

  return adapter;
}

// triggered when the adapter is installed
const adapter_install = function () {
  // create a node for subsequent wiffis
  adapter.createDevice('root', {});
};

// is called when adapter shuts down - callback has to be called under any circumstances!
const adapter_unload = function (callback) {
  adapter.setState('info.connection', false);

  let mycallback = callback;

  server.on('close', (err) => {
    if (err) adapter.log.error('An error occurred closing the server.');
    adapter.log.debug('Server closed');
    adapter.setState('info.connection', false);
    adapter.log.info('Adapter stopped.');

    if (mycallback) mycallback(false);
  });

  try {
    adapter.log.info('Stopping adapter ...');
    server.close();
  } catch (e) {
    callback(e);
  }
};

// is called if a subscribed object changes
const adapter_objectChange = function (id, obj) {
  // Warning, obj can be null if it was deleted
  adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
};

// is called if a subscribed state changes (not used at the moment, dummy only)
const adapter_stateChange = function (id, state) {
  // Warning, state can be null if it was deleted
  adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

  // you can use the ack flag to detect if it is status (true) or command (false)
  if (state && !state.ack && subscribed_states.includes(id)) {
    let actor = id.split('.')[id.split('.').length-1];

    if(actor.split('_').length >= 2) {
      actor = actor.slice(actor.indexOf('_') + 1);
      switchActor(id_to_ip(id.split('.')[3]), actor, state['val']);
    }
  }
};

// is called when databases are connected and adapter received configuration.
// start here!
const adapter_ready = function () {
  adapter_db_prefix = 'wiffi-wz.' + adapter.instance + '.root.';

  adapter.getForeignObjects(adapter_db_prefix + '*', function(err, objs) {
    if(err) {
      adapter.log.err('Could not get states for subscription test! Error ' + err);
    } else {
      for(let citem in objs) {
        if(!objs.hasOwnProperty(citem)) continue;
        checkAndSubscribe(id_to_ip(citem.split('.')[3]), objs[citem].common);
      }
      main();
    }
  });
};

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
          // datagram seems to be fine, look for an ip in homematic name
          ip = _.find(jsonContent.vars, function (cvar) {
            return cvar.homematic_name.search(/_ip/i);
          });

          ip = (ip.hasOwnProperty('value')) ? ip.value : null;
        }

        if (!ip) {
          adapter.log.error('Datagram error, could not find an ip!');
          buffer = '';
          return;
        }

        let wiffi_in_config = JSONPath.query(adapter.config, '$.devices[?(@.ip=="' + ip + '")]');
        // check if wiffi-ip is registered, i.e. it is in the database
        if (wiffi_in_config.length === 0) {
          adapter.log.warn('Received data from unregistered Wiffi with ip ' + ip);
          //return;
        }

        // wiffi found, check if the type or the firmware in the database is different than the values received from the Wiffi
        syncStates(ip, jsonContent, function() {
          updateStates(ip, jsonContent, function() {
            adapter.log.debug('Received states from Wiffi with ip ' + ip + ' and states were updated successfully!');
          });
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
    }
  });
}

// create states for a specific wiffi version if they do not exist
function syncStates(ip, jsonContent, callback) {
  adapter.log.debug('Creating states for wiffi with ip ' + ip + ', if necessary.');

  function addState(ip, cstate, is_sysinfo) {
    // add state
    let state = {
      "read": true,
      "write": false,
      "desc": "",
      "unit": "",
      "role": "state"  // default if there is no other information on the roles
    };

    if (cstate.hasOwnProperty('homematic_name') && cstate.homematic_name) {
      state['id'] = cleanid(cstate.homematic_name);
    } else {
      // if id not present use name if set
      if(cstate.hasOwnProperty('name') && cstate.name) {
        state['id'] = cleanid(cstate.name);
      } else {
        // sorry, I have no idea how to deal with this datapoint
        if(!cstate.desc) cstate.desc = 'description missing';
        adapter.log.warn('Wiffi with ip ' + ip + ' received a datapoint without homematic_name (description is ' + cstate.desc + ')!');
        return;
      }
    }

    if (cstate.hasOwnProperty('name') && cstate.name) {
      state['name'] = cstate.name.toString();
    }

    if (cstate.hasOwnProperty('desc') && cstate.desc) {
      state['desc'] = cstate.desc;
    }

    if (cstate.hasOwnProperty('unit') && cstate.unit) {
      state['unit'] = cstate.unit.replace(/grad/ig, '°');
    }

    if (cstate.hasOwnProperty('type') && cstate.type) {
      switch (cstate.type) {
        case 'string':
          state['type'] = 'string';
          state['role'] = 'text';
          break;
        case 'number':
          state['type'] = 'number';
          if(!state['write'] && state['read']) {
            state['role'] = 'value';
          }  else if(state['write'] && state['read']) {
            state['role'] = 'level';
          }
          break;
        case 'boolean':
          state['type'] = 'boolean';
          state['def'] = false;
          if(state['write'] && state['read']) {
            state['role'] = 'switch';
          } else if(state['read'] && !state['write']) {
            state['role'] = 'sensor';
          } else if(!state['read'] && !state['write']) {
            state['role'] = 'button';
          }
          break;
        default:
      }
    }

    // load state extensions if there are any
    for (let j=0;j<state_extensions.length;j++) {
      if ((state['id'].search(RegExp(state_extensions[j].expression, 'i')) !== -1) && state_extensions[j].hasOwnProperty('extensions')) {
        // we found some extensions
        let cext = state_extensions[j].extensions;
        Object.assign(state, cext);
        break;
      }
    }

    // is it a sysconfig state?
    // in this case put it into the group sysconfig
    let obj = {
      "_id": adapter_db_prefix + ip_to_id(ip) + '.Systeminfo',
      "type": "folder",
      "common": {
        "name": "Systeminfo"
      },
      "native": {}
    };

    if(is_sysinfo) {
      adapter.setObjectNotExists('root.' + ip_to_id(ip) + '.Systeminfo', obj, function (err) {
        if (err) {
          adapter.log.error('Could not create group for Systeminfo states')
        } else {
          let new_state = {
            "_id": 'root.' + ip_to_id(ip) + '.Systeminfo.' + cleanid(state['id']),
            "type": "state",
            "common": state,
            "native": {}
          };

          adapter.setObjectNotExists('root.' + ip_to_id(ip) + '.Systeminfo.' + cleanid(state['id']), new_state, function (err, cstate) {
            if (err || !cstate) {
              adapter.log.error('Could not create a state ' + err);
            } else {
              adapter.log.debug('Created state ' + cstate.id + ' for wiffi ip ' + ip);
              checkAndSubscribe(ip, state);
            }
          });
        }
      });
    } else {
      adapter.createState('root', ip_to_id(ip), cleanid(state['id']), state, function (err, cstate) {
        if (err || !cstate) {
          adapter.log.error('Could not create a state ' + err);
        } else {
          adapter.log.debug('Created state ' + cstate.id + ' for wiffi ip ' + ip);
          checkAndSubscribe(ip, state);
        }
      });
    }
  }

  adapter.getStates(adapter_db_prefix + ip_to_id(ip) + '.*', function(err, states) {
    if(err) {
      adapter.log.error('Error getting states for StateSync!');
      return;
    }

    // collect states that are already present in the db
    let states_in_db = [];
    let sys_states_in_db = [];

    for(let cstate in states) {
      if(!states.hasOwnProperty(cstate)) continue;

      if(cstate.split('.').length === 5) {
        states_in_db.push(cstate.split('.')[cstate.split('.').length - 1]);
      } else if(cstate.split('.').length === 6) {
        sys_states_in_db.push(cstate.split('.')[cstate.split('.').length - 1]);
      }
    }

    // sync native systemconfig states
    for(let csysstate in jsonContent.Systeminfo) {
      if(!jsonContent.Systeminfo.hasOwnProperty(csysstate)) continue;

      // is state already in db?
      if(!sys_states_in_db.includes(cleanid(csysstate))) {
        // create a new system state
        let sys_state = {
          "homematic_name": csysstate,
          "type": typeof(jsonContent.Systeminfo[csysstate]),
          "name": csysstate,
          "value": jsonContent.Systeminfo[csysstate]
        };
        addState(ip, sys_state, true);
      }
    }

    // data states
    for(let i=0;i<jsonContent.vars.length;i++) {
      let cstate = jsonContent.vars[i];

      // is state already in db?
      if (!(states_in_db.includes(cleanid(cstate.homematic_name)) || states_in_db.includes(cleanid(cstate.name)))) {
        addState(ip, cstate, false);
      }
    }

  });

  callback(false);
}

// set states from the received JSON
function updateStates(ip, jsonContents, callback) {
  // update systeminfo states
  if(jsonContents.hasOwnProperty('Systeminfo')) {
    for(let citem in jsonContents.Systeminfo) {
      if(!jsonContents.Systeminfo.hasOwnProperty(citem)) continue;

      adapter.setState('root.' + ip_to_id(ip) + '.Systeminfo.' + cleanid(citem), {val: jsonContents.Systeminfo[citem], ack: true}, function (err) {
        if(err) {
          adapter.log.error('Could not set state!');
        }
      });
    }
  }

  // go through the array and set states
  for(let i=0;i<jsonContents.vars.length;i++) {
    let cstate = jsonContents.vars[i];

    if (!(cstate.hasOwnProperty('homematic_name') && cstate.homematic_name)) {
      // use name if id is missing
      if(cstate.hasOwnProperty('name') && cstate.name) {
        cstate['homematic_name'] = cstate.name;
      } else {
        if (!cstate.desc) cstate.desc = 'description missing';
        adapter.log.debug('Wiffi with ip ' + ip + ' received a datapoint without homematic_name (description is ' + cstate.desc + ')!');
        continue;
      }
   }

    let val = cast_wiffi_value(cstate.value, cstate.type);
    adapter.setState('root.' + ip_to_id(ip) + '.' + cleanid(cstate.homematic_name),
      {val: val, ack: true}, function (err) {
        if(err) {
          adapter.log.error('Could not set state!');
        }
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

// return valid state ids only
function cleanid(id) {
  return id.replace(/[!*?\[\]"'.]/ig, '_');
}

function checkAndSubscribe(ip, state, callback) {
  if(state.hasOwnProperty('write') && state['write']) {
    adapter.subscribeStates('root.' + ip_to_id(ip) + '.' + cleanid(state['id']));
    subscribed_states.push(adapter_db_prefix + ip_to_id(ip) + '.' + cleanid(state['id']));
  }

  if(callback) callback(false);
}

function switchActor(ip, actor, value, callback) {

  let send_val;
  if(value) {
    send_val = 'on';
  } else {
    send_val = 'off';
  }

  let options_connect = {
    url: 'http://' + ip + '/?' + actor + ':' + send_val + ':',
    headers: {
      "Content-Type": "application/json"
    },
    method: "GET"
  };

  request(options_connect, function(err, response) {
    if(err || !response) {
      // no connection or auth failure
      adapter.log.error('Connection error on switching actor ' + actor + ' to value ' + send_val + '!');
      if(callback) callback(err);
    } else {
      adapter.log.debug('Successfully switched actor ' + actor + ' to value ' + send_val);
      if(callback) callback(false);
    }
  });
}

// helper function, checks if state already exists - unused
/*
function stateExists(id, callback){
  adapter.getState(id, (err, state) => {
    if(err || !state) {
      callback(false);
    } else {
      callback(true);
    }
  });
}
 */

// cast value, if necessary
function cast_wiffi_value(wiffi_val, wiffi_type) {
  let val;
  switch (wiffi_type) {
    case 'boolean':
      if(typeof wiffi_val === 'boolean') {
        val = wiffi_val;
      } else {
        val = (wiffi_val === 'true');
      }
      break;
    case 'number':
      val = Number(wiffi_val);
      break;
    default:
      val = wiffi_val;
  }

  return val;
}

if (module === require.main) {
  // start the instance directly
  startAdapter();
} else {
  // If started as allInOne/compact mode => return function to create instance
  module.exports = startAdapter;
}