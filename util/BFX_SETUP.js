const BFX = require('bitfinex-api-node')
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')
//var api_obj = require('./apikeys.json');

var API_KEY = process.env.API_KEY;
var API_SECRET = process.env.API_SECRET;

var bfxArray = [];
const bfx = new BFX ();

/**
 * 
 *  BFX Setup
 *  
 *  Creates a BFX instance array to split up pair connections. 
 *  Each instance has a 60 + 1 (mainpair) pair max to avoid timing out.
 * 
 *  
 */ 
async function makeInstances() {
for (var i = 0; i <= 5; i++) {
    bfxArray[i] = bfx.ws(2,{
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
      transform: true // auto-transform array OBs to OrderBook objects
    })  
    //console.log("Pushed bfx.ws to bfxArray -> " + bfxArray[i])
    }
}

makeInstances().then();

module.exports.BFX_INSTANCES = bfxArray;