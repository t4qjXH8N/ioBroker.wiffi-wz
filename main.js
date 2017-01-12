/**
 *
 * wiffi-wz adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "wiffi-wz",                  // name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.0.1",                    // use "Semantic Versioning"! see http://semver.org/
 *          "title":        "Wiffi-wz Adapter",  // Adapter title shown in User Interfaces
 *          "authors":  [                               // Array of authord
 *              "Christian Vorholt <chvorholt@gmail.com>"
 *          ]
 *          "desc":         "Adapter f�r den Wiffi-wz",          // Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       // possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   // possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 // cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      // Adapters Log Level
 *      },
 *      "native": {                                     // the native object is available via adapter.config in your adapters code - use it for configuration
 *          "ip": "wiffi-wz.fritz.box",
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils =    require(__dirname + '/lib/utils'); // Get common adapter utils

// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.wiffi-wz.0
var adapter = utils.adapter('wiffi-wz');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
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
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {
    main();
});

function main() {

  // The adapters config (in the instance object everything under the attribute "native") is accessible via
  // adapter.config:
  adapter.log.info('Opening local server on ' + adapter.config.local_server_ip + ':' + adapter.config.local_server_port);
  
  /**
   *
   *      For every state in the system there has to be also an object of type state
   *
   *      Here a simple wiffi-wz for a boolean variable named "testVariable"
   *
   *      Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
   *
   */

  /**
   * This is a part of the dataframe send by the Wffi-wz
   *
  {"name":"0","homematic_name":"wz_ip","desc":"ip des wiffi-wz","type":"string","unit":"","value":"192.168.0.23"},
  {"name":"1","homematic_name":"wz_co2","desc":"Luftqualitaet","type":"number","unit":"%","value":84},
  {"name":"2","homematic_name":"wz_temp","desc":"Temperatur","type":"number","unit":"gradC","value":22.9},
  {"name":"3","homematic_name":"wz_feuchte","desc":"Luftfeuchte","type":"number","unit":"%","value":34.0},
  {"name":"4","homematic_name":"wz_noise","desc":"Geraeusch","type":"boolean","unit":"","value":false},
  {"name":"5","homematic_name":"wz_luftdrucktrend","desc":"Luftdrucktrend","type":"string","unit":"","value":"steigend"},
  {"name":"6","homematic_name":"wz_motion_left","desc":"Bewegung links","type":"boolean","unit":"","value":false},
  {"name":"7","homematic_name":"wz_motion_right","desc":"Bewegung rechts","type":"boolean","unit":"","value":false},
  {"name":"8","homematic_name":"wz_lux","desc":"Helligkeit","type":"number","unit":"lux","value":0.00},
  {"name":"9","homematic_name":"wz_baro","desc":"Luftdruck","type":"number","unit":"mB","value":1008.89},
  {"name":"10","homematic_name":"wz_elevation","desc":"Sonne-Elevation","type":"number","unit":"grad","value":-25.3},
  {"name":"11","homematic_name":"wz_azimut","desc":"Sonne-Azimut","type":"number","unit":"grad","value":265.7},
  {"name":"12","homematic_name":"wz_buzzer","desc":"Buzzer","type":"boolean","unit":"","value":false}],
   */

  adapter.setObject('wz_co2', {
    type: 'state',
    common: {
      name: 'wz_co2',
      type: 'number',
      min: 0,
      max: 100,
      unit: '%',
      role: 'value',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_temp', {
    type: 'state',
    common: {
      name: 'wz_temp',
      type: 'number',
      role: 'level.temperature',
      unit: '°C',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_feuchte', {
    type: 'state',
    common: {
      name: 'wz_feuchte',
      type: 'number',
      min: 0,
      max: 100,
      role: 'value',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_noise', {
    type: 'state',
    common: {
      name: 'wz_noise',
      type: 'boolean',
      role: 'indicator',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_luftdrucktrend', {
    type: 'state',
    common: {
      name: 'wz_luftdrucktrend',
      type: 'string',
      role: 'text',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_motion_left', {
    type: 'state',
    common: {
      name: 'wz_motion_left',
      type: 'boolean',
      role: 'indicator',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_motion_right', {
    type: 'state',
    common: {
      name: 'wz_motion_right',
      type: 'boolean',
      role: 'indicator',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_lux', {
    type: 'state',
    common: {
      name: 'wz_lux',
      type: 'number',
      role: 'value',
      unit: 'lux',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_baro', {
    type: 'state',
    common: {
      name: 'wz_baro',
      type: 'number',
      role: 'value',
      unit: 'mbar',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_elevation', {
    type: 'state',
    common: {
      name: 'wz_elevation',
      type: 'number',
      role: 'value',
      unit: 'grad',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_azimut', {
    type: 'state',
    common: {
      name: 'wz_azimut',
      type: 'number',
      role: 'value',
      unit: 'grad',
      write: false
    },
    native: {}
  });

  adapter.setObject('wz_buzzer', {
    type: 'state',
    common: {
      name: 'wz_buzzer',
      type: 'boolean',
      role: 'indicator',
      write: true
    },
    native: {}
  });

  // in this wiffi-wz all states changes inside the adapters namespace are subscribed
  adapter.subscribeStates('*');

  // start socket listening on port 8181
  openSocket();
  console.log("Opening socket ...");
}

function openSocket() {
  var net = require('net');
  var host = adapter.config.local_server_ip;
  var port = adapter.config.local_server_port;

  // Create a server instance, and chain the listen function to it
  // The function passed to net.createServer() becomes the event handler for the 'connection' event
  // The sock object the callback function receives UNIQUE for each connection
  net.createServer(function(sock) {

    // We have a connection - a socket object is assigned to the connection automatically
    console.log('CONNECTED: ' + sock.remoteAddress +':'+ sock.remotePort);

    var maxBufferSize = 20000; // the buffer should not be bigger than this number to preven DOS attacks
    var buffer = '';

    sock.on('data', function(data) {
      var prev = 0;
      var error = false;
      var next;
      var jsonContent; // holds the parsed data

      data = data.toString('utf8'); // assuming utf8 data...
      // look for the terminator that terminates each Wiffi-wz JSON package
      while ((next = data.indexOf('\u0003', prev)) > -1) {
        buffer += data.substring(prev, next);

        // remove terminator from buffer
        buffer    = buffer.substr(0,buffer.length);

        // found terminator message should be complete
        console.log('Full message: ' + buffer);
        adapter.log.info('Received JSON data from Wiffi-wz');

        // try to parse the JSON object and set states
        try {
          jsonContent = JSON.parse(buffer);
        }
        catch(e) {
          error = true;
          adapter.log.error('Failed parsing JSON data from Wiffi-wz: ' + e.message)
        }

        if(!error) {
          // parsing successful, set the states
          setStatesFromJSON(jsonContent);
        }

        buffer = '';
        prev = next + 1;
      }
      buffer += data.substring(prev);

      // check if the buffer is larger than the allowed maximum
      if(buffer.length > maxBufferSize) {
          // clear buffer
          buffer = '';
          adapter.log.warn('JSON larger than allowed size of ' + maxBufferSize + ', clearing buffer');
      }
    });

    // Add a 'close' event handler to this instance of socket
    sock.on('close', function(data) {
      console.log('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
    });

  }).listen(port, host);

  console.log('Server listening on ' + host +':'+ port);
}

function setStatesFromJSON(curStates) {
  var arrVar; // hold the array with the wiffi-wz data objects

  arrVar = curStates.vars;

  // go through the array and set known states
  for(var i=0;i<arrVar.length;i++) {
    switch (arrVar[i].name) {
      case '0':
        // wz_ip
        break;
      case '1':
        // wz_co2
        adapter.setState('wz_co2', arrVar[i].value, true);
        break;
      case '2':
        // wz_temp
        adapter.setState('wz_temp', arrVar[i].value, true);
        break;
      case '3':
        // wz_feuchte
        adapter.setState('wz_feuchte', arrVar[i].value, true);
        break;
      case '4':
        // wz_noise
        adapter.setState('wz_noise', arrVar[i].value, true);
        break;
      case '5':
        // wz_luftdrucktrend
        adapter.setState('wz_luftdrucktrend', arrVar[i].value, true);
        break;
      case '6':
        // wz_motion_left
        adapter.setState('wz_motion_left', arrVar[i].value, true);
        break;
      case '7':
        // wz_motion_right
        adapter.setState('wz_motion_right', arrVar[i].value, true);
        break;
      case '8':
        // wz_lux
        adapter.setState('wz_lux', arrVar[i].value, true);
        break;
      case '9':
        // wz_baro
        adapter.setState('wz_baro', arrVar[i].value, true);
        break;
      case '10':
        // wz_elevation
        adapter.setState('wz_elevation', arrVar[i].value, true);
        break;
      case '11':
        // wz_azimut
        adapter.setState('wz_azimut', arrVar[i].value, true);
        break;
      case '12':
        // wz_wzbuzzer
        adapter.setState('wz_buffert', arrVar[i].value, true);
        break;

      default:
        console.log('Could not set state name=' + i + ' with homematic name ' + arrVar[i].homematic_name);
    }
  }

  adapter.log.info('Wiffi-wz states updated.');

}
