const dotenv = require('dotenv').config();
const usersRoute = require('./routes/user.route')
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const request = require('request');
const bodyParser = require('body-parser');
const bus = require('./util/eventBus');
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
const auth = require('./middleware/auth');
const oauth = require('./oauth')

//IMPORTANT: Make trello todo list and link to vsc
//TODO: Use index.js to acquire and push all order data into express server.
//TODO: Use child_process to spawn multiple arbitrageInstances.
//TODO: Make chart.js file to draw all charts on frontend.

//oauth client for github
const clientID = oauth.clientID;
const clientSecret = oauth.clientSecret;

var options = {};
var ETHBTC;

options.market = 'tETHBTC';

if(process.argv[2] !== 'TEST') {
    try {
        ETHBTC = require('./arbitrageInstance')(options);
    } catch (error) {
        console.error(error);
    }

}
/**
 *  Mongodb
 */

/**
 * Express
 */
//IMPORTANT: Set up proper routing. 'https://medium.com/quick-code/handling-authentication-and-authorization-with-node-7f9548fedde8'

app.use(express.static(path.join(__dirname, '/public/')));
app.use(express.static('public'));

app.use('/crypto-icons', express.static(__dirname + '/node_modules/cryptocurrency-icons/32@2x/icon'));

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true })); 
app.use(express.json())

app.get('/', (req, res) => {
    res.redirect('https://github.com/login/oauth/authorize?client_id=' 
        + clientID + '&redirect_uri=http://localhost:7000/oauth/redirect');
})

app.get('/dashboard', (req, res) => {
    let current_token = req.query.access_token;
    //Change to session token/cookie
    if(current_token) {
        res.render('examples/dashboard', {
            balances: ETHBTC.balances
        })
    } else {
        res.render('examples/tables');
    }
})

app.get('/oauth/redirect', (req, res) => {
    const requestToken = req.query.code
    axios({
      method: 'post',
      url: `https://github.com/login/oauth/access_token?client_id=${clientID}&client_secret=${clientSecret}&code=${requestToken}`,
      headers: {
           accept: 'application/json'
      }
    }).then((response) => {
      const accessToken = response.data.access_token
      res.redirect(`/dashboard?access_token=${accessToken}`)
    })
})

const port = process.env.PORT || 7000;
const server = app.listen(port, () => {

    console.log(`Express running → PORT ${server.address().port}`);
    console.log(`http:localhost:${port}`)

})

/**
 * Socket.io
 */
var io = require('socket.io').listen(server);

io.sockets.on('connection', function (socket) {
    
    console.log('User connected');
    
    socket.emit('message', { text: 'You have connected'});
    
    socket.on('disconnect', function () {
        console.log('User disconnected');
    });

    socket.on('get-balances', async () => {
        return new Promise(async (resolve, reject) => {
            ETHBTC.getBal().then((bal) => {
                console.log(bal);
                res.send({balances: bal});
            })
        })
    })

    bus.on('balance-update', (update) => {
        res.send({balances: update});
    })

    bus.on('arbData', (data) => {
        socket.emit('draw', data);
    })

    bus.on('calcArbData', (data) => {
        socket.emit('calcdata', data);
    })

    bus.on('spread', (data) => {
        socket.emit('currentSpread', data);
    })

})


console.log('Done!!!');
