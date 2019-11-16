const dotenv = require('dotenv').config()
const debug = require('debug')('triangle-arbitrage')
const { EventEmitter } = require('events')

const BFX = require('bitfinex-api-node')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const { Order } = require('bfx-api-node-models')
const { OrderBook } = require('bfx-api-node-models') 
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')

const symbolDetails = require('./util/symbol_details')
const BFX_SETUP = require('./BFX_SETUP')

const path = require('path');
const CRC = require('crc-32');
const log = require ('ololog').noLocate;
const ansi = require ('ansicolor').nice;
const style = require ('ansi-styles');
const chalk = require ('chalk');
const fs = require('fs');
 
class Pair extends EventEmitter {

    /**
     * 
     * @description Pair instance.
     * @param {string} pair: 'tOMGETH'
     * @param {WSv2} ws - WSv2 Instance
     *
     *  
     */

    constructor(pair, ws) {
        super();
        this.pair = pair;
        this.ws = ws;
        this.orderbook_opts = { symbol:this.pair, precision:"P0" };
        this.ws.send({ event: 'conf', flags: 131072 }) // ? Checksum flag
        this.ws._manageOrderBooks = true;
        this.ws.subscribeOrderBook(this.pair);
        this._orderBookListener(); 
        this._setupSymbols();
        this.orderbook; 
        this.currentAsk; 
        this.currentBid; 
        this.maxAmount; 
    }

    _setupSymbols() {
        try {
            let mid = 4;
            if(this.pair.length > 7) {
                mid++;
                this.base = this.pair.substring(1,mid);
                this.quote = this.pair.substring(mid);
            }
            else {
                this.base = this.pair.substring(1,mid);
                this.quote = this.pair.substring(mid);
            }
        }
        catch(err) {
            console.log(err);
        }
    }

    /**
     * @description OrderBook Listener
     */
    _orderBookListener() {
        this.ws.onOrderBook( this.orderbook_opts, (ob) => {
            this.currentAsk = ob.asks[0];
            this.currentBid = ob.bids[0];
            
            this.emit('ob_update', {
                pair: this.pair,
                currentAsk: this.currentAsk,
                currentBid: this.currentBid,
                maxAmount: this.maxAmount
            })
        }) 

        // TODO: Refactor this like in triangle-arbitrage.js
        this.ws.onOrderBookChecksum(this.orderbook_opts, (ob) => {
            console.log(`${this.pair} - checksum ${ob}`)
        })
    }

    /**
     * @param {float} price
     * @param {float} amount  
     *  amount > 0, buying.
     *  amount < 0, selling.
     */
    makeOrder(price, amount) {
        return new Order ({
            cid: Date.now(),
            symbol: this.pair,
            price: price,
            amount: amount,
            type: Order.type.EXCHANGE_LIMIT
        }, this.ws)
    }

    /** 
     * @param {Order} order
     * @returns {Promise} p - resolves on submit notification.
     */
    _sendOrder(order) {
        return this.ws.submitOrder(order);
    }

}

class ArbitrageTriangle extends WSv2 {

    /**
     * Trianglular arbitrage instance. 
     * 
     * 
     * @description:
     * 
     * 1) Detects arbitrage opportunities.
     *      - Listens to orderbooks and calculates spread rate on each orderbook update.
     *      - If Arbitrage opp is found, start sending orders (two potential methods).
     *  
     * 2a) Uses an EventEmitter to send orders sequentially 
     *      ? wait for order submit -> Wait for order fullfill -> Move onto next Pair.
     *  
     * 2b) Could do 3 separate spread trades? Wouldn't have to wait for order fufillments.
     *      ? Submit all orders together -> Wait until all orders have been fufilled. 
     *
     *  Subscribes to at least one mainpair, has up to 60 extra subscriptions (total 61 per WSv2 instance). 
     *   
     * @param {Object} opts - Object containing WSv2 constructor params (See ws2.js)
     * @param {Pair} mainpair - e.g tBTCUSD, tETHBTC, tBTCEUR... 
     * @param {Pair[]} pairs - Object containing Pairs with the same base (alt) currency.  
     * 
     * 
     * 
     */
    constructor(opts) {
        super(); 
        this._manageOrderBooks = opts.manageOrderBooks === true;
        this._transform = opts.transform === true;
        this.open();
        this._pairs = {}; 
    }

