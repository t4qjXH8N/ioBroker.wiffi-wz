/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
const utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.wiffi-wz.0
const adapter = utils.adapter('wiffi-wz');
let channels    = {};

// load a json file with settings for wiffi-wz and weatherman
const wiffi_configs = require(__dirname + '/wiffi_config.json');

const net = require('net');

// max buffer size
const maxBufferSize = 100000; // the buffer should not be bigger than this number to prevent DOS attacks

// triggered when the adapter is installed
adapter.on('install', function () {
  // create a node for subsequent wiffis
  adapter.createDevice('root', {});
});

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
  adapter.setState('info.connection', false);
  try {
    adapter.log.info('cleaned everything up...');
      callback();
  } catch (e) {
      callback();
  }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
  // Warning, obj can be null if it was deleted
  adapter.log.debug('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
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
  // make sure that the root node really exists
  adapter.getObject(adapter.namespace + '.root', function (err, obj) {
    if (!obj || !obj.common || !obj.common.name) {
      adapter.createDevice('root', {}, function () {
        main();
      });
    } else {
      main();
    }
  });
});

function main() {

  // The adapters config (in the instance object everything under the attribute "native") is accessible via

  // check setup of all wiffis
  syncConfig();

  // start socket listening on port 8181
  adapter.log.info("Opening socket ...");
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

  let server = net.createServer(function(sock) {

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

        // get ip from data json
        let ip;
        for(let j=0;j<jsonContent.vars.length;j++) {
          if(jsonContent.vars[j].homematic_name === 'r_ip')  ip = jsonContent.vars[j].value;
          if(jsonContent.vars[j].homematic_name === 'w_ip')  ip = jsonContent.vars[j].value;

          if(ip) break;
        }

        // check if wiffi-ip is in the database
        if (ip && (remote_address !== ip)) adapter.log.warn('Wiffi data received from ' + remote_address + ', but Wiffi should send from ip ' + ip);

        getid(ip, function (err, id) {
          let wiffi = [];
          for (let i = 0, len = adapter.config.devices.length; i<len; i++) {
            if (adapter.config.devices[i].ip === ip) {
              // found a wiffi
              wiffi.push({id: id, ip: ip, type: adapter.config.devices[i].type});
            }
          }

          if (wiffi.length === 0) {
            adapter.log.warn('Received data from unregistered wiffi with ip ' + ip);
          } else if (wiffi.length === 1) {
            // wiffi found

            // check if received type is identical to the type in the database
            if (jsonContent.modultyp.toUpperCase() !== wiffi[0].type.toUpperCase()) {
              adapter.log.warn('Received a datagram from a Wiffi of type ' + jsonContent.modultyp + ', but database holds type ' + wiffi.type);
            }

            // update wiffi states
            setStatesFromJSON(jsonContent, wiffi[0], function (err) {
              if (!err) {
                adapter.log.info('Wiffi states successfully updated.');
              } else {
                adapter.log.error('An error when updating the states.');
              }
            });
          } else {
            adapter.log.error('There are multiple wiffis registered with the ip ' + ip);
          }

          // clear buffer
          buffer = '';
        });
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
    adapter.log.debug('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
    adapter.setState('info.connection', false);
  });

  server.listen(port, host);
}

function syncConfig() {
  channels = {};

  adapter.getDevices(function (err, devices) {
    if (devices && devices.length) {
      // go through all devices
      for (let i = 0; i < devices.length; i++) {

        adapter.getChannelsOf(devices[i].common.name, function (err, _channels) {
          let configToDelete = [];
          let configToAdd    = [];

          // find all devices
          if (adapter.config.devices) {
            for (let k = 0; k < adapter.config.devices.length; k++) {
              configToAdd.push(adapter.config.devices[k].ip);
            }
          }

          if (_channels) {
            for (let j = 0; j < _channels.length; j++) {
              let ip = _channels[j].native.ip;
              let pos = configToAdd.indexOf(ip);
              if (pos !== -1) {
                configToAdd.splice(pos, 1);
              } else {
                // mark these channels for deletion
                configToDelete.push(ip);
              }
            }
          }

          // create new states for these devices
          if (configToAdd.length) {
            for (let r = 0; r < adapter.config.devices.length; r++) {
              if (adapter.config.devices[r].ip && configToAdd.indexOf(adapter.config.devices[r].ip) !== -1) {
                addDevice(adapter.config.devices[r].name, adapter.config.devices[r].ip, adapter.config.devices[r].room, adapter.config.devices[r].type)
              }
            }
          }
          if (configToDelete.length) {
            for (let e = 0; e < configToDelete.length; e++) {
              if (configToDelete[e]) {
                getid(configToDelete[e], function (err, _id) {
                  adapter.deleteChannelFromEnum('room', 'root', _id);
                  adapter.deleteChannel('root', _id);
                });
              }
            }
          }
        });
      }
    } else {
      for (let r = 0; r < adapter.config.devices.length; r++) {
        if (!adapter.config.devices[r].ip) continue;
        addDevice(adapter.config.devices[r].name, adapter.config.devices[r].ip, adapter.config.devices[r].room, adapter.config.devices[r].type)
      }
    }
  });
}

function getid(val, callback) {
  let id = 'no id set';
  let error;

  try {
    id = val.replace(/[.\s]+/g, '_');
  } catch (e) {
    error = e;
  }
  callback(error, id);
}

// create all states
function createStates(name, ip, room, type, callback) {
  adapter.log.debug('got ip ' + ip);
  getid(ip, function (err, id) {
    // create channel for the wiffi
    adapter.createChannel('root', id,
      {
        role: 'sensor',
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

      adapter.log.info('Created state ' + cstate.id);
        if(cstate.id === 'wz_ip' || cstate.id === 'w_ip') {
          cstate.def = ip;
        }

        adapter.createState('root', id, cstate.id, cstate, function (err, cstate) {
          if (err) adapter.log.error('Could not create state ' + cstate.id + '. Error: ' + err);
        });
    }
  });
}

// add wiffi
function addDevice(name, ip, room, type, callback) {
  adapter.getObject('root', function (err, obj) {
    if (err || !obj) {
      // if root does not exist, channel will not be created
      adapter.createDevice('root', [], function () {
        createStates(name, ip, room, type, callback);
      });
    } else {
      createStates(name, ip, room, type, callback);
    }
  });
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

String.prototype.replaceAll = function(search, replacement) {
  var target = this;
  return target.replace(new RegExp(search, 'g'), replacement);
};