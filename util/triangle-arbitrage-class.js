const dotenv = require('dotenv').config()
const debug = require('debug')('triangle-arbitrage')
const async = require('async')
const { EventEmitter } = require('events')
const BFX = require('bitfinex-api-node')
const { Order } = require('bfx-api-node-models')
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')
const bus = require('./eventBus');
const symbol_details = require('./symbol_details')
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
        this._setErrorListeners();
        this.orderbook; 
        this.currentAsk; 
        this.currentBid; 
        this.maxAmount;
        this.checksumCount = 0;
        this.checksumLimit = 20; // 10 checksum mismatches until resubscribe
        this.isSending = false;
    }

    _setErrorListeners() {
        this.ws.on('error', (err) => { 
            if(err.hasOwnProperty('code')) {
                switch(err.code) {
                    case '10300': console.error(`${this.pair} 10300: Subscription failed (generic)`); break;
                    case '10301': console.error(`${this.pair} 10301: Already subscribed`); break;
                    case '10302': console.error(`${this.pair} 10302: Unknown channel`); break;
                    case '10400': console.error(`${this.pair} 10400: Subscription failed (generic)`); break;
                    case '10401': console.error(`${this.pair} 10401: Not subscribed`); break;
                }
            }
        })
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

        if(typeof this['ws'] !== 'undefined') {
            let onCS, CS;
            this.ws.onOrderBookChecksum( this.orderbook_opts, async (cs) => {
                onCS = cs;
            })

            this.ws.onOrderBook( this.orderbook_opts, async (ob) => {
                try {
                    CS = await ob.checksum();
                    if(onCS == CS) {        
                        this.currentAsk = ob.asks[0];
                        this.currentBid = ob.bids[0];
                        
                        this.emit('ob_update', {
                            pair: this.pair,
                            currentAsk: this.currentAsk,
                            currentBid: this.currentBid,
                            maxAmount: this.maxAmount
                        })

                    } else if (onCS !== CS && typeof onCS !== 'undefined') {
                        let ob = await this.ws.getOB(this.pair);
                        let newCS = await ob.checksum();

                        if(newCS == onCS) {
                            this.currentAsk = ob.asks[0];
                            this.currentBid = ob.bids[0];
                            
                            this.emit('ob_update', {
                                pair: this.pair,
                                currentAsk: this.currentAsk,
                                currentBid: this.currentBid,
                                maxAmount: this.maxAmount
                            })
                        }
                    }
                } catch(err) {
                    console.error(err)
                }
            }) 

        } else {
            console.log(this)
        }
}

    /**
     * @description WSv2 Error Listener
     * @listens Error WSv2
     */
    _errorListener() {
        this.ws.on('error', (err) => {
            console.error(err)
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
    async _sendOrder(order) {
        return await this.ws.submitOrder(order);
    }

    /** 
     * @param {Order} order
     * @returns {Promise} p - resolves on submit notification.
     */
    async _cancelOrder(order) {
        return await this.ws.cancelOrder(order)
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
        this._apiKey = opts.apiKey
        this._apiSecret = opts.apiSecret
        this._pairs = {}; 
        this.balances = [];
        this.checkAuth();
    }
    /**
     * @description Authenticates ws instance.
     */
    checkAuth() {
        this.on('open', () => {
            this.auth().then( () => {
                console.log(`Authenticated`)
            })
        })
    }

    /**
     * @description 
     */
    async getBal() {
        return new Promise( async (resolve, reject) => {
            await this.onWalletSnapshot('', (bal) => {      
                try{
                    this.amount_currencies = bal.length;
                    //if (this.amount_currencies > 0) 
                    console.log(`\n${chalk.green('Balances Snapshot')} ${Date.now()}`)
                    console.log(`${this.amount_currencies} currencies`)
                    
                    for(var i = 0; i<this.amount_currencies; i++) { 
                        this.balances[i] = bal[i]; 
                      console.log( bal[i]['currency'].green, bal[i]['type'], chalk.yellow(bal[i]['balance']));
                    }
                    resolve(this.balances);
                } catch (err) {
                    reject(err);
                }
            })
            await this.onWalletUpdate('', (bal) => {      
                try{
                    this.amount_currencies = bal.length;
                    if (this.amount_currencies > 0){ 
                        console.log(`\n${chalk.green('Balances Update')} ${Date.now()}`)
                        console.log(`${this.amount_currencies} currencies`)
                        
                        for(var i = 0; i<this.amount_currencies; i++) { 
                            this.balances[i] = bal[i]; 
                          console.log( bal[i]['currency'].green, bal[i]['type'], chalk.yellow(bal[i]['balance']));
                        }
                        resolve(this.balances);
                    }
                } catch (err) {
                    reject(err);
                }
            })
            
        })           
    }
    
    _setPairListeners() {
        try{
            for(let symbol in this._pairs) {
                this._pairs[symbol][0].on('ob_update', (order) => {
                    if(order.pair.substring(1,4) == symbol) {
                        this._pairs[symbol].o1 = order;
                        this._calculateArbitrage(this._pairs[symbol]);
                    } else 
                        console.log(`Oops error? Should be ${symbol} but is ${order.pair}`)
                })
                this._pairs[symbol][1].on('ob_update', (order) => {
                    if(order.pair.substring(1,4) == symbol) {
                        this._pairs[symbol].o2 = order;
                        this._calculateArbitrage(this._pairs[symbol]);
                    } else 
                        console.log(`Oops error? Should be ${symbol} but is ${order.pair}`)
                })
            }
        } catch(err) {
            console.error(err);
        }
    }

    /**
     * 
     * @description Calculates arbitrage opp between mainpair and current pairs 
     */

     _calculateArbitrage(obj) {
        if(obj.hasOwnProperty('o1') && obj.hasOwnProperty('o2')) {
            if(obj.o1.pair.substring(1,4) !== obj.o2.pair.substring(1,4)) {
                console.log(obj)
            }

            if(typeof obj.o1 !== 'undefined' && typeof obj.o2 !== 'undefined' && typeof this.main !== 'undefined') {
                let crossrate = ((1/obj.o1.currentAsk[0]) * obj.o2.currentBid[0]) / this.main.currentAsk[0]

                let orderAmount1 = obj.o1.currentAsk[2] * obj.o1.currentAsk[0]; // Amount in ETH
                let orderAmount2 = (obj.o2.currentBid[2] * obj.o2.currentAsk[0]) / this.main.currentAsk[0]; // Amount in BTC (coverted value to eth)
                let orderAmountMain = this.main.currentAsk[2] * this.main.currentAsk[0]; // Amount in ETH
                
                //Determine lowest possible current amount of alt
                this._pairs[obj.base]['currentAmount'] = Math.min(
                    Math.abs(orderAmount1), 
                    Math.abs(orderAmount2), 
                    Math.abs(orderAmountMain)
                )

                let profit = 0.0; //CLIENT: set this from client
                let spreadArray = this.createSpread(obj.base);

                if(crossrate !== this.crossrate) {
                    if(crossrate >= 1.0 + profit) {
                        if(this._pairs[obj.base].currentAmount >= this._pairs[obj.base].minAmount) {
                            if(this.isSending == false) {
                                console.log(`${new Date().toISOString()} - [${obj.o1.pair.substring(1)} > ${obj.o2.pair.substring(1)} > ${this.main.pair.substring(1)}] xrate: ${chalk.yellow(crossrate.toFixed(4))} min: ${this._pairs[obj.base].minAmount}${this.mainpair.base} cur: ${this._pairs[obj.base].currentAmount.toFixed(4)}${this.mainpair.base}`)
                                this.sendOrders(this._pairs[obj.base],spreadArray);
                            } else {
                                console.log(`${obj.o1.pair.substring(1,4)} Order in progress`);
                                //this.updateOrders(this._pairs[obj.base], spreadArray)
                                //TODO: trigger orderUpdate from WSv2. Need order CIDs
                            }
                        }

                    }
                    else 
                        console.log(`${new Date().toISOString()} - [${obj.o1.pair.substring(1)} > ${obj.o2.pair.substring(1)} > ${this.main.pair.substring(1)}] xrate: ${chalk.red(crossrate.toFixed(4))} min: ${this._pairs[obj.base].minAmount}${this.mainpair.base} cur: ${this._pairs[obj.base].currentAmount.toFixed(4)}${this.mainpair.base}`)
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
        this.mainpair = mainpair;
        this.mainpair.on('ob_update', (order) => {   
            let oldOrder;
            
            try {
                if(typeof this.main == 'undefined') this.main = order;

                if(typeof order.currentAsk !== 'undefined' && typeof order.currentBid !== 'undefined') {
                    if(order.currentAsk[0] !== this.main.currentAsk[0] || order.currentBid[0] !== this.main.currentBid[0]) {
                        this.main = order;
                        for(let base in this._pairs) {
                            this._calculateArbitrage(this._pairs[base]);
                        } 
                    }
                }
            } catch(err) {
                console.error(err);
            }
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
            this._pairs[pair.base]['minAmount'] = symbol_details.symbol_details_array[`t${pair.base}`]['minimum_order_size'];
            this._pairs[pair.base]['maxAmount'] = symbol_details.symbol_details_array[`t${pair.base}`]['maximum_order_size'];
        }
        if(pair.quote == this.mainpair.base)
            this._pairs[pair.base][0] = pair;
        else 
            this._pairs[pair.base][1] = pair;
    }

    /**
     * 
     * @param {String[]} pairArray - Pair array
     * @param {index} - Index of instance
     * @param {amount} - amount of pairs to add
     * @returns {Promise} resolved
     */
    addPairArray(pairArray, startPoint, amount) {
        return new Promise((resolve,reject) => {
            try {
                if(startPoint >= pairArray.length) resolve();
                else{ 
                    for(let i = startPoint; i < (startPoint + amount); i++) {
                    if(typeof pairArray[i] == undefined) resolve('Iterated through pairArray');
                    this.addPair(new Pair(pairArray[i], this));
                    }
                    console.log(`Added ${amount} pairs to ArbitrageTriangle instance (${startPoint})`)
                    resolve();
                }
            } catch(err) {
                reject(err);
            }
        })
        
    }

    /**
     * @description Creates spread order strategy for given symbol
     *  - Ask orders take negative amount value.
     *  - Bid orders take positive amount value.
     *  Pair.maxAmount is positive so need to account for this.
     * @param {String} base - base symbol for arbitrage cycle.
     * @returns {Array} array of orders
     */
    async createSpread(base) {

        let pair = this._pairs[base]; 
        
        pair['orders'][0] = pair[0].makeOrder(pair.o1.currentAsk[0], (pair.currentAmount * -1))
        pair['orders'][1] = pair[1].makeOrder(pair.o2.currentBid[0], pair.currentAmount)
        pair['orders'][2] = this.mainpair.makeOrder(this.main.currentAsk[0], (pair.currentAmount * -1))
        
        let pair_Array = [pair[0], pair[1], this.mainpair];
        return pair_Array;
    }

    /**
     * 
     * @param {String} pair this._pairs array
     * @param {Array} pairArray Array of pairs + mainpair objects
     */
    async sendOrders(pair, pairArray) {
        this.isSending = true;
        //send pair orders with pair._sendOrder method.
        //Use async queue to for correct ordering.
        const timeout = ms => new Promise(res => setTimeout(res, ms));

        let orderQueue = async.queue(async function (task, callback) {
            console.log(`\n${pairArray[0].pair} -> ${pairArray[1].pair} -> ${pairArray[2].pair} `)
            console.log(`current Order: ${task.orderNumber} pair: ${task.pair.pair} Order: ${task.order}`);
            //await task.pair._sendOrder(task.order);
            //await timeout(3000);
            callback();
        }, 1);

        orderQueue.drain(() => {
            this.isSending = false;
            console.log(`${pairArray[0].pair} -> ${pairArray[1].pair} -> ${pairArray[2].pair} `)
            console.log(`order queue drained`)
        })
        
        await pairArray.forEach(pairobj => {
            orderQueue.push({pair: pairobj, orderNumber: pairArray.indexOf(pairobj), order: pair['orders'][pairArray.indexOf(pairobj)]}, async function (err) {
                if(err) {
                    console.error(err);
                    console.error(`Killing order queue ${pairArray[0].base}`);
                    await orderQueue.kill();
                    this.isSending = false;
                    console.error(`Killed order queue ${pairArray[0].base}`);
                }
                else {
                    if(orderQueue.idle() == true) {
                        console.log(`${pairArray[0].pair} -> ${pairArray[1].pair} -> ${pairArray[2].pair} `)
                        console.log(`All orders sent!`)
                        this.isSending = false;
                    } else {
                        console.log(`${pairArray[0].pair} -> ${pairArray[1].pair} -> ${pairArray[2].pair} `)
                        console.log(`Sent order!\n`);
                    }
                }
                
            })
        })
    }
}

module.exports = {
    ArbitrageTriangle: ArbitrageTriangle,
    Pair: Pair
}
