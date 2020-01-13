'use strict'

//process.env.DEBUG = '*'
const dotenv = require('dotenv').config()
const debug = require('debug')('triangle-arbitrage')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const symbolDetails = require('./util/symbol_details')
const BFX = require('bitfinex-api-node')
const { Order } = require('bfx-api-node-models')
const { OrderBook } = require('bfx-api-node-models')
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')
const BFX_SETUP = require('./util/BFX_SETUP')
const path = require('path');
const CRC = require('crc-32')
const log = require ('ololog').noLocate;
const ansi = require ('ansicolor').nice;
const style = require ('ansi-styles');
const chalk = require ('chalk');
const TimSort = require('timsort');
var fs = require('fs');
var api_obj = require('./apikeys.json');
const { EventEmitter } = require('events') //Internal Events

// ! websocket instance from BFX SETUP, change instance with arg
const ws = BFX_SETUP.BFX_INSTANCES[process.argv[2]];

var stream = fs.createWriteStream(path.join(__dirname,'/log/arbOpp_data.txt'), {flags: 'a'}); // ? Data stream
var errlog = fs.createWriteStream(path.join(__dirname,"/log/ws_errors.txt"), {flags: 'a'}); // ? Websocket error logging
var teststream = fs.createWriteStream(path.join(__dirname,'/log/arbOpp_test.txt'), {flags: 'a'})

//var api_stream = fs.createWriteStream(path.join(__dirname,'/apikeys.json'));
var API_KEY = api_obj.test.api_key;
var API_SECRET = api_obj.test.api_secret;

// Pair Arrays
var tpairs = [];   // ? "tETHBTC"
var symbolOB = []; // ? {bids:[], asks:[], midprice:[], lastmidprice:[]}
var arbTrades = {}; // ? {p1:[], p2:[], p3:[], minAmount:[]}
var balances = [];
var triArray = [];
var wsArray = [];
var sockets = [];
var orderArr = []; 
var alts = [];
var mainpair = process.argv[3].toUpperCase();
mainpair = String("t" + mainpair)
var mainpair_array = rv2.mainpairs
var symdetailarr = [];
var error_counts = [];

const eventEmitter = new EventEmitter(); // ? Internal Events i.e arbCalc emit arbOpp

/**
 * 
 * 
 *  Process Arguments
 * 
 *  OLD-TODO: Add argument definitions
 * ? disable verbose mode (logging of errors): [ -v ] (on by defualt)
 * ? asdasdasdasd
 * 
 * 
 */




/** 
 * 
 *  Event emitters
 * 
 *  ? ws - bitfinex-api-node ws2 manager.
 *  ? eventEmitter - internal event manager for triangle-arbitrage.
 * 
 *  Will try to develop more along this event driven approach.
 *  OLD-TODO: Write documentation on internal eventEmitter.
 *  OLD-TODO: Add console input if apikeys.json is empty. (Make internal listener) 
 *  OLD-TODO: Handle cancelled orders in eventEmitter. (orderCancelled)
 * 
 **/

/* ws listeners - bfx-api-node */

var errcounter = 0;

ws.on('error', (err) => {
  if (process.argv[4] !== '-v') {
    if(err.code == 10305) {
      errcounter++;
      console.error(`${err.event} ${errcounter}: ${err.code} "${err.pair}" "${err.msg}"`)
    }
    if(!err.message) {
      console.error(`${err.event}: ${err.code} "${err.pair}" "${err.msg}"`); 
      errlog.write(`${err.event}: ${err.code} "${err.pair}" "${err.msg}" \n`);
    }
    else console.error('error: %s', err)
  }
})

ws.onMessage('', (msg) => {

})

ws.on('open', () => {
  console.log('open')
  console.log(`API key: ${chalk.yellow(API_KEY)} `);
  console.log(`API secret: ${chalk.yellow(API_SECRET)} `);
  let pair = "tUSDBTC";
  //pair.concat(String(mainpair))
  MainPair(mainpair);
  ws.auth()
})

ws.once('auth', async () => {
  console.time('ws.once - auth');  
  console.log('authenticated');
  getBal().then(subscribeOBs()).then(getOBLoop());
  console.timeEnd('ws.once - auth');
})

