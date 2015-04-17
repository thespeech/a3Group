/*
 * MMOServer.js
 * A skeleton server for massively multiplayer space battle.
 * Assignment 3 for CS4344, AY2013/14.
 *
 * Usage: 
 *   node MMOServer.js
 */

"use strict"; 

var LIB_PATH = "./";
var INTEREST_ZONE = 200;
require(LIB_PATH + "Config.js");
require(LIB_PATH + "Ship.js");
require(LIB_PATH + "Rocket.js");
require(LIB_PATH + "Player.js");

function MMOServer() {
    // private Variables
    var nextPID = 0;  // PID to assign to next connected player 
    var ships = {};   // Associative array for ships, indexed via player ID
    var rockets = {}; // Associative array for rockets, indexed via timestamp
    var sockets = {}; // Associative array for sockets, indexed via player ID
    var players = {}; // Associative array for players, indexed via socket ID

    /*
     * private method: broadcast(msg)
     *
     * broadcast takes in a JSON structure and send it to
     * all players.
     *
     * e.g., broadcast({type: "abc", x: 30});
     */
    var broadcast = function (msg) {
        var id;
        for (id in sockets) {
            sockets[id].write(JSON.stringify(msg));
        }
    }

    /*
     * private method: broadcastUnless(msg, id)
     *
     * broadcast takes in a JSON structure and send it to
     * all players, except player id
     *
     * e.g., broadcast({type: "abc", x: 30}, pid);
     */
    var broadcastUnless = function (msg, pid) {
        var id;
        for (id in sockets) {
            if (id != pid)
                sockets[id].write(JSON.stringify(msg));
        }
    }

    /*
     * private method: unicast(socket, msg)
     *
     * unicast takes in a socket and a JSON structure 
     * and send the message through the given socket.
     *
     * e.g., unicast(socket, {type: "abc", x: 30});
     */
    var unicast = function (socket, msg) {
        socket.write(JSON.stringify(msg));
    }

    /*
     * private method: newPlayer()
     *
     * Called when a new connection is detected.  
     * Create and init the new player.
     */
    var newPlayer = function (conn) {
        nextPID ++;
        // Create player object and insert into players with key = conn.id
        players[conn.id] = new Player();
        players[conn.id].pid = nextPID;
        sockets[nextPID] = conn;
    }

	var InterestAreaLoop = function() {
		var i;
		var j;
		for(i in ships) {
			ships[i].recordLastXY();
			ships[i].moveOneStep();
		} //Move every ship one step first.
		for(i in rockets) {
			rockets[i].recordLastXY();
			rockets[i].moveOneStep(); //Normal sim code for rockets
			if(rockets[i].x < 0 || rockets[i].x > Config.WIDTH ||
			   rockets[i].y < 0 || rockets[i].y > Config.HEIGHT) {
				rockets[i] = null;
				delete rockets[i];
			} else {
				for(j in ships) { //Send hit notifications only to ships within INTEREST_ZONE pixels of the rocket
					if(rockets[i]!=undefined && rockets[i].from != j) {
						if(rockets[i].hasHit(ships[j])) {
							if((Math.abs(ships[j].x-rockets[i].x)<INTEREST_ZONE) &&
							   (Math.abs(ships[j].y-rockets[i].y)<INTEREST_ZONE)) {
								//Ship index==player pid==socket index for that player
								//If the rocket is near the ship, send the hit to the ship that was hit
								unicast(sockets[j],{type:"hit", rocket:i, ship:j});
								//And the ship who did the hitting
								unicast(sockets[rockets[i].from],{type:"hit", rocket:i, ship:j});
							}
							delete rockets[i]; //Get rid of the rockets which have hit.	
						}
					}
				}
			}
		}
		//After all the movement and checking for hits
		//If ships just intersect their interest zone, update them.

		for(i in ships) {	
			for(j in ships) { //Frame rate 40, therefore bullets move at 0.05 per frame. Set 2 frames to avoid problems.
				if(i!==j)
				{
					console.log("Last x distance: ",Math.ceil(Math.abs(ships[i].x - ships[j].realLastX))," Current x distance: ",Math.floor(Math.abs(ships[i].x - ships[j].x)));
				if(((Math.abs(ships[i].y - ships[j].y) < INTEREST_ZONE)&&(Math.floor(Math.abs(ships[i].x - ships[j].x) < INTEREST_ZONE) &&
																		  (Math.ceil(Math.abs(ships[i].x - ships[j].realLastX)) >= INTEREST_ZONE))) ||
				   ((Math.abs(ships[i].x - ships[j].x) < INTEREST_ZONE)&&(Math.floor(Math.abs(ships[i].y - ships[j].y) < INTEREST_ZONE) &&
																		  (Math.ceil(Math.abs(ships[i].y - ships[j].realLastY)) >= INTEREST_ZONE)))) { //If in interest zone and has just crossed interest zone
						console.log("New ship spawning.");
				unicast(sockets[i], {type: "new",
									 id: j,
									 x: ships[j].x,
									 y: ships[j].y,
									 dir: ships[j].dir}); //Send ships just coming into interest zone. new still spawns new ships, but have client remove them when out of range.
				}
				}
			}
			//If rockets intersect the interest zone, update them.
			for(var k in rockets) {
				if(((Math.abs(rockets[k].y - ships[i].y) < INTEREST_ZONE) && ((Math.abs(rockets[k].x - ships[i].x) < INTEREST_ZONE+20) &&
																			  (Math.abs(rockets[k].x - ships[i].x) > INTEREST_ZONE))) ||
				   ((Math.abs(rockets[k].x - ships[i].x) < INTEREST_ZONE) && ((Math.abs(rockets[k].y - ships[i].y) < INTEREST_ZONE+20) &&
																			  (Math.abs(rockets[k].y - ships[i].y) > INTEREST_ZONE)))){ //If in interest zone and has just crossed interest zone
						console.log("Rocket fire to send.");
						unicast(sockets[i], {type:"fire",
													 ship: rockets[k].from,
													 rocket: k,
													 x: rockets[k].x,
													 y: rockets[k].y,
													 dir: rockets[k].dir});

				}
		}
		}

	}


    /*
     * private method: gameLoop()
     *
     * The main game loop.  Called every interval at a
     * period roughly corresponding to the frame rate 
     * of the game
     */
    var gameLoop = function () {
		InterestAreaLoop(); //Localizes bullet impact messages.
	}

    /*
     * priviledge method: start()
     *
     * Called when the server starts running.  Open the
     * socket and listen for connections.  Also initialize
     * callbacks for socket.
    */
    this.start = function () {
        try {
            var express = require('express');
            var http = require('http');
            var sockjs = require('sockjs');
            var sock = sockjs.createServer();

            // Upon connection established from a client socket
            sock.on('connection', function (conn) {
                newPlayer(conn);

                // When the client closes the connection to the 
                // server/closes the window
                conn.on('close', function () {
                    var pid = players[conn.id].pid;
                    delete ships[pid];
                    delete players[conn.id];
                    broadcastUnless({
                        type: "delete", 
                        id: pid}, pid)
                });

                // When the client send something to the server.
                conn.on('data', function (data) {
                    var message = JSON.parse(data)
                    var p = players[conn.id];
                    if (p === undefined) {
                        // we received data from a connection with
                        // no corresponding player.  don't do anything.
                        console.log("player at " + conn.id + " is invalid."); 
                        return;
                    } 
                    switch (message.type) {
                        case "join":
                            // A client has requested to join. 
                            // Initialize a ship at random position
                            // and tell everyone.
                            var pid = players[conn.id].pid;
                            var x = Math.floor(Math.random()*Config.WIDTH);
                            var y = Math.floor(Math.random()*Config.HEIGHT);
                            var dir;
                            var dice = Math.random();
                            // pick a dir with equal probability
                            if (dice < 0.25) {
                                dir = "right";
                            } else if (dice < 0.5) {
                                dir = "left";
                            } else if (dice < 0.75) {
                                dir = "up";
                            } else {
                                dir = "down";
                            }
                            ships[pid] = new Ship();
                        ships[pid].init(x, y, dir);
						unicast(sockets[pid], {
                                type: "join",
                                id: pid,
                                x: x,
                                y: y,
                            dir: dir});   //Send join signal to the new guy.
						
						for(var i in ships)
						{
							if(i != pid)
							{
							if((Math.abs(ships[i].x-x)<INTEREST_ZONE) &&
							   (Math.abs(ships[i].y-y)<INTEREST_ZONE)) {
								unicast(sockets[i], {type: "new",
													 id: pid,
													 x: x,
													 y: y,
													 dir: dir}); //Signal only ships in interest radius
								unicast(sockets[pid], {type: "new",
													   id: i,
													   x: ships[i].x,
													   y: ships[i].y,
													   dir: ships[i].dir}); //Signal new guy for ships in interest radius only.
									   } 
							}

						} 

                            
                            break;

					case "turn":
                            // A player has turned.  Tell everyone else within interest area
                            var pid = players[conn.id].pid;
                            ships[pid].jumpTo(message.x, message.y); //Teleport the ship just in case its out of sync - from client to server
                        ships[pid].turn(message.dir);
						for(var i in ships)
						{
							if(i != pid)
							{
							if((Math.abs(ships[i].x-message.x)<INTEREST_ZONE) &&
							   (Math.abs(ships[i].y-message.y)<INTEREST_ZONE)) {
								unicast(sockets[i], {type: "turn",
													 id: pid,
													 x: message.x,
													 y: message.y,
													 dir: message.dir
													}, pid);
							}
							}
						} //Send turn messages only to ships within interest range.
							
                            break;

                        case "fire":
                            // A player has asked to fire a rocket.  Create
                            // a rocket, and tell everyone (including the player, 
                            // so that it knows the rocket ID).
                            var pid = players[conn.id].pid;
                            var r = new Rocket();
                            r.init(message.x, message.y, message.dir, pid);
                            var rocketId = new Date().getTime();
                        rockets[rocketId] = r;
						for(var i in ships)
						{
							if((Math.abs(ships[i].x-rockets[rocketId].x)<INTEREST_ZONE) &&
							   (Math.abs(ships[i].y-rockets[rocketId].y)<INTEREST_ZONE)) { //Send fire events only for ships within interest area
								unicast(sockets[i], {type:"fire",
													 ship: pid,
													 rocket: rocketId,
													 x: message.x,
													 y: message.y,
													 dir: message.dir});
							}
						}
                            break;
                            
                        default:
                            console.log("Unhandled " + message.type);
                    }
                }); // conn.on("data"
            }); // socket.on("connection"

            // cal the game loop
            setInterval(function() {gameLoop();}, 1000/Config.FRAME_RATE); 

            // Standard code to start the server and listen
            // for connection
            var app = express();
            var httpServer = http.createServer(app);
            sock.installHandlers(httpServer, {prefix:'/space'});
            httpServer.listen(Config.PORT, Config.SERVER_NAME);
            app.use(express.static(__dirname));
            console.log("Server running on http://" + Config.SERVER_NAME + 
                    ":" + Config.PORT + "\n")
            console.log("Visit http://" + Config.SERVER_NAME + ":" + Config.PORT + "/index.html in your browser to start the game")
        } catch (e) {
            console.log("Cannot listen to " + Config.PORT);
            console.log("Error: " + e);
        }
    }
}

// This will auto run after this script is loaded
var server = new MMOServer();
server.start();

// vim:ts=4:sw=4:expandtab