    _setPairListeners() {
        for(let symbol in this._pairs) {
            this._pairs[symbol][0].on('ob_update', (order) => {
                if(order.pair.substring(1,4) == symbol) {
                    this._pairs[symbol].o1 = order;
                    this._calculateArbitrage(this._pairs[symbol]);
                }
            })
            this._pairs[symbol][1].on('ob_update', (order) => {
                if(order.pair.substring(1,4) == symbol) {
                    this._pairs[symbol].o2 = order;
                    this._calculateArbitrage(this._pairs[symbol]);
                }
            })
        }
    }
    // BUG: Fix obj orders assigning to other symbol
    _calculateArbitrage(obj) {
        if(obj.hasOwnProperty('o1') && obj.hasOwnProperty('o2')) {
            if(obj.o1.pair == 'tOMGETH' && obj.o2.pair == 'tREPBTC' || obj.o1.pair == 'tREPETH' && obj.o2.pair == 'tOMGBTC') {
                console.log(obj)
            }
            ////for-each loop through _pairs
            if(typeof obj.o1 !== 'undefined' && typeof obj.o2 !== 'undefined' && typeof this.main !== 'undefined') {
                let crossrate = ((1/obj.o1.currentAsk[0]) * obj.o2.currentBid[0]) / this.main.currentAsk[0]

                let orderAmount1 = obj.o1.currentAsk[2] * obj.o1.currentAsk[0]; // Amount in ETH
                let orderAmount2 = (obj.o2.currentBid[2] * obj.o2.currentAsk[0]) / this.main.currentAsk[0]; // Amount in BTC (coverted value to eth)
                let orderAmountMain = this.main.currentAsk[2] * this.main.currentAsk[0]; // Amount in ETH
                this._pairs[obj.base].maxAmount = Math.min(
                    Math.abs(orderAmount1), 
                    Math.abs(orderAmount2), 
                    Math.abs(orderAmountMain)
                )

                let profit = 0.0;
                if(crossrate !== this.crossrate) {
                    if(crossrate >= 1 + profit)
                        console.log(`${Date.now()} - [${obj.o1.pair.substring(1)} > ${obj.o2.pair.substring(1)} > ${this.main.pair.substring(1)}] xrate: ${chalk.yellow(crossrate.toFixed(4))} max: ${this._pairs[obj.base].maxAmount.toFixed(4)}${this.mainpair.base}`)
                    else 
                        console.log(`${Date.now()} - [${obj.o1.pair.substring(1)} > ${obj.o2.pair.substring(1)} > ${this.main.pair.substring(1)}] xrate: ${chalk.red(crossrate.toFixed(4))} max: ${this._pairs[obj.base].maxAmount.toFixed(4)}${this.mainpair.base}`)
                    this.createSpread(obj.base); // TODO: Move to crossrate >= 1.00
                }
                this.crossrate = crossrate;
            }
        }
    }

    /**
     * 
     * @returns {Boolean} - 
     */
    _subscribePairs() {
        this.subscribeOrderBook( {symbol: this.mainpair, precision: "P0", cbGID: `${this.mainpair}-MAIN`});
        for(var i = 0; i < this.altpairs.length; i++)
            this.subscribeOrderBook({symbol: this.altpairs[i], precision: "P0", cbGID: `${this.mainpair}-MAIN`});
    }

    /**
     * 
     * @public methods
     * 
     */

