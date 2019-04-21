const path = require('path');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const WebSocketServer = require('websocket').server;
const http = require('http');
const server = http.createServer(function(request, response) {
    //none
});
const PORT = process.env.PORT || 65080;

const MESSAGE_TYPE_CODES = {
    0 : "init",
    1 : "locationupdate",
    2 : "ineedhelp",
    3 : "icanhelp",
    4 : "cancelrequest",
    5 : "end"
};

const RESPONSE_TYPE_CODES = {
    0 : "available",
    1 : "resubmitTheConfirmation",
    2 : "failedDoNotReattempt"
};

server.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
    console.log('Press Ctrl+C to quit.');
});

const io = new WebSocketServer({
    httpServer: server
});
// const io = require('socket.io').listen(server);

var socketIDs = [];
var locations = [];
var inexactLocations = [];
var sockets = [];

// Setting up the express app...
app.set('view engine', 'pug');

app.listen(8080);
app.use(bodyParser.urlencoded({extended : true}));
app.use(express.static(path.join(__dirname, 'public')));

// Setting up firebase...
const admin = require("firebase-admin");
const serviceAccount = require("./pioneerhacks2-firebase-adminsdk-p9cpg-299f6c2299.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://pioneerhacks2.firebaseio.com"
});

const db = admin.firestore();
const activeRequestsReference = db.collection('ActiveLocations');
const userSettingsReference = db.collection('UserSettings');

app.get('/', (req, res) =>{
    res.send('this is not a website lol get out');
});

