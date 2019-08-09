'use strict'


const express = require('express');
const app = express();
const path = require('path');
const tri_arb = require('./triangle-arbitrage.js')
const mongoose = require('mongoose');
var fs = require('fs');
var stream = fs.createWriteStream(path.join(__dirname,"/log/ob_data.txt"))
var open = require('open');

var eventEmitter = tri_arb.emitter;
var triArray = tri_arb.triArray;
var alts = tri_arb.alts;
var pairs = tri_arb.tpairs;
var bal;

/*  Try logging to file first
mongoose.connect('mongodb://localhost/orderbookdb', function(err){
    if(err) { console.log(err) }
    else console.log('Connected to mongodb')
});

var orderbookSchema = mongoose.Schema({
    pair: String,
    bids: Array,
    asks: Array
    //executedTime: { type: Date, default: Date.now },
})

var orderbookModel = mongoose.model('Orderbook', orderbookSchema)
*/

app.set('views', __dirname + '/views');
app.set('crypto-icons', __dirname + "/node_modules/cryptocurrency-icons/32@2x/icon/");
app.set('view engine', 'ejs');

app.use( express.static(path.join(__dirname, '/public')));
app.use( "/crypto-icons", express.static(path.join(__dirname,'/node_modules/cryptocurrency-icons/32@2x/icon/')));

app.get('/crypto-icons', (req,res) => {

    res.sendFile(req);

})

app.get('/', (req, res) => {
    
    res.render('examples/dashboard', 
    {   
        balances: tri_arb.balances,
        symbols: pairs,
        alts: alts
    }); 
    
});

app.get('/icons', (req, res) => {
    
    res.render('examples/icons', 
    {   

    });
  
});
var PORT = 7000;
const server = app.listen(PORT, async function (){
    var port = PORT;
    console.log(`Express running → PORT ${port}`);
    console.log(`http:localhost:${port}`)
    var url = `http:localhost:${port}`;
    open(url);

})

var io = require('socket.io').listen(server);


io.sockets.on('connection', function (socket) {
    
    console.log('User connected');
    socket.emit('message', { text: 'You have connected'});
    socket.on('disconnect', function () {
        console.log('User disconnected');
    });
    eventEmitter.on('ob', function (ob) {
        socket.emit('ob', { symbol: ob.symbol, bids: ob.bids, asks: ob.asks })
       // stream.write(`${Date.now()} ${ob.symbol} ${ob.bids[0]} ${ob.asks[0]} \n`);
    });
            
})

