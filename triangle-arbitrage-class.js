const dotenv = require('dotenv').config()
const debug = require('debug')('triangle-arbitrage')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const symbolDetails = require('./util/symbol_details')
const BFX = require('bitfinex-api-node')
const { Order } = require('bfx-api-node-models')
const { OrderBook } = require('bfx-api-node-models') 
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')
const BFX_SETUP = require('./BFX_SETUP')
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

class Pair {

    /**
     * 
     * @param {string} pair: 'tOMGETH'
     * @param {WebSocketInstance} ws
     * 
     */

    constructor(pair, ws) {
        this.pair = pair;
        //1. bfx instance = ws
        this.ws = ws;
        //2. Subscribe to OrderBook.
        this.ws.subscribeOrderBook(this.pair);
        this._orderBookListener();
        //3. Setup onOrderBook listener.
        // TODO: refactor this to account for 't' and for pairs that have more than 3 chars for base/anchor.
        this.base = pair.substring(1,4);
        this.anchor = pair.substring(3);
        this.orderbook; // OrderBook instance for this pair. 
        this.topAsk; // Current Ask. 
        this.topBid; // Current Bid.
    }

    _orderBookListener() {
        let PRECISION = "P0"
        this.ws.onOrderBook({ symbol:this.pair, precision:PRECISION }, (ob) => {
            console.log(`Got OrderBook`)
            this.topAsk = ob.asks[0];
            this.topBid = ob.bids[0];
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

    /**
     * @param {float} amount 
     */
    sendBidOrder() {
        this.makeOrder()
    }

    /**
     * @param {float} amount 
     */
    sendAskOrder(amount) {

    }

}

class ArbitrageTriangle {

    /** 
     * @param {Pair} symbol  
     * @param {Pair} mainpair
     * 
     */
    constructor(symbol, mainpair) {
        this.mainpair = mainpair; // Listen to mainpair orderbook, should access it from a hashmap (object).
        // Set up basepair & anchorpair.
        this._assignPairs(symbol);
    }

    /**
     * Creates base & anchor pair from symbol.
     * @param symbol: 'omg'
     * 
     */
    _assignPairs(symbol) {
        //1. get mainpair and break into base & anchor strings.
        if(this.mainpair.charAt(0) == 't') {  
            this.basepair = this.mainpair.substring(1,3);
            this.anchorpair = this.mainpair.substring(3);
        }
    }
}

var API_KEY = api_obj.test.api_key;
var API_SECRET = api_obj.test.api_secret;
var testPair;

const ws = BFX_SETUP.BFX_INSTANCES[0];

  ws.on('open', () => {
    console.log('open')
    console.log(`API key: ${chalk.yellow(API_KEY)} `);
    console.log(`API secret: ${chalk.yellow(API_SECRET)} `);
    testPair = new Pair('tOMGETH', ws);
    console.log(testPair.topAsk)
  })
  
  ws.open();