ws.onWalletSnapshot('', (bal) => { 
  var amount_currencies = bal.length;
  if (amount_currencies > 0) eventEmitter.emit('pulledBal', bal);
  console.log(`\n${chalk.green('Balances Snapshot')} ${Date.now()}`)
  console.log(`${amount_currencies} currencies`)

  for(var i = 0; i<amount_currencies; i++) { 
    balances[i] = bal[i]; 
    console.log( bal[i]['currency'].green, bal[i]['type'], chalk.yellow(bal[i]['balance']));
  }
  console.log('\n')
  getBal();
}) 

/** eventEmitter listeners - internal */

eventEmitter.on('closed', function(symbol,opptime) {
  let alt = symbol.substring(0,4);
  arbTrades[alt]['stime'] = '';
  console.log(chalk.yellow(`${symbol} Opportunity closed. Lasted ${opptime/1000} seconds`));
})

// OLD-TODO: Handle closed orders here
eventEmitter.on('orderclosed', (response) =>{
  let orderno = response.orderno, alt = response.alt;
  
  // ? Record end time
  orderArr[alt][orderno].endtime = Date.now();

  if(orderno == 0) {
    orderArr[alt][1].submit()
    orderArr[alt][1].starttime = Date.now();
  }

  if(orderno == 1) {
    orderArr[alt][2].submit()
    orderArr[alt][2].starttime = Date.now();
  }  

  // ? if last order has closed, reset inProgress
  if(orderno == 2) {
    orderArr[alt].inProgress = false;
  }
  
  // ? reset closed values
  if(!orderArr[alt].inProgress) 
    for(var i = 0; i < 3; i++)
      orderArr[alt][i].closed = false;

})

// ? Arbitrage Opportunity listener
eventEmitter.on('ArbOpp', async (emobj) => {
  let alt = emobj.alt, crossrate = emobj.crossrate;
  let base = alt + mainpair.substring(1,4),
      quote = alt + mainpair.substring(4); 
  
  let isStaging = true; // ! Set to true for stagin
      
  let initialBaseBal = balances[0].balance, finalBaseBal; // OLD-TODO: Track change in balance
  let tradingAltAmount = 0.02; // OLD-TODO: Enable chosen trading amount
  
  // ! Check amount equations again
  let TYPE = Order.type.EXCHANGE_LIMIT;
  let AMOUNT = setAmounts(alt); // Return amount in alt
  console.log(arbTrades[alt].p3, AMOUNT);
  let ASKAMOUNT = Math.abs(AMOUNT) * -1; // Amount of ALT to buy (negative)
  let BUYAMOUNT = AMOUNT * arbTrades[alt].p2[0] ; // Amount of ALT to sell (for BTC)
  let ALTAMOUNT = -( ((BUYAMOUNT/arbTrades[alt].p1[0]) * arbTrades[alt].p2[0]) / arbTrades[alt].p3[0] ); // Amount of MAINPAIR to buy (negative), will be more than original amount.
  let PROFITAMOUNT = Math.abs(((AMOUNT*arbTrades[alt].p1[0])*crossrate)-(AMOUNT*arbTrades[alt].p1[0])); // Amount of profit in ALT
  console.log(`${alt} ASKAMOUNT: ${ASKAMOUNT} BUYAMOUNT: ${BUYAMOUNT} ALTAMOUNT: ${ALTAMOUNT}`)
  console.log(`${('Profit amount:')} ${chalk.yellow(PROFITAMOUNT.toFixed(8))} ${chalk.yellow(alt.substring(1))}\n`)
  
  /** 
   * ? Initialize orderArr, 3 orders
   * ! make sure ask amounts are negative 
   * ! ADD FEES TO AMOUNTS
  */

 const testorder = new Order({
  cid: Date.now(),
  symbol: 'tETHEUR',
  price: 170.00,
  amount: -0.02,
  type: Order.type.EXCHANGE_LIMIT
  }, ws)

  if(!orderArr[alt].inProgress) {
    var order1, order2, order3;
    var orders_formed = new Promise ((resolve, reject) => {
      try{
        var datecid = Date.now();
        order1 = new Order({ cid: alt+datecid+"_1", symbol: base, price: arbTrades[alt].p1[0], amount: ASKAMOUNT, type: Order.type.EXCHANGE_LIMIT}, ws)
        order2 = new Order({ cid: alt+datecid+"_2", symbol: quote, price: arbTrades[alt].p2[0], amount: BUYAMOUNT, type: Order.type.EXCHANGE_LIMIT}, ws)
        order3 = new Order({ cid: alt+datecid+"_3", symbol: mainpair, price: arbTrades[alt].p3[0], amount: ALTAMOUNT, type: Order.type.EXCHANGE_LIMIT}, ws)
        orderArr[alt][0] = order1;
        orderArr[alt][1] = order2;
        orderArr[alt][2] = order3;
        console.log(`${alt} orderArr - ${orderArr[alt][0]}`)
        teststream.write(`[${Date.now()}]\n[\n ${order1.toString()}\n ${order2.toString()}\n ${order3.toString()}\n]`)
        resolve(`${alt} Orders formed`);
      } 
      catch(err) {
        reject(err);
      }
    })
  }

  if(isStaging) {
    if(tradingAltAmount !== 0 && balances[0].balance > 0) {
      var startTime = Date.now();
      if (orders_formed && !orderArr[alt].inProgress)   
        try {
          // ? Setup order listeners then send first order
          orderListeners(alt);
          orderArr[alt][0].submit();
          orderArr[alt].inProgress = true;
        }
        catch(err) {
          console.error(`${alt} orders_sent error ${err}`)
        } 
        // OLD-TODO: add timer for ordersSent
        //var endTime = Date.now();
        //console.log(`${value} took ${(endTime-startTime)/1000} seconds`);
        getBal();

      }
    else {
      console.log(`${alt} Insufficient balance. Trading Balance: ${tradingAltAmount} Minimum Balance: ${arbTrades[alt].minAmount}`)
    }
  }
})

