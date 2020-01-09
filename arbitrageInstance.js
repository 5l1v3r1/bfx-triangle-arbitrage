const dotenv = require('dotenv').config()
const debug = require('debug')('triangle-arbitrage')
const async = require('async')
const { EventEmitter } = require('events')
const BFX = require('bitfinex-api-node')
const rv2 = require('bitfinex-api-node/examples/rest2/symbols')
const { Order } = require('bfx-api-node-models')
const { OrderBook } = require('bfx-api-node-models') 
const WSv2 = require('bitfinex-api-node/lib/transports/ws2')
const Promise = require('bluebird');
const symbolDetails = require('./util/symbol_details')
const BFX_SETUP = require('./util/BFX_SETUP')
var bus = require('./util/eventBus')
const path = require('path');
const CRC = require('crc-32');
const log = require ('ololog').noLocate;
const ansi = require ('ansicolor').nice;
const style = require ('ansi-styles');
const chalk = require ('chalk');
const fs = require('fs');
const { ArbitrageTriangle, Pair } = require('./util/triangle-arbitrage-class')

/** 
 * 
 * - Setup exports from this file. (export to index.js)
 * - Split main pair into multiple ArbTri objects. (60 subscriptions maximum each)
 * - Store ArbitrageTriangle instances in hashmap/object per mainpair.
 */

var market;
var myArgs = process.argv.slice(2);
var API_KEY = process.env.API_KEY;
var API_SECRET = process.env.API_SECRET
var tpairs = rv2.ethbtc_pairs;
var tpairs_eur = rv2.etheur_pairs;

var opt = {
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    manageOrderBooks: true, // tell the ws client to maintain full sorted OBs
    transform: true // auto-transform array OBs to OrderBook objects
};

var arbitrageTriangleObject = {} //Stores ArbitrageTriangle Objects
var symbolObject;

/**
 * Helper functions
 */

/**
 * @description Promise-based timeout. 
 * @param {*} ms Time in miliseconds.
 */
const timeout = ms => new Promise(res => setTimeout(res, ms));


/**
 * @description Sets Listeners for ArbitrageTriangle objects. 
 * 
 * @param {ArbitrageTriangle} instance - instance of ArbitrageTriangle (WSv2)
 * @param {Pair} mainPair - selected main pair
 * @param {String[]} pairArray - Array containing pair strings
 * @param {Integer} i - offset for pairArray
 */

bus.on('fetched-symbols', async (obj) => {
    symbolObject = obj; //Exported markets 
    var markets = [];
    var instanceCounter = 0;
    
    //IMPORTANT: Split markets over separate Node instances to avoid bottleneck.

    //for(var i = 0; i < myArgs[0]; i++) {
        //if(obj.markets[obj.mainpairs[i]].length > 0) 
        if(myArgs.length == 0) markets.push(market);
        else markets.push(obj.mainpairs[myArgs[0]]);
    //}

    for(var i = 0; i < markets.length; i++) {
        arbitrageTriangleObject[markets[i]] = {};
    }
    
    await Promise.map(markets, async (market) => {    

        let instanceAmount = Math.ceil(obj.markets[market].length / 30);
        arbitrageTriangleObject[market]['instances'] = [];
        arbitrageTriangleObject[market]['instanceAmount'] = instanceAmount;
        
        for(let i = 0; i < instanceAmount; i++) {
            arbitrageTriangleObject[market]['instances'][i] = new ArbitrageTriangle(opt);

            arbitrageTriangleObject[market]['instances'][i].on('open', () => {
                arbitrageTriangleObject[market]['instances'][i].setMainPair(new Pair(market, arbitrageTriangleObject[market]['instances'][i]));
                console.log(`${market} ${i} main pair set!`)
            })

            console.log(`Initialized ${market} instance ${i}`)
            instanceCounter++;
            if(i == (instanceAmount - 1)) console.log(`-------`)
        }

        return market;      

    }).then( async (activeMarkets) => {
        
        let openQueue = async.queue( async function (task, callback) {
            console.log(`current task: ${task.market} ${task.index} (${openQueue.length()})`);
            await task.instance.open();
            await timeout(500);
            callback(null,openQueue.length());
        }, 1);

        openQueue.error( (err, task) => {
            console.error(task.market, err);
        })

        openQueue.empty(() => {
            console.log(`Queue empty`)
        })

        openQueue.drain(() => {
            console.log('All markets are open');
        });
        
        activeMarkets.forEach((market) => {
            for(let i = 0; i < arbitrageTriangleObject[market]['instanceAmount']; i++) {
                openQueue.push({instance: arbitrageTriangleObject[market]['instances'][i], market: market, index: i}, function (err) {
                    console.log(`${market} ${i} is open!\n`);
                    if(openQueue.idle() == true) {
                        console.log('Queue empty');
                        bus.emit('markets-init', activeMarkets);
                    }
                })
            }
        })
        console.log(`Init finished (${activeMarkets.length} main pairs, ${instanceCounter} instances)\n`.yellow);  
    })
})

bus.on('markets-init', async (activeMarkets) => {
    // Cycle through activeMarkets and iterate through obj.markets to add pairs.
    // Once 30 subscriptions have been made, move onto the next activeMarket.
    console.log(`Initializing pairs.`)

    await Promise.all(Promise.map(activeMarkets, async market => {
        let symbolArray = symbolObject.markets[market];
        let marketQueue = async.queue( async (task, callback) => {
            console.log(`current task: ${task.market} ${task.instanceIndex} (${marketQueue.length()})`);
            await task.instance.addPairArray(symbolArray, ((task.instanceIndex+1)*30), 30);
            callback();
        })
        
        for(let i = 0; i < arbitrageTriangleObject[market]['instanceAmount']; i++) {
            marketQueue.push({instance: arbitrageTriangleObject[market]['instances'][i], market: market, instanceIndex: i}, async (err) => {
                console.log(`Added markets to ${market} ${i}\n`)
                await timeout(500);
            })
        }

    })).then((activeMarkets) => {
        console.log(`Markets created.\n`)
    })

    arbitrageTriangleObject.activeMarkets = activeMarkets;
    await bus.emit('pairs-init', activeMarkets);
})

bus.on('pairs-init', async (activeMarkets) => {
    console.log(`Initializing pair listeners..`)
    Promise.map(activeMarkets, async market => {
        arbitrageTriangleObject[market]['instances'].forEach( async instance => {
            await instance._setPairListeners();
        })
    }).then( () => {
        console.log(`Initialized`)
        bus.emit('arbTriObj-init')
    })

})

var secret = API_SECRET.substring(0,4);
for(var i = 3; i < API_SECRET.length; i++) secret += '*';

console.log(`API_KEY: ${API_KEY.yellow}`)
console.log(`API_SECRET: ${secret.yellow}`)

//TODO: Add SIGINT to disconnect from ws
process.on('SIGINT', async function() {
    console.log('SIGINT - Doing clean-up.');
    console.log(`Closing connections`);
    
    //REVISE: Each arbitrageInstance only has one market??
    await Promise.all(Promise.map(arbitrageTriangleObject[market]['instances'], instance => {
        instance.close();
    })).then(() => {
        console.log(`All markets closed`)
        process.exit();
    });
});
  
module.exports = function (options) {
    market = options.market; //Set instance market.
    var module = {};
    
    bus.on('arbTriObj-init', (a) => {
        module.arbitrageTriangleObject = arbitrageTriangleObject;
        bus.emit('test');
    })
    return module;
};
