'use strict'

const request = require('request');
const bus = require('./eventBus')
const url = 'https://api.bitfinex.com/v1/symbols_details';
var symbol_details_array = [];

request.get(url, async function(err, response, body) {
    var json = JSON.parse(body);
    
    if(err) return console.error(err);

    for (var i = 0; i <= json.length - 1; i++) {
        let alt = "t" + String(json[i]['pair'].substring(0,3)).toUpperCase();
        if(typeof symbol_details_array[alt] == 'undefined') {
            // Reassign by alt name
            symbol_details_array[alt] = {
                'maximum_order_size': json[i]['maximum_order_size'],
                'minimum_order_size': json[i]['minimum_order_size'] 
            }
            //console.log(alt, symbol_details_array[alt])
        }
    }
    module.exports.symbol_details_array = symbol_details_array;
    bus.emit('symbol-details', symbol_details_array);
})