// ! Use this to close all orders
eventEmitter.on('cancel_orders', (alt) => {
  for(var i = 0; i <= orderArr[alt].length; i++) { 
   orderArr[alt].cancel()
   .then( function() {
     console.log(`${alt} Orders cancelled ${Date.now()}`);
   });
  }
})

eventEmitter.on('mainpair', (selectedpair) => {
  mainpair = selectedpair;
})

/* functions */

function MainPair (mainpair) {
  switch(mainpair) {
    case 'tETHBTC': tpairs = rv2.ethbtc_pairs; break;
    case 'tBTCUSD': tpairs = rv2.btcusd_pairs; break;
    case 'tBTCEUR': tpairs = rv2.btceur_pairs; break;
    case 'tETHEUR': tpairs = rv2.etheur_pairs; break;
    case 'tBTCGBP': tpairs = rv2.btcgbp_pairs; break;
    case 'tETHGBP': tpairs = rv2.ethgbp_pairs; break;
    case 'tBTCJPY': tpairs = rv2.btcjpy_pairs; break;
    case 'tETHJPY': tpairs = rv2.ethjpy_pairs; break;
  }
}

async function getBal () {
  module.exports.balances = balances;
  return balances;
}

function getOBLoop () {
  console.time("getOBLoop - forEach")
  console.log(`Getting OrderBooks: tpairs ${tpairs.length}`)
  tpairs.forEach( async (symbol) => { 

    getOBs(symbol);

  })
  console.timeEnd("getOBLoop - forEach")
}

