'use strict'

//process.env.DEBUG = '*'

const debug = require('debug')('triangle-arbitrage')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const BFX = require('bitfinex-api-node')
const {OrderBook} = require('bfx-api-node-models')
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')

const CRC = require('crc-32')

const log = require ('ololog').noLocate
const ansi = require ('ansicolor').nice
const style = require ('ansi-styles')
const chalk = require ('chalk')
const TimSort = require('timsort');

const API_KEY = 'jZ1hZvn5dDn1rP4PrEDmY7V5ZwJ5xzzqXXgCvict0Py'
const API_SECRET = 'IJplAkD56ljxUPOs4lJbed0XfmhFaqzIrRsYeV5CvpP'

//Pair Arrays
//Need to use public API to update pairs automatically, filter out symbols that dont have multiple pairs to arb on.

var tpairs = []   // "tETHBTC"
var symbolOB = [] // {bids:[], asks:[], midprice:[], lastmidprice:[]}
var arbTrades = {} // {p1:[], p2:[], p3:[], minAmount:[]}
var balances
var triArray = []
var wsArray = []
var sockets = []
var mainpair = 'tETHBTC'


const bfx = new BFX ({
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
  transform: true // auto-transform array OBs to OrderBook objects
})

const rest = bfx.rest(2) //RESTv2
const ws = bfx.ws(2) //WSv2

// VSC git push through terminal test

ws.on('error', (err) => {
  console.log('error: %s', err)
})

ws.onMessage('', (msg) => {
  //msg = chalk.yellow(msg)
  //console.log(msg)
})

ws.on('open', () => {
  console.log('open')
  ws.auth() 
})

ws.once('auth', async () => {
  balances = await rest.balances()
  console.log(balances)
  console.log('authenticated')

  //ws.enableSequencing({ audit: true })
  await subscribeOBs().then(getOBLoop())
  //let pullOB = await getOBs();
})


/* FUNCTIONS */

// Add subscribeTrades after OB processes are done
/*
let subscribeTrades = function () {
  ws.subscribeTrades()
}
*/

//let tradingManager

function obUpdatePromise() {
      
  return new Promise((resolve, reject) => { 

    //obUpdate(alt,symbol, bids,'bids')
    //obUpdate(alt,symbol, asks,'asks')
    try {
      if(bids){

        for (let i = 0; i < update.bids.length; i++) {
          let obj = bids[i]
          let currentEntry = Object.keys(obj).map((k) => obj[k])
          symbolOB[alt][symbol].updateWith(currentEntry)
        }

      }

      if(asks) {
        for (let i = 0; i < update.asks.length; i++) {
          let obj = asks[i]
          let currentEntry = Object.keys(obj).map((k) => obj[k])
          symbolOB[alt][symbol].updateWith(currentEntry)

        }
      }
    } catch(err) {

      return reject(err)

    }
   
    //console.log(ws._orderBooks[symbol])
  })
}

//change to onOrderBookChecksum() and add promise
function checkcs() {
  
return new Promise ((resolve, reject) => {
  ws.on('cs', (cs) =>{

    //console.log(symbol, "chanId:",cbGID.chanId, cs[0])
    if (cs !== symbolOB[alt][symbol]['lastCs'] ) {

      if (cbGID.chanId === cs[0]) {

        if (symbolOB[alt][symbol].bids.length == 25 && symbolOB[alt][symbol].asks.length == 25) {   

          //make checksum from current OB
          let symbolOBcs = symbolOB[alt][symbol].checksum() //returns checksum from ob

          if(cs[2] !== symbolOBcs) {

            console.log(symbol, "checksum failed", cs[2],symbolOBcs)
            
            //unsub and resub to get snapshot? Clear OrderBook
            reSubscribe(symbol, alt)
            reject()
          } else {

            console.log(symbol, "checksum success".green,cs[2],symbolOBcs)
            symbolOB[alt][symbol]['lastCs'] = cs
            ws._orderBooks[symbol] = symbolOB[alt][symbol]
            resolve()
          }  
        
        }
      }
    } 

  })

  })
}


function obUpdate (altcoin,symbol,update,bidask) {


}


function getOBLoop () {

  tpairs.forEach( async (symbol) => { 

    getOBs(symbol);

  })

}

function subscribeOBs () {
  
  let counter = 0
  tpairs = rv2.ethbtcpairs
  
  return new Promise ( (resolve, reject) => {
  
    tpairs.forEach ( (pair) => {

      let pre = pair.substring(0,4); //prestring e.g "tOMG"
      let suf = pair.substring(4); // suffix e.g "ETH"

      ws.send({ event: 'conf', flags: 131072 }) // Checksum flag
      ws.subscribeOrderBook(pair) 

      try {

        console.log(`subscribed to ${pair} on socket ${Math.abs(CRC.str(pair))}`);
        
        if(suf == 'ETH' && pair !== mainpair) {

          let btc = pre, eth = pre;
          btc += "BTC";
          eth += "ETH";
          // Group symbolOB into altcoin objects (symbolOB["tOMG"]) with eth & btc pairs nested
          symbolOB[pre] = {};
          symbolOB[pre]['crossrate'] = -1;
          symbolOB[pre]['maxAmount'] = 0;
          symbolOB[pre]['lastCs'] = -1;
          
          arbTrades[pre] = {p1:"", p2:"", minAmount:"", crossrate:""};

        } 

        if (pair == mainpair) {
          let pre = mainpair.substring(0,4)
          symbolOB[pre] = {};
          
        }
        counter++
      }
      catch(err) {

        console.log(err);
        return reject(err)

      }
    }); 

  console.log(chalk.green("--DONE--"))
  console.log("Subscribed to %d out of %d", counter, tpairs.length)
  return true
  
  })
}

