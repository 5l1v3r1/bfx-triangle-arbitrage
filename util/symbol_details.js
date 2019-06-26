'use strict'

const request = require('request');
const url = 'https://api.bitfinex.com/v1';
request.get(url, '/symbols_details', function(err, response, body) {

    module.exports.symbol_details = body

})