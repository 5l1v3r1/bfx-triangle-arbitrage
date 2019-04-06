'use strict'

//process.env.DEBUG = '*'

const debug = require('debug')('triangle-arbitrage')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const BFX = require('bitfinex-api-node')
const CRC = require('crc-32')

const log = require ('ololog').noLocate
const ansi = require ('ansicolor').nice
const style = require ('ansi-styles')
const chalk = require ('chalk')

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

  ws.enableSequencing({ audit: true })
  let subscribe = await subscribeOBs().then(getOBs())
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

function pushToArray(arr, obj) {
  const index = arr.findIndex((e) => e.id === obj.id);

  if (index === -1) {
      arr.push(obj);
  } else {
      arr[index] = obj;
  }
}

function difference(arr1, arr2) {

  return arr2.filter(x => !arr1.includes(x));

}
 
function symbolTriplet (symbol) {

  let sub = symbol.substring(4) 
  let p1 = symbol,
      p2 = symbol.replace(sub,"BTC"),
      p3 = "tETHBTC";

  return triArray.push([p1,p2,p3]);
  
}

async function wsTriplet (val) {

  val = bfx.ws(2)
  console.log("websocket instance created for %s", val)
  return wsArray.push(val)
  
}

function indexOfdifference (arr, arr2,val) {
  
}


async function subscribeOBs () {
  
  let counter = 0
  tpairs = rv2.ethbtcpairs
  
  return new Promise ( (resolve, reject) => {
  
    tpairs.forEach ( async (pair) => {

      let sub = pair.substring(4)

      let subscribe = ws.subscribeOrderBook(pair)

      if(subscribe.err) {

        console.log(err);
        return reject(err)

      } else {

        console.log(`subscribed to ${pair} on socket ${Math.abs(CRC.str(pair))}`);
        symbolOB[pair] = {bids:[[]], asks:[[]], midprice:{}, lastmidprice:{}}
        arbTrades[pair] = {p1:{}, p2:{}, p3:{}, minAmount:{}}  
        counter++
      }
    }); 
  console.log(chalk.green("--DONE--"))
  console.log("Subscribed to %d out of %d", counter, tpairs.length)
  return true
  })
}