io.on('request', function(request) {
    var connection = request.accept(null, request.origin); 
    // console.log("connected");
    connection.on('message', function(message) {
        if (message.type === 'utf8') { 
            // console.log(message.utf8Data);
            let chunks = message.utf8Data.split('_');
            if(chunks[0] == undefined || chunks[1] == undefined || chunks[2] == undefined){
                return;
            }
            let userToken = "" + chunks[1];
            let actualToken;

            admin.auth().verifyIdToken(userToken)
            .then(function(decodedToken) {
                actualToken = decodedToken.uid;
                nextFunc();
            }).catch(function(error) {
                // can not authenticate/ use for local dev
                actualToken = new Date();
                nextFunc();

                // send message to client...
            });
            
            function nextFunc() {
                // connection.sendUTF(message.utf8Data);
                let messageCode = MESSAGE_TYPE_CODES[+chunks[0]];
                let tempLocation = chunks[2].split('-');
                let location = {
                    long: "",
                    lat: "",
                };
                if(+tempLocation[0] == null || +tempLocation[1] == null){
                    return;
                }else{
                    location.long = +tempLocation[0];
                    location.lat = +tempLocation[1];
                }
                let roundedLocation = Math.round((+location.long) * 10) / 10 + "_" + Math.round((+location.lat) * 10) / 10;
                switch(messageCode){
                    case "init":
                        //sample: 0_TOKEN_123.6234-178.1234_1,2,3
                        if(chunks[3] == undefined){
                            return;
                        }
                        // console.log(actualToken);
                        userSettingsReference.doc("" + actualToken).set({
                            options : chunks[3]
                        }).catch(error => {
                            // console.log(error);
                        });
                        activeRequestsReference.doc(roundedLocation).get().then(doc => {
                            if(!doc.exists){
                                //no one needs anything
                            }else{
                                let text = "";
                                for(var e in doc.data()){
                                    text += "" + e;
                                }
                                connection.sendUTF(doc.data()[text].location);
                                let temporaryIndex3 = socketIDs.indexOf(actualToken)
                                if(temporaryIndex3 != -1){
                                    socketIDs = socketIDs.splice(temporaryIndex3, 1);
                                    locations = locations.splice(temporaryIndex3, 1);
                                    inexactLocations = inexactLocations.splice(temporaryIndex3, 1);
                                    sockets = sockets.splice(temporaryIndex3, 1);
                                }
                                return;
                            }
                        });
                        if(socketIDs.indexOf(actualToken) == -1){
                            socketIDs.push(actualToken);    
                            locations.push(location);
                            sockets.push(connection);
                            inexactLocations.push(roundedLocation);
                        }else{
                            let index = socketIDs.indexOf(actualToken)
                            locations[index] = location;
                            inexactLocations[index] = roundedLocation;
                        }

                        break;
                    case "locationupdate":
                        //sample: 1_TOKEN_123.6234-178.1234
                        if(socketIDs.indexOf(actualToken) == -1){
                            socketIDs.push(actualToken);    
                            locations.push(location);
                            sockets.push(connection);
                            inexactLocations.push(roundedLocation);
                        }else{
                            let index = socketIDs.indexOf(actualToken)
                            locations[index] = location;
                            sockets[index] = connection;
                            inexactLocations[index] = roundedLocation;
                        }
                        break;
                    case "ineedhelp":
                        //sample: 2_TOKEN_123.6234-178.1234_1,2,3
                        // console.log(chunks[3]);
                        if(chunks[3] == undefined){
                            return;
                        }
                        // console.log(roundedLocation);
                        let temporaryIndex = inexactLocations.indexOf(roundedLocation);
                        if(temporaryIndex != -1){
                            // console.log('match');
                            let lat = locations[temporaryIndex].lat;
                            let long = locations[temporaryIndex].long;
                            sockets[temporaryIndex].sendUTF("0_"+lat+"-"+long);
                            socketIDs = socketIDs.splice(temporaryIndex, 1);
                            locations = locations.splice(temporaryIndex, 1);
                            inexactLocations = inexactLocations.splice(temporaryIndex, 1);
                            sockets = sockets.splice(temporaryIndex, 1);
                        }else{
                            var data = {
                                option: chunks[3],
                                id: actualToken || 'test',
                                location: location.lat + '_' + location.long
                            };
                            var data2 = {};
                            data2[actualToken]= data;
                            console.log(data2);
                            activeRequestsReference.get(roundedLocation).then(doc =>{
                                if(!doc.exists){
                                    activeRequestsReference.doc(roundedLocation).set(data2).catch(err =>{
                                        // send notif to dev
                                        // console.log(err);
                                    });
                                }else{
                                    activeRequestsReference.doc(roundedLocation).update(data2).catch(err => {
                                        // console.log(err);
                                        // send notif to developer
                                    });
                                }
                            });
                            
                        }
                        break;
                    case "icanhelp":
                        // notify the other person help is on the way
                        break;
                    case "cancelrequest":
                        // cancel the request
                        break;
                    case "end":
                        // mute notif for user
                        break;
                }
                // console.log(socketIDs);
                // console.log(inexactLocations);
            }
        }
        // console.log(socketIDs);
    });
    connection.on('close', function(connection) {
        let temporaryIndex = sockets.indexOf(connection);
        socketIDs = socketIDs.splice(temporaryIndex, 1);
        locations = locations.splice(temporaryIndex, 1);
        inexactLocations = inexactLocations.splice(temporaryIndex, 1);
        sockets = sockets.splice(temporaryIndex, 1);
        // console.log("disconnected.");
    });
});

// no time to implement
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; 
    var dLat = degreeToRadian(lat2-lat1); 
    var dLon = degreeToRadian(lon2-lon1); 
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    var d = R * c; // Distance in km
    return d;
}

function degreeToRadian(deg) {
    return deg * (Math.PI/180)
}


// BETA - did not work
// io.on('any', function(socket){
//     console.log('asdasd');
//     socket.emit('received', "asdasd");
// })

// server.on('connection', (socket) => {
//     console.log('connections');
// });