    /**
     * @description Set Main Pair
     * @param {Pair} mainpair
     */
    setMainPair(mainpair) {
        // BUG: Fix mainpair scope (multiple ArbTri objects with different mainpairs)
        this.mainpair = mainpair;
        this.mainpair.on('ob_update', (order) => {
            /**
             * ! Need to calculate against every Pair on update
             * ! Use console.timer() 
             */ 
            if(typeof this.main !== 'undefined') {
                if(this.main.currentAsk[0] !== order.currentAsk[0] || this.main.currentAsk[2] !== order.currentAsk[2] ) { //Array comparison
                    this.main = order;

                    console.time(`mainpair ob_update`)
                    for(let base in this._pairs) {
                        this._calculateArbitrage(this._pairs[base]);
                    } 
                    console.timeEnd(`mainpair ob_update`)
                }
            }
            else
                this.main = order;
        })
    }

    /** 
     * @description Adds alt pairs to _pairs array
     * 
     * @param {Pairs} pair - alt pairs (base & quote)
     */
    addPair(pair) {
        if(!this._pairs.hasOwnProperty(pair.base)) {
            this._pairs[pair.base] = [2];
            this._pairs[pair.base]['orders'] = [1];
            this._pairs[pair.base]['base'] = pair.base;
        }
        if(pair.quote == this.mainpair.base)
            this._pairs[pair.base][0] = pair;
        else 
            this._pairs[pair.base][1] = pair;
    }

    /**
     * 
     * @param {Pair[]} pairArray - tpairs
     */
    addPairArray(pairArray, amount) {
        let i;
        for(i = 0; i < amount; i++) {
            if(typeof pairArray[i] == undefined) return;
            this.addPair(new Pair(pairArray[i], this));
        }
        console.log(`Added ${i} pairs to ArbitrageTriangle instance`)
    }

    /**
     * @description Creates spread order strategy for given symbol
     *  - Ask orders take negative amount value.
     *  - Bid orders take positive amount value.
     *  Pair.maxAmount is positive so need to account for this.
     * @param {String} base - base symbol for arbitrage cycle.
     */
    createSpread(base) {
        let pair = this._pairs[base];

        pair['orders'][0] = pair[0].makeOrder(pair.o1.currentAsk[0], (pair.maxAmount * -1));
        pair['orders'][1] = pair[1].makeOrder(pair.o2.currentBid[0], pair.maxAmount);
        pair['orders'][2] = this.mainpair.makeOrder(this.main.currentAsk[0], (pair.maxAmount * -1));
        
        //console.log(`${Date.now()} - [${pair.base}] Orders: 
        //            [${pair.orders[0].price}, ${pair.orders[0].amount}] ASK
        //            [${pair.orders[1].price}, ${pair.orders[1].amount}] BID
        //            [${pair.orders[2].price}, ${pair.orders[2].amount}] ASK`) 
    }

}

/**----------------------------------
 * 
 * 
 *  Testing 
 * 
 * 
 ----------------------------------*/

var API_KEY = process.env.API_KEY;
var API_SECRET = process.env.API_SECRET

var tpairs = rv2.ethbtc_pairs;
//var tpairs_eur = rv2.etheur_pairs;

var opt = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
    transform: true // auto-transform array OBs to OrderBook objects
};

/**
 // TODO: Move to index.js
 * - Setup exports from this file. (export to index.js)
 * - Split main pair into multiple ArbTri objects. (60 subscriptions maximum each)
 * - Store ArbitrageTriangle instances in hashmap/object per mainpair.
 */

const arb_tETHBTC = new ArbitrageTriangle(opt);

arb_tETHBTC.on('open', () => {
    console.log(`${API_KEY}`)
    console.log(`${API_SECRET}`)
    arb_tETHBTC.setMainPair(new Pair('tETHBTC', arb_tETHBTC));
    arb_tETHBTC.addPairArray(tpairs,30);
    arb_tETHBTC._setPairListeners();
})

arb_tETHBTC.on('error', (err) => {
    //if (process.argv[4] !== '-v') {
      if(err.code == 10305) {
        errcounter++;
        console.error(`${err.event} ${errcounter}: ${err.code} "${err.pair}" "${err.msg}"`)
      }
      if(!err.message) {
        console.error(`${err.event}: ${err.code} "${err.pair}" "${err.msg}"`); 
        errlog.write(`${err.event}: ${err.code} "${err.pair}" "${err.msg}" \n`);
      }
      else console.error('error: %s', err.message)
    //}
})