// 'ob' is a full OrderBook instance, with sorted arrays 'bids' & 'asks'  
async function getOBs() {

    tpairs.forEach( async (symbol) => {

      ws.onOrderBook({ symbol:symbol, precision:"P0"}, async (update, cbGID) => {

        let bids = update.bids;
        let asks = update.asks;

        ////console.log(symbol,cbGID.chanId)

        if (bids.length !== 0) {

          let currentBids = [symbolOB[symbol]['bids']] // get bid snapshot from symbolOB to compare with
          let difference = bids.filter(x => !currentBids.includes(x)); //Find difference in symbolOB and update

            if (currentBids[0].length == 1) {
              //Fill empty array first
              let i;
              //console.log(chalk.bold(symbol), currentBids[0].length, difference.length)
              //console.log(currentBids[0],difference)
              //console.log(chalk.bold(symbol), "updating from difference", currentBids[0].length,"->",difference.length)
              for ( i in difference ) {

                  symbolOB[symbol]['bids'][i] = difference[i]

              }
              //console.log(chalk.bold(symbol), symbolOB[symbol]['bids'].length, symbolOB[symbol].bids[0][0], symbolOB[symbol].bids[1][0],symbolOB[symbol].bids[2][0])
              //console.log("---")
            }
            
            ////console.log(chalk.yellow("finished filling symbolOB."))

            if (currentBids[0].length !== 1) {

              //console.log(chalk.bold(symbol), currentBids[0].length, bids.length, difference.length)
              
              if(difference) {
                for (let i in difference) {

                  let index = Math.min(difference[i][0],currentBids[0][0][0])

                  ////console.log(`replacing symbolOB[${symbol}]['bids'][${index}] with difference[${i}]: ${symbolOB[symbol]['bids'][index]} -> ${difference[i]} `)  
                  symbolOB[symbol]['bids'][index] = difference[i] 

                }

                
              }
                let sub = symbol.substring(4);
                let p1 = symbol, p2;

                if (sub == "ETH") {
                  p2 = symbol.replace(sub, "BTC")
                  arbCalc(p1,p2)
                } else if (sub == "BTC") {
                  p2 = symbol.replace(sub, "ETH")
                  arbCalc(p2,p1) 
                }
        
          }
        
        }

        
        if (asks.length !== 0) {

          let currentAsks = [symbolOB[symbol]['asks']] // get bid snapshot from symbolOB to compare with
          let difference = asks.filter(x => !currentAsks.includes(x)); //Find difference in symbolOB and update

            if (currentAsks[0].length == 1) {
              //Fill empty array first
              let i;
              //console.log(chalk.bold(symbol), currentAsks[0].length, difference.length)
              //console.log(currentAsks[0],difference)
              //console.log(chalk.bold(symbol), "updating from difference", currentAsks[0].length,"->",difference.length)
              for ( i in difference ) {

                  symbolOB[symbol]['asks'][i] = difference[i]

              }
              //console.log(chalk.bold(symbol), symbolOB[symbol]['asks'].length, symbolOB[symbol].asks[0][0], symbolOB[symbol].asks[1][0],symbolOB[symbol].asks[2][0])
              //console.log("---")
            }
            
            ////console.log(chalk.yellow("finished filling symbolOB."))

            if (currentAsks[0].length !== 1) {

              //console.log(chalk.bold(symbol), currentAsks[0].length, asks.length, difference.length)
              
              if(difference) {
                for (let i in difference) {

                  let index = Math.min(difference[i][0],currentAsks[0][0][0])

                  ////console.log(`replacing symbolOB[${symbol}]['asks'][${index}] with difference[${i}]: ${symbolOB[symbol]['asks'][index]} -> ${difference[i]} `)  
                  symbolOB[symbol]['asks'][index] = difference[i] 

                }

                
              }
                let sub = symbol.substring(4);
                let p1 = symbol, p2;

                if (sub == "ETH") {
                  p2 = symbol.replace(sub, "BTC")
                  arbCalc(p1,p2)
                } else if (sub == "BTC") {
                  p2 = symbol.replace(sub, "ETH")
                  arbCalc(p2,p1) 
                }
        
          }
        
        }

        
      })

    })

  console.log(chalk.bold("DONE"))
  
}

let arbCalc = async function (p1,p2) {

  let p3 = 'tETHBTC'
  
  try{
    
    let pair1ask = symbolOB[p1].asks[0]
    let pair2bid = symbolOB[p2].bids[0]
    let pair3ask = symbolOB[p3].asks[0] //Pair constraint

    //console.log('PAIR1ASK:', pair1ask, symbolOB[p1], 'PAIR2BID:', pair2bid, symbolOB[p2])
    
    let profit = 0.0 //percentage of profit required to trigger,  
    let crossrate = ((1/pair1ask[0]) * pair2bid[0]) / pair3ask[0] 
    let perc = 1 - crossrate

    let minAmount = Math.min((pair1ask[2])*-1,(pair2bid[2]))
    let minETHAmount = (pair3ask[2]/pair1ask[0])

    let symbols_string = String(p1) + ' > ' + String(p2) + ' > ' + String(p3) + ' | '
    let alt_amount = String(arbTrades[p1]['minAmount']*-1) + ' ' + (minETHAmount*-1).toFixed(3)
    let bidask_string = String(pair1ask[0]) + ' ' + String(pair2bid[0]) + ' ' + chalk.bold(String(pair3ask[0]))
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
        console.log(symbols_string.green, chalk.bold(alt_amount), '(' , pair3ask[2]*-1 ,'ETH )' , '->',bidask_string, chalk.magenta('crossrate:'), chalk.red.bold(crossrate_string))
      }  
  }
  catch(err) {
    let errmsg = err.message
    let errarr 
    symbolOB[p1]['asks'] == undefined ? errarr = p1 : errarr = p2
    console.log(chalk.red.bold(errarr), errmsg.red, symbolOB[p1], symbolOB[p2], err)
  }
}

log("Finished!".green)//Finished symbolOB loop

ws.open()