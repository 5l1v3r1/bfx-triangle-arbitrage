'use strict'

const request = require('request');
const url = 'https://api.bitfinex.com/v1/symbols_details';
var symbol_details_array = [];

request.get(url, function(err, response, body) {

    var json = JSON.parse(body);
    
    for (var i = 0; i <= json.length - 1; i++) {
        let alt = "t" + json[i]['pair'].substring(0,3);
        if(typeof symbol_details_array[alt] == 'undefined') {
            // Reassign by alt name
            symbol_details_array[alt] = {
                'maximum_order_size': json[i]['maximum_order_size'],
                'minimum_order_size': json[i]['minimum_order_size'] 
            }
            console.log(alt, symbol_details_array[alt])
        }
    }
    console.log(`EXPORTED SYMBOL DETAILS\n`)
    module.exports.symbol_details_array = symbol_details_array;
})



function filterIt(arr, searchKey) {
    return arr.filter(obj => Object.keys(obj).some(key => obj[key].includes(searchKey)));
  }