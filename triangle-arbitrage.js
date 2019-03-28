'use strict'

//process.env.DEBUG = '*'

const debug = require('debug')('triangle-arbitrage')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const BFX = require('bitfinex-api-node')

const log = require ('ololog').noLocate
const ansi = require ('ansicolor').nice
const style = require ('ansi-styles')
const chalk = require ('chalk')

const API_KEY = 'jZ1hZvn5dDn1rP4PrEDmY7V5ZwJ5xzzqXXgCvict0Py'
const API_SECRET = 'IJplAkD56ljxUPOs4lJbed0XfmhFaqzIrRsYeV5CvpP'

//Pair Arrays
//Need to use public API to update pairs automatically, filter out symbols that dont have multiple pairs to arb on.

var tpairs = []   // "tETHBTC"
var symbolOB = {} // {bids:[], asks:[], midprice:[], lastmidprice:[]}
var arbTrades = {} // {p1:[], p2:[], p3:[], minAmount:[]}
var balances
var p1, p2

const bfx = new BFX ({
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
  transform: true // auto-transform array OBs to OrderBook objects
})

const rest = bfx.rest(2)

const ws = bfx.ws(2) // WsV2

ws.on('error', (err) => {
  console.log('error: %s', err)
})

ws.onMessage('', (msg) => {
//console.log("MESSAGE")
})

ws.on('open', () => {
  console.log('open')
  ws.auth() 
})

ws.once('auth', async () => {
  console.log('authenticated')
  ws.enableSequencing({ audit: true })
  balances = await rest.balances()
  console.log(balances)
  subscribeOBs()
  getOBs()
})

/* FUNCTIONS */

// Add subscribeTrades after OB processes are done
/*
let subscribeTrades = function () {
  ws.subscribeTrades()
}
*/

//let tradingManager

let subscribeOBs = function () {
  
  var counter = 0
  tpairs = rv2.ethbtcpairs
  
  tpairs.forEach(pair => {

    ws.subscribeOrderBook(pair) 
      ? console.log('Subscribed to %s ',chalk.bold(pair)) 
      : console.log('Failed to subscribe to %s '.red,pair)

    symbolOB[pair] = {bids:{}, asks:{}, midprice:{}, lastmidprice:{}}
    arbTrades[pair] = {p1:{}, p2:{}, p3:{}, minAmount:{}}  
    counter++
    
  })

  console.log('Subscribed to %s out of %s symbols.', chalk.bold(String(counter)), chalk.bold(String(tpairs.length)))

}

let arbCalc = async function (p1,p2) {

  let p3 = 'tETHBTC'
  
  try{
    
    let pair1ask = symbolOB[p1]['asks'][0]
    let pair2bid = symbolOB[p2]['bids'][0]
    let pair3ask = symbolOB[p3]['asks'][0] //Pair constraint
    
    let profit = 0.0 //percentage of profit required to trigger,  
    let crossrate = ((1/pair1ask[0]) * pair2bid[0]) / pair3ask[0] 
    let perc = 1 - crossrate

    let minAmount = Math.min((pair1ask[2])*-1,(pair2bid[2]))
    let minETHAmount = (pair3ask[2]/pair1ask[0])

    let symbols_string = String(p1) + ' > ' + String(p2) + ' > ' + String(p3) + ' | '
    let alt_amount = String(arbTrades[p1]['minAmount']*-1) + ' ' + (minETHAmount*-1).toFixed(3)
    let bidask_string = String(pair1ask[0].toFixed(6)) + ' ' + String(pair2bid[0].toFixed(6)) + ' ' + chalk.bold(String(pair3ask[0].toFixed(6)))
    let crossrate_string = crossrate.toFixed(8).toString()
    
    // VSC git test: publish
    if (minETHAmount*-1 < minAmount*1) // ask amounts are negative
      minAmount = minETHAmount
    else
      minAmount = minAmount

    // arbTrade array {}
    arbTrades[p1]['p1'] = pair1ask
    arbTrades[p1]['p2'] = pair2bid
    arbTrades[p1]['p3'] = pair3ask
    arbTrades[p1]['minAmount'] = minAmount

    if (crossrate >= (1 + profit)) {
        console.log(symbols_string.green, chalk.bold(alt_amount) , '(' , pair3ask[2]*-1 ,'ETH )' ,'->',bidask_string, chalk.magenta('crossrate:'), chalk.bold.yellow(crossrate_string))
      }
    else {
        console.log(symbols_string.green, chalk.bold(alt_amount), '(' , pair3ask[2]*-1 ,'ETH )' , '->',bidask_string, chalk.magenta('crossrate:'), chalk.red.bold(crossrate_string), arbTrades[p1])
      }  
  }
  catch(err) {
    let errmsg = err.message
    let errarr 
    symbolOB[p1]['asks'] == null ? errarr = p1 : errarr = p2
    console.log(chalk.red.bold(errarr), errmsg.red, symbolOB[errarr], err)
  }
}

// 'ob' is a full OrderBook instance, with sorted arrays 'bids' & 'asks'  
let getOBs = function () {

  tpairs.forEach(symbol => {
    let sub = symbol.substring(4) //Last 3 chars of symbol, 'ETH' 'BTC' 'USD' etc

    symbolOB[symbol]['bids'] = 0
    symbolOB[symbol]['asks'] = 0    
    symbolOB[symbol]['midprice'] = -1
    symbolOB[symbol]['lastmidprice'] = -1

    ws.onOrderBook({ symbol, precision:"P4" }, async (ob) => {
    
      symbolOB[symbol]['midprice'] = await ob.midPrice() 
      symbolOB[symbol]['bids'] = await ob.bids;
      symbolOB[symbol]['asks'] = await ob.asks;

      console.log(symbolOB[symbol])
      
      if(symbolOB[symbol]['midprice'] !== symbolOB[symbol]['lastmidprice'] && sub == "ETH") {
        //Pair grouping, check first 4 letters of symbol then group with the other two by replacing substring.
        p1 = symbol;

        if (sub == "ETH") 
          p2 = p1.replace(sub,"BTC") //Only looking for ETH pairs, optimize array when arbcalc is done

        if (symbolOB[p1]['asks'] != null && symbolOB[p2]['bids'] != null && symbolOB['tETHBTC']['bids'] != null ){
          console.log(p1, p2)
          arbCalc(p1, p2)  
        }
        symbolOB[symbol]['lastmidprice'] = symbolOB[symbol]['midprice'] //Set lastmidprice
        }  
    })
  })
}
log("Finished!".green)//Finished symbolOB loop

ws.open()