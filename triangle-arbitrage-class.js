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
////const TimSort = require('timsort');
const fs = require('fs');
const api_obj = require('./apikeys.json'); // TODO: make into env variable
 

class Pair extends EventEmitter {

    /**
     * 
     * @param {string} pair: 'tOMGETH'
     * @param {WSv2} ws
     * 
     */

    constructor(pair, ws) {
        super();
        this.pair = pair;
        this.ws = ws;
        this.orderbook_opts = { symbol:this.pair, precision:"P0" };
        this.ws.send({ event: 'conf', flags: 131072 }) // Checksum flag
        this.ws._manageOrderBooks = true;
        this.ws.subscribeOrderBook(this.pair);
        this._orderBookListener(); //this.onOrderBook()
        this._setupSymbols();
        this.orderbook; // OrderBook instance for this pair. 
        this.currentAsk; // Current Ask. 
        this.currentBid; // Current Bid.
        this.maxAmount; // Maximum amount to buy for arbitrage cycle.
    }

    _setupSymbols() {
        // TODO: refactor this to account for 't' and for pairs that have more than 3 chars for base/anchor.
        this.base = this.pair.substring(1,4);
        this.anchor = this.pair.substring(3);
    }

    /**
     * @description OrderBook Listener
     */
    _orderBookListener() {
        this.ws.onOrderBook( this.orderbook_opts, (ob) => {
            this.currentAsk = ob.asks[0];
            this.currentBid = ob.bids[0];

            this.currentBid[2] < (this.currentAsk[2] * -1) 
                ? this.maxAmount = this.currentBid[2] 
                : this.maxAmount = this.currentAsk[2]
            
            this.emit('ob_update', {
                pair: this.pair,
                currentAsk: this.currentAsk,
                currentBid: this.currentBid,
                maxAmount: this.maxAmount
            })
        }) 
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
     * @param {Pair[]} altpairs - Object containing Pairs with the same base (alt) currency.  
     * 
     * 
     * 
     */
    constructor(opts) {
        super(); 
        this._manageOrderBooks = opts.manageOrderBooks === true;
        this._transform = opts.transform === true;
        this.open();
    }

    /**
     * @description Set Main Pair
     * @param {Pair} mainpair
     */
    setMainPair(mainpair) {
        this.mainpair = mainpair;
    }

    /**
     * 
     * @param {Pair[]} pairs 
     */
    setPairs(pairs) {
        this.pair1 = pairs.pair1;
        this.pair2 = pairs.pair2;
    }

    _setPairListeners() {
        this.mainpair.on('ob_update', (order) => {
            this.main = order;
            this._calculateArbitrage();
        })
        this.pair1.on('ob_update', (order) => {
            this.o1 = order;
            this._calculateArbitrage();
        })
        this.pair2.on('ob_update', (order) => {
            this.o2 = order;
            this._calculateArbitrage();
        })
    }
    
    _calculateArbitrage() {
        if(typeof this.o1 !== 'undefined' && typeof this.o2 !== 'undefined' && typeof this.main !== 'undefined') {
            let crossrate = ((1/this.o1.currentAsk[0]) * this.o2.currentBid[0]) / this.main.currentAsk[0]
            console.log(crossrate)
        }
    }

    /**
     * @description Creates base & anchor pair from symbol.
     * 
     */
    _assignSymbols() {
        //TODO: refactor for base string length. 
        if(this.mainpair.charAt(0) == 't') {  
            this.basesymbol = this.mainpair.substring(1,3);
            this.anchorsymbol = this.mainpair.substring(3);
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

}

/**----------------------------------
 * 
 * 
 *  Testing 
 * 
 * 
 ----------------------------------*/

var API_KEY = api_obj.test.api_key;
var API_SECRET = api_obj.test.api_secret;
var testPair;
var obj = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
    transform: true // auto-transform array OBs to OrderBook objects
  };


const ws = new ArbitrageTriangle(obj);

  ws.on('open', () => {
    console.log('open')
    console.log(`API key: ${chalk.yellow(API_KEY)} `);
    console.log(`API secret: ${chalk.yellow(API_SECRET)} `);
    var mainPair = new Pair('tETHBTC', ws);
    var pair1 = new Pair('tOMGETH', ws);
    var pair2 = new Pair('tOMGBTC', ws);
    ws.setMainPair(mainPair);
    ws.setPairs({ pair1: pair1, pair2: pair2 });
    ws._setPairListeners();
  })