// // WebSocket testing..
// io.sockets.on('connection', function (socket) {
//     console.log('asdasdasdasd');
//     socket.emit('confirm', 'asdasda');
//     // console.log(socket);
//     console.log('incoming connectin');
//     socket.on('startlistening', msg => {
//         console.log("msg: " + msg);
//         let location = {
//             long: "",
//             lat: "",
//         };
//         let inexactlocation = "";
//         if(socketIDs.indexOf(socket.id) == -1){
//             socketIDs.push(socket.id);    
//             locations.push(location);
//             inexactLocations.push(inexactlocation);
//         }else{
//             let index = socketIDs.indexOf(socket.id)
//             locations[index] = location;
//             inexactLocations[index] = inexactlocation;
//         }
//         console.log(socketIDs);
//         console.log(locations);
//         // if(msg.test(/^[a-z0-9]/)){
//         // }
//     });
//     socket.on('locationupdate', msg => {
        
//     });
//     socket.on('ineedhelp', msg => {
//         console.log('asdasda');
//         activeRequestsReference.doc(roundedLocation).set({
//             id: socket.id,

//         });
//     });
//     socket.on('icanhelp', msg => {

//     });
//     socket.on('cancelrequest', msg => {
        
//     });
//     socket.on('stoplistening', msg => {
//         let index = socketIDs.indexOf(socket.id);
//         socketIDs = socketIDs.splice(index, 1);
//         locations = locations.splice(index, 1);
//     });
// });

// io.on('connection', function (socket) {
//     console.log('asdasdasdasd');
//     socket.emit('confirm', 'asdasda');
//     // console.log(socket);
//     console.log('incoming connectin');
//     socket.on('startlistening', msg => {
//         console.log("msg: " + msg);
//         let location = {
//             long: "",
//             lat: "",
//         };
//         let inexactlocation = "";
//         if(socketIDs.indexOf(socket.id) == -1){
//             socketIDs.push(socket.id);    
//             locations.push(location);
//             inexactLocations.push(inexactlocation);
//         }else{
//             let index = socketIDs.indexOf(socket.id)
//             locations[index] = location;
//             inexactLocations[index] = inexactlocation;
//         }
//         console.log(socketIDs);
//         console.log(locations);
//         // if(msg.test(/^[a-z0-9]/)){
//         // }
//     });
//     socket.on('locationupdate', msg => {
        
//     });
//     socket.on('ineedhelp', msg => {
//         console.log('asdasda');
//         activeRequestsReference.doc(roundedLocation).set({
//             id: socket.id,

//         });
//     });
//     socket.on('icanhelp', msg => {

//     });
//     socket.on('cancelrequest', msg => {
        
//     });
//     socket.on('stoplistening', msg => {
//         let index = socketIDs.indexOf(socket.id);
//         socketIDs = socketIDs.splice(index, 1);
//         locations = locations.splice(index, 1);
//     });
// });

// // activeRequestsReference.onSnapshot((snapshot) => {
// //     console.log(snapshot.docChanges()); 
// // });

// function anyoneNeedHelp(coords, callback){
//     let roundedLocation = ""; //coords.lat + "" + coords.long
//     activeRequestsReference.doc(roundedLocation).get().then(doc => {
//         if(!doc.exists){
//             callback(false);
//             return;
//         }else{
//             console.log(doc.data());
//         }
//     });
//     callback(true);
// }

// // General case
// // app.get('/', (req,res) => {
//     // res.sendFile(path.join(__dirname, '/views/index.html'));
// //     res.render('index.pug');
// // });

// // All requests come through here first
// // app.all('/api/*', (req,res,next) => {
// //     next();
// // });

// // Handles the get requests
// // app.post('/api/postLocation', (req,res) => {
// //     setResHeaderAndContents(res, 200, 'application/json');
// //     response = {
// //         body: `hello ${req.ip} from the other side`
// //     };
// //     res.json(response);
// // });

// // function setResHeaderAndContents(res, status, contentType){
// //     res.status(status);
// //     res.set('Content-Type' , contentType);
// // };