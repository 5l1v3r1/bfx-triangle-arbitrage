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
 
function symbolTriplet (symbol) {

  let sub = symbol.substring(4) 
  let p1 = symbol,
      p2 = symbol.replace(sub,"BTC"),
      p3 = "tETHBTC";

  return triArray.push([p1,p2,p3]);
  
}

var compare = function(array1, array2) {
  // if the other array is a falsy value, return
  if (!array2)
    return false;

  // compare leng ths - can save a lot of time
  if (array1.length != array2.length)
    return false;

  for (var i = 0; i < array1.length; i++) {
    // Check if we have nested arrays
    if (array1[i] instanceof Array && array2[i] instanceof Array) {
      // recurse into the nested arrays
      if (!compare(array1[i], array2[i]))
        return false;
    } else if (array1[i] != array2[i]) {
      // Warning - two different object instances will never be equal: {x:20} != {x:20}
      return false;
    }
  }
  return true;
}

async function wsTriplet (val) {

  val = bfx.ws(2)
  console.log("websocket instance created for %s", val)
  return wsArray.push(val)
  
}

function obUpdate (symbol,update,bidask) {

  let currentOB = [symbolOB[symbol][bidask]]  //get bid snapshot from symbolOB to compare with
  var difference =  update.filter(x => !currentOB.includes(x)); //Find difference in symbolOB and update
  
  try {
  if (update.length !== 0 ) {

    //currentOB length == 1, means empty array [], so fill with loop
    if (currentOB[0].length == 1) {

      //Populate symbolOB initially.
      for (let i = 0; i <= difference.length -1; i++) {

        if (difference[i][1] !== '0') {
          console.log(symbol, "loop", i, difference[i])
          symbolOB[symbol][bidask][i] = difference[i]
          //console.log(symbol, i, symbolOB[symbol][bidask][i], "<-",difference[i])
        }
      }
      console.log(symbol, "Initial elements added.")
      
    }

    //if not empty, replace/remove existing values with updates
    else if (currentOB[0].length > 1) {
      
      console.log(symbol, "currentOB Length:", currentOB[0].length, currentOB[0][currentOB[0].length-1], " update Length:", update.length, update[0])

      for (let k in update) {

        //Check if currentOB contains an update with same price
        if (currentOB[0][k].includes(update[k][0])) {

          console.log(`${symbol} currentOB[0][${k}] includes ${update[k][0]} -> ${currentOB[0][k]} - ${update[k]}`)
          let index = symbolOB[symbol][bidask].indexOf(currentOB[0][k]) 

          // Check if update is '0' order, remove from array.
          if (update[k][1] == '0') {

            console.log(`${symbol} removing ${symbolOB[symbol][bidask][index]} [${index}] from orderbook.`)
            symbolOB[symbol][bidask].splice(index,1) // remove order from symbolOB
            console.log(`index [${index}] is now ${symbolOB[symbol][bidask][index]}`)
            update.splice(k, 1) // remove '0' order from update as well
            currentOB = [symbolOB[symbol][bidask]] // update currentOB
            difference = update.filter(x => !currentOB.includes(x)) // update difference to remove elements already used to update
            
          } 

          // else, check if amounts are different and replace with new
          else if (currentOB[0][k][2] !== update[k][2]) {
            
            console.log(`${symbol} Amount change, ${currentOB[0][k][2]} -> ${update[k][2]}`)
            symbolOB[symbol][bidask][index] = update[k]
            currentOB = [symbolOB[symbol][bidask]] // update currentOB
            update.splice(k, 1) // remove order from update as well
            difference = update.filter(x => !currentOB.includes(x)) // update difference to remove elements already used to update

          }

        } else {
          
          if (update[k][1] == '0') {
            console.log(symbol,"Useless '0' order. Ignoring")
            update.splice(k,1) //remove unecessary '0' order
            difference = update.filter(x => !currentOB.includes(x)) // update difference to remove elements already used to update

          } else {

            let symOBLen;
            let test = currentOB.includes(update[k][0])

            console.log(symbol, "currentOB does not include", update[k], test)
            console.log(symbol, "pushing", update[k], "into symOB, then timsort")
            
            symbolOB[symbol][bidask].push(update[k])
            symOBLen = symbolOB[symbol][bidask].length;
            
            if (bidask == 'ask') {
              symbolOB[symbol][bidask].TimSort.sort(function(a, b){return a-b})
            } else if (bidask == 'bid') {
              symbolOB[symbol][bidask].TimSort.sort(function(a, b){return b-a}) 
            }
            console.log(`${symbol} timsort ${bidask} - Index of [ ${chalk.yellow(update[k])} ] is now [${symbolOB[symbol][bidask].indexOf(update[k])}/${symOBLen-1}]`)
            console.log(symbol, bidask,symbolOB[symbol][bidask][0], symbolOB[symbol][bidask][1],symbolOB[symbol][bidask][2])
          }
        }
      }  
    }

    console.log("-------------")
    
    /*      Final checks      */
    // add promise to execute arbcalc after update sorting??

    if (typeof currentOB[0][0] !== 'undefined') {
              
      let sub = symbol.substring(4);
      let p1 = symbol, p2;
      
      if (sub == "ETH") {
        
        p2 = symbol.replace(sub, "BTC")
        arbCalc(p1,p2)
      
      } 
      
      if (sub == "BTC" && symbol !== "tETHBTC") {
        
        p2 = symbol.replace(sub, "ETH")
        arbCalc(p2,p1) 
      
      }              
    }
  } 
} catch(err) {
  console.log(symbol, err)
}


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
        
        if(pair.substring(4) == 'ETH') {
          arbTrades[pair] = {p1:{}, p2:{}, p3:{}, minAmount:{}, crossrate:{}}  
        }
        
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

      ws.onOrderBook({ symbol:symbol, precision:"P0"}, (update, cbGID) => {

        let bids = update.bids;
        let asks = update.asks;

        // add parallel await for symbol triangle. 
        // call arbCalc here?
        obUpdate(symbol, bids,'bids')
        obUpdate(symbol, asks,'asks')

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
    let alt_amount = String(arbTrades[p1]['minAmount']) + ' ' + (minETHAmount).toFixed(3)
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
    arbTrades[p1]['p1'] = pair1ask 
    arbTrades[p1]['p2'] = pair2bid
    arbTrades[p1]['p3'] = pair3ask
    arbTrades[p1]['minAmount'] = minAmount
    arbTrades[p1]['crossrate'] = crossrate
    
    if (crossrate >= (1 + profit)) {
        console.log(symbols_string.green, chalk.bold(alt_amount) , '(' , pair3ask[2]*-1 ,'ETH )' ,'->',bidask_string, chalk.magenta('crossrate:'), chalk.bold.yellow(crossrate_string))
      }
    else {
        console.log(symbols_string.green, chalk.bold(alt_amount), '(' , pair3ask[2]*-1 ,'ETH )' , '->',bidask_string, chalk.magenta('crossrate:'), chalk.red.bold(crossrate_string))
        //console.log(symbolOB[p3])
      }  
  }
  catch(err) {
    let errmsg = err.message
    let errarr 
    console.log(p1,p2)
    //symbolOB[p1]['asks'] == undefined ? errarr = p1 : errarr = p2
    console.log(chalk.red.bold(errarr), errmsg.red, err)
  }
}

log("Finished!".green)//Finished symbolOB loop

ws.open()

module.exports.symbolOB = symbolOB;
module.exports.arbTrades = arbTrades; 
module.exports.triArray = triArray;