function subscribeOBs () {
  
  let counter = 0
  tpairs.push(mainpair)
  tpairs = tpairs.slice(-61); // ! change to number under limit MUST BE INCLUSIVE TO SYMBOL PAIRINGS
  console.log(`tpairs length = ${tpairs.length}`)
  //console.log('SYMBOL DETAILS ARRAY',symbols_details_array)
  
  return new Promise ( (resolve, reject) => {
    
    console.time("subscribeOBs - tpairs.forEach");
    tpairs.forEach ( (pair) => {

      let pre = pair.substring(0,4); //prestring e.g "tOMG"
      let suf = pair.substring(4); // suffix e.g "ETH"
      ws.send({ event: 'conf', flags: 131072 }) // Checksum flag
      ws.subscribeOrderBook(pair) 

      try {

        console.log(`subscribed to ${pair} on socket ${Math.abs(CRC.str(pair))}`);
        
        if(suf == mainpair.substring(4) && pair !== mainpair) {
          let basepair = mainpair.substring(0,4), quotepair = mainpair.substring(0,4);
          let pair1 = pre + basepair;
          let pair2 = pre + quotepair;

          // Group symbolOB into altcoin objects (symbolOB["tOMG"]) with eth & btc pairs nested
          if(typeof symbolOB[pre] == 'undefined') {
            symbolOB[pre] = {};
            symbolOB[pre]['crossrate'] = -1;
            symbolOB[pre]['maxAmount'] = 0;
            symbolOB[pre]['lastCs'] = -1;
          }

          // ? arbTrades init
          if(typeof arbTrades[pre] == 'undefined')
            arbTrades[pre] = {p1:"", p2:"", minAmount:"", crossrate:""};
          
          // ? orderArr init
          if(typeof orderArr[pre] == 'undefined') {
            orderArr[pre] = []; 
            orderArr[pre]['inProgress'] = false;
            for(var i = 0; i < 3; i++) {
              orderArr[pre][i] = [];
              orderArr[pre][i]['closed'] = false;
              orderArr[pre][i]['starttime'] = -1;
              orderArr[pre][i]['endtime'] = -1;
            }
          }
          alts.push(pre);
        } 

        if (pair == mainpair) {
          let basepair = mainpair.substring(0,4)
          symbolOB[basepair] = {};
          console.log("Created mainpair symOB", basepair,symbolOB[basepair])
        }
        counter++
      }
      catch(err) {
        console.error(err);
        return reject(err)
      }
    }); 
  alts.push(mainpair);
  console.timeEnd("subscribeOBs - tpairs.forEach");
  console.log(chalk.green("--DONE--"))
  console.log("Subscribed to %d out of %d", counter, tpairs.length)
  module.exports.tpairs = tpairs;
  module.exports.alts = alts;
  return true
  
  })
}