function reSubscribe(symbol, alt) {

  return new Promise((resolve,reject) => {

  symbolOB[alt][symbol]['bids'] = []
  symbolOB[alt][symbol]['asks'] = []

  console.log(symbolOB[alt][symbol])          
  
  let unsubbed = new Promise ((resolve, reject) => {

    ws.unsubscribeOrderBook(symbol) 
      ? resolve(console.log(`Unsubscribed from ${symbol}`)) 
      : reject(console.log(`Failed to unsubscribe from ${symbol}`))
    
  })

  if (unsubbed) {

    //resubscribe to OrderBook
    let resubbed = ws.subscribeOrderBook(symbol)
    
    resubbed ? resolve(console.log("Resubscribed to", symbol)) 
             : reject(console.log("failed to re-subscribe to", symbol))
    
  
  } else if (!unsubbed) {
    reject(console.log("failed to unsubscribe from", symbol))
  }
})

}

// 'ob' is a full OrderBook instance, with sorted arrays 'bids' & 'asks'  
function getOBs(symbol) {
  
  let alt = symbol.substring(0,4)
  let eth = 'ETH', btc = 'BTC'
  let altID = alt.concat('ID')
  let PRECISION = "P0"

  ws.onOrderBook({ symbol:symbol, precision:PRECISION, cbGID: altID}, (update,cbGID) => { 

    let bids = update.bids;
    let asks = update.asks
  
    //console.log(symbol, cbGID.chanId)

    // check if symbolOB has not initialized OrderBook objects for pairs
    if (!symbolOB[alt][alt.concat(eth)] || !symbolOB[alt][alt.concat(btc)]) {

      // Instantialize symbolOB symbol OrderBook with update
      if (typeof symbolOB[alt][symbol] == 'undefined') {

        symbolOB[alt][symbol] = new OrderBook(update)
        symbolOB[alt][symbol]["chanId"] = cbGID.chanId

      }
      
    } else if (typeof symbolOB[alt][symbol] !== 'undefined' && typeof symbolOB['tETH']['tETHBTC'] !== 'undefined' ) {

    // Promise here for both updates
    // or make obUpdate return promise? -> .then(arbcalc())
    
    obUpdatePromise().then(checkcs()).then(arbCalc(alt))
    // .then( arbCalc() )
    }

  })
  
  console.log(chalk.bold("fetching orderbook for" ,symbol))
  
}

let arbCalc = async function (alt) {

  let mpPre = mainpair.substring(0,4)
  let eth =  alt,btc =  alt;
  eth += "ETH";
  btc += "BTC"

  try{
    
    let pair1ask = symbolOB[alt][eth].asks[0] //symbolOB.tOMG.tOMGETH.asks[0]
    let pair2bid = symbolOB[alt][btc].bids[0] //symbolOB.tOMG.tOMGb.bids[0]
    let pair3ask = symbolOB[mpPre][mainpair].asks[0] //Pair constraint

    //console.log('PAIR1ASK:', pair1ask, symbolOB[alt], 'PAIR2BID:', pair2bid, symbolOB[p2])
    
    let profit = 0.0 //percentage of profit required to trigger,  
    let crossrate = ((1/pair1ask[0]) * pair2bid[0]) / pair3ask[0] 
    let perc = 1 - crossrate

    let minAmount = Math.min((pair1ask[2])*-1,(pair2bid[2]))
    let minETHAmount = (pair3ask[2]/pair1ask[0])

    let symbols_string = String(alt) + 'ETH > ' + String(alt) + 'BTC > ' + String(mainpair) + ' | '
    let alt_amount = String(arbTrades[alt]['minAmount']) + ' ' + (minETHAmount).toFixed(3)
    let bidask_string = String(pair1ask[0]) + ' ' + String(pair2bid[0]) + ' ' + chalk.bold(String(pair3ask[0]))
    let crossrate_string = crossrate.toFixed(8).toString()
    
    let makerFee = 0.1;
    let takerFee = 0.2;
    
    // VSC git test: publish
    if (minETHAmount*-1 < minAmount*1) // ask amounts are negative
      minAmount = minETHAmount
    else
      minAmount = minAmount

    // arbTrade array {}
    arbTrades[alt]['p1'] = pair1ask 
    arbTrades[alt]['p2'] = pair2bid
    arbTrades[alt]['p3'] = pair3ask
    arbTrades[alt]['minAmount'] = minAmount
    arbTrades[alt]['crossrate'] = crossrate
    
    if (crossrate >= (1 + profit)) {
        console.log(symbols_string.green, chalk.bold(alt_amount) , '(' , pair3ask[2]*-1 ,'ETH )' ,'->',bidask_string, chalk.magenta('crossrate:'), chalk.bold.yellow(crossrate_string))
      }
    else {
        console.log(symbols_string.green, chalk.bold(alt_amount), '(' , pair3ask[2]*-1 ,'ETH )' , '->',bidask_string, chalk.magenta('crossrate:'), chalk.red.bold(crossrate_string))
      }  
  }
  catch(err) {
    let errmsg = err.message
    let errarr 
    console.log(alt)
    //symbolOB[alt]['asks'] == undefined ? errarr = alt : errarr = p2
    console.log(chalk.red.bold(errarr), errmsg.red, err)
  }
}

log("Finished!".green)//Finished symbolOB loop

ws.open()

module.exports.symbolOB = symbolOB;
module.exports.arbTrades = arbTrades; 
module.exports.triArray = triArray;