function reSubscribe(symbol, alt) {

  return new Promise((resolve,reject) => {

  symbolOB[alt][symbol]['bids'] = [];
  symbolOB[alt][symbol]['asks'] = [];
  
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
  let basepair = mainpair.substring(1,4), quotepair = mainpair.substring(4);
  let altID = alt.concat('ID')
  let PRECISION = "P0"
  let resub_trigger = 10;
  let checksumcount = []
  checksumcount[symbol] = 0;
  //Use events
  let arbCalcReady = function() {
    if(symbolOB[alt][alt.concat(basepair)] && symbolOB[alt][alt.concat(quotepair)] && symbolOB[String("t"+basepair)][mainpair]) { 
        if((symbolOB[alt][alt.concat(basepair)].asks || symbolOB[alt][alt.concat(quotepair)].bids) && symbolOB[String("t"+basepair)][mainpair].asks) {
          if (alt !== basepair) {
            arbCalc(alt);
          }
        }
      }
    }

  ws.onOrderBook({ symbol:symbol, precision:PRECISION, cbGID: altID}, (ob) => { 
    // check if symbolOB has not initialized OrderBook objects for pairs
    if (ob.bids.length !== 0 && ob.asks.length !== 0) {
      symbolOB[alt][symbol] = ob; //Do I need this?
      //if(symbol == mainpair) console.log("OB CHECK", symbolOB[alt], symbolOB[alt][mainpair])
      eventEmitter.emit('ob', { symbol: symbol, bids: ob.bids, asks: ob.asks });
    
    }
    if(ws._orderBooks[symbol].length !== 0) {
      if(ws._orderBooks[symbol]["csVerified"]) {
        arbCalcReady()
      } else {

        checksumcount[symbol]++;

        if(checksumcount[symbol] >= resub_trigger) {
          
          //Use reSubscribe function?
          let unsub = ws.unsubscribeOrderBook(symbol);
          console.log(`Unsubscribed from ${symbol}`)
          
          if(unsub) {
            
            ws.subscribeOrderBook(symbol);
            console.log(`Resubscribed to ${symbol}`);  
            checksumcount[symbol] = 0;
          
          }
        
        }
      
      } 
    
    }
    
  }) 

  console.log(chalk.bold("fetching orderbook for" ,symbol))
  
}

//make EventEmitter, use listeners to detect arbOpp -> .on(arbOpp) subscribeTrades -> make orders???

let arbCalc = async function (alt) {

  let mpPre = mainpair.substring(0,4),
      basepair = mainpair.substring(1,4), 
      quotepair = mainpair.substring(4);
  let ob1 = symbolOB[alt][alt.concat(basepair)], 
      ob2 = symbolOB[alt][alt.concat(quotepair)], 
      ob3 = symbolOB[mpPre][mainpair];
  
  try{
    
    /**
     * ? Pair ask/bid structure:
     * ? [ price, number of orders, amount ]
     */
    
    let pair1ask = ob1.asks[0] //symbolOB.tOMG.tOMGETH.asks[0]
    let pair2bid = ob2.bids[0] //symbolOB.tOMG.tOMGb.bids[0]
    let pair3ask = ob3.asks[0] //Pair constraint

    //console.log('PAIR1ASK:', pair1ask, symbolOB[alt], 'PAIR2BID:', pair2bid, symbolOB[p2])
    
    let profit = 0.0 //percentage of profit required to trigger,  
    let crossrate = ((1/pair1ask[0]) * pair2bid[0]) / pair3ask[0] 
    let perc = 1 - crossrate

    let minAmount = Math.min((pair1ask[2])*-1,(pair2bid[2]))
    let minBaseAmount = (pair3ask[2]/pair1ask[0])

    let symbols_string = String(alt) + basepair +' > ' + String(alt) + quotepair + ' > ' + String(mainpair) + ' | '
    let alt_amount = String(arbTrades[alt]['minAmount']) + ' ' + (minBaseAmount).toFixed(3)
    let bidask_string = String(pair1ask[0]) + ' ' + String(pair2bid[0]) + ' ' + chalk.bold(String(pair3ask[0]))
    let crossrate_string = crossrate.toFixed(8).toString()
    
    let makerFee = 0.1;
    let takerFee = 0.2;
    
    if (minBaseAmount*-1 < minAmount*1) minAmount = minBaseAmount; // ask amounts are negative  
    else minAmount = minAmount;
      
    let nowms = Date.now();
    let timer, endtimer; //console timers
    let begindate, enddate; //Date.now() timestamps

    if (crossrate >= (1 + profit)) {
      
      console.log(`${symbols_string.green} ${chalk.bold(alt_amount)} ( ${pair3ask[2]*-1} ${basepair} ) -> ${bidask_string} ${chalk.magenta('crossrate:')} ${chalk.yellow.bold(crossrate_string)}`,new Date())
     
      // arbTrade array {}
      arbTrades[alt]['p1'] = pair1ask; 
      arbTrades[alt]['p2'] = pair2bid;
      arbTrades[alt]['p3'] = pair3ask; //make independent entry, make its own function to keep track of mainpair
      arbTrades[alt]['minAmount'] = minAmount;
      
      let emobj = new Object({alt,crossrate});
      eventEmitter.emit('ArbOpp', emobj)  
      
      if(crossrate !== arbTrades[alt].crossrate) {

        if(typeof begindate == 'undefined') { 
          begindate = Date.now(); //Opportunity open time
          arbTrades[alt]['stime'] = begindate;
        
        }
      }
    }
    else {
      if(typeof timer !== 'undefined'){ 
        endtimerr = console.timeEnd(alt); 
        console.log(`${alt} lasted ${endtimer}`)
      }
      if(crossrate !== arbTrades[alt].crossrate) 
       console.log(`${symbols_string.green} ${chalk.bold(alt_amount)} ( ${pair3ask[2]*-1} ${basepair} ) -> ${bidask_string} ${chalk.magenta('crossrate:')} ${chalk.red.bold(crossrate_string)}`,new Date())
            
      //Check if opp has closed
      if(arbTrades[alt].crossrate >= 1) {
        if(crossrate < arbTrades[alt].crossrate) {
          enddate = Date.now();
          let opptime = Math.abs(enddate - arbTrades[alt]['stime']);
          eventEmitter.emit('closed', alt, opptime);
          stream.write(`[${Date.now()}] ${alt} Profit: ${(arbTrades[alt].crossrate-1)*100}% Amount: ${arbTrades[alt].minAmount} p1: [${arbTrades[alt].p1}] p2: [${arbTrades[alt].p2}] p3: [${arbTrades[alt].p3}] - Open for ${(opptime/1000)} secs (${opptime}ms)\n`)  
        }
      }
      
      // arbTrade array {}
      arbTrades[alt]['p1'] = pair1ask; 
      arbTrades[alt]['p2'] = pair2bid;
      arbTrades[alt]['p3'] = pair3ask; //make independent entry, make its own function to keep track of mainpair
      arbTrades[alt]['minAmount'] = minAmount;
      arbTrades[alt]['crossrate'] = crossrate;
    }
  }
  catch(err) {
    let errmsg = err.message 
    //symbolOB[alt]['asks'] == undefined ? errarr = alt : errarr = p2
    console.error(alt, err)
  }
}

// ? create orderArr listeners
function orderListeners(alt_) {
  orderArr[alt_].inProgress == true;


  for(let i = 0; i < 3; i++) {
    let alt = alt_;
    let currentOrder = orderArr[alt][i]; // pull current order from orderArr
    
    currentOrder.on('error', (err) => {
      console.log(err);
      currentOrder.cancel();
    })

    currentOrder.registerListeners() // Make separate ws instance to handle order response?
    console.log(`${alt} Registered listeners for order ${i}`)

    currentOrder.on('update', () => {
      console.log(' %s order updated: %j',alt, currentOrder.serialize())
    })
    
    // ? Send next order from this
    currentOrder.on('close', () => {
      console.log(' %s order closed: %s',alt, currentOrder.status)
      currentOrder['closed'] = true;
      eventEmitter.emit('orderclosed', {alt: alt, orderno: i});
      return Promise.resolve(`${alt} Order ${i} closed.`);
    })

    currentOrder.on('cancelled', () => {
      console.error(' %s order cancelled: %s',alt, currentOrder.status)
      currentOrder.closed = false;
      return Promise.reject(`${alt} Order ${i} cancelled.`);
    })

    orderArr[alt][i] = currentOrder; // Reassign to array
  }
}

function sendOrder(alt,o) {
  return new Promise ( async (res, rej) => {
    let closed = false
    // Enable automatic updates
    try {
    console.log(' %s submitting order %s',alt, o.cid)
    
    o.submit().then(function() {
      console.log(' %s got submit confirmation for order %s [%s]',alt, o.cid, o.id)
      // wait a bit...
        setTimeout(() => {
          if (closed) return res(Promise.resolve('Order Closed'));

          console.log(' %s canceling order %s...',alt)

          o.cancel().then(() => {
            console.log(' %s got cancel confirmation for order %s',alt, o.cid)
            return rej(Promise.reject('Order cancelled'));
            //ws.close()
          }).catch((err) => {
            console.log(' %s error cancelling order: %j',alt, err)
            return rej(err);
          })
        }, 2000)
      })
      .catch((err) => {
        console.log(alt,err)
        return rej(err);
      })

    }
    catch(err) {
      console.error(err)
      return rej(err)
    }
  })
}

function setAmounts(alt) { 
  let sym = String(alt);
  let minmax = symbolDetails.symbol_details_array;
  let minOrder = minmax[sym]["minimum_order_size"];
  let amount =  minOrder / arbTrades[alt].p1[0]
  console.log('SET AMOUNTS: ',minOrder, amount)
  return amount;  
}

function filterIt(arr, searchKey) {
  return arr.filter(obj => Object.keys(obj).some(key => obj[key].includes(searchKey)));
}

// Process functions
process.on('SIGINT', async function() {
  // ! send unsubscribe to pairs
  console.log('SIGINT - Doing clean-up.')

  console.log(`unsubscribing from pairs`.red)
  if(typeof tpairs !== 'undefined') {
    await tpairs.forEach((pair) => {
      var unsub = ws.unsubscribeOrderBook(pair);
      if(unsub) console.log(`unsubscribed from ${pair}`)
    })
  }
  console.log('Done.')
  process.exit();
});

console.log("Finished!".green)

ws.open()

// Organize these?
module.exports.symbolOB = symbolOB;
module.exports.arbTrades = arbTrades; 
module.exports.triArray = triArray;
module.exports.emitter = eventEmitter;