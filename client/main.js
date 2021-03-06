const Tools = require('./../globals/tools.js')
const Socket = require ('net');
const JsonSocket = require('json-socket');
const Sebastian = require('./sebastian.js');
const { spawn, spawnSync,fork } = require('child_process');
const SMS = require('./../globals/sms.js');

const path = process.env.HOME + "/deku/whoami.env";
require('dotenv').config({path: path.toString()})
'use strict';

//TODO: start pm2 manually and keep restarting using name in app
//TODO: start pm2 with app and keep restarting it


const TCP_HOST_NAME = process.env.TCP_HOST_NAME;
const TCP_HOST_PORT = process.env.TCP_HOST_PORT;
const CLIENT_TOKEN = process.env.CLIENT_TOKEN;
const CLIENT_UUID = process.env.CLIENT_UUID;
const APP_TYPE = process.env.APP_TYPE.split(',')

console.log("DEKU SYSTEM INFORMATION----");
console.log("TCP_HOST_NAME: ", TCP_HOST_NAME);
console.log("TCP_HOST_PORT: ", TCP_HOST_PORT);
console.log("CLIENT_TOKEN: ", CLIENT_TOKEN);
console.log("CLIENT_UUID: ", CLIENT_UUID);
console.log("APP_TYPE: ", APP_TYPE);

if(typeof TCP_HOST_NAME != "undefined" &&
	typeof TCP_HOST_PORT != "undefined" &&
	typeof CLIENT_TOKEN != "undefined" &&
	typeof CLIENT_UUID != "undefined" &&
	typeof APP_TYPE != "undefined" &&
	TCP_HOST_NAME != "" &&
	CLIENT_TOKEN != "" &&
	CLIENT_UUID != "" &&
	APP_TYPE.length > 0 ) {
	console.log("SYSTEM RATING=> Everything is set for takeoff!!");
}
else {
	console.log("SYSTEM RATING=> Not clear for takeoff, this means death... so sorry...");
	process.exit(1);
}

let startScript = async ( sebastian )=>{
//Let's begin, le dance macabre
	var sms = new SMS;
	var socket = new JsonSocket(new Socket.Socket());

	var startSocketConnection = ()=> {
		console.log('state=> starting socket connection....');
		const options = {
			host : TCP_HOST_NAME,
			port : TCP_HOST_PORT
		}

		socket.connect(options, function(){
			console.log("socket.connect=> connected..."); 
			socket.sendMessage({
				type:"auth", 
				clientToken:CLIENT_TOKEN, 
				UUID:CLIENT_UUID,
				appType:APP_TYPE
			});

			//XXX: Always test to make sure there's an active internet connection
			var CronJob = require('cron').CronJob;
			var connectivity = require('connectivity');
			var Chalk = require('chalk');
			var cron = new CronJob('*/5 * * * * *', ()=> {
				connectivity( (online) => {
					  if (online) {
						//console.log("%s", Chalk.bgGreen(`${Chalk.black('state=> connected to the internet!')}`))
					  } else {
						console.log("%s", Chalk.bgRed(`${Chalk.white('state=> sorry, not connected to the internet')}`))
						if(sms.isEmpty()) {
							cron.stop();
							socket = null;
							sebastian.emit("safemenow!", sebastian);
						}
						else {
							console.log("state=> cannot restart because of an ongoing job");
						}
					  }
				})

				if( socket.destroyed ) {
					console.log("state=> unstable internet connection, trying to hook up with backup internet");
					cron.stop();
					socket = null;
					sebastian.emit("safemenow!", sebastian);
				}
				else {
					socket.sendMessage({
						"type": "confirmation"
					});
				}
			}, null, true);


			let options = {
				port : 3000
			}
			let localServerListener = require('express')();
			const bodyParser = require('body-parser')

			//localServerListener.use(bodyParser.json({limit: '50mb'}));
			localServerListener.use( bodyParser.text() );
			localServerListener.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

			localServerListener.listen(options, ()=>{
				console.log("localServerListener.listen=> listening on port %d", options.port);
			});


			localServerListener.post("/deku_daemon/message", (req, res) => {
				console.log("localServerListener=> ");
				console.log(req.body);
				socket.sendMessage({
					"type":"confirmation",
					"CLIENT_TOKEN":CLIENT_TOKEN,
					"CLIENT_UUID":CLIENT_UUID,
					"terminalMessage":req.body
				});
				res.end();
			});


		});
	}

	let mysqlConnection = await Tools.mysql_connection();

	startSocketConnection();
	socket.on('error', async ( error ) => {
		console.log("socket.error=> [", error.code, "]", error.message);

		switch( error.code ) {
			case 'ENOTFOUND':
				console.log("socket.error=> check internet connection!");
				await Tools.sleep();
				socket = null;
				sebastian.emit("safemenow!", sebastian);
				return;
			break;

			case 'ENOENT':
				console.log("socket.error=> check configuration parameters... possibly wrong settings");
				await Tools.sleep();
				socket = null; //This is murder!!
				sebastian.emit("safemenow!", sebastian);
				return;
			break;

			case 'ECONNREFUSED':
				console.log("socket.error=> server doesn't seem to be running, check port or call devs");
				await Tools.sleep();
				socket = null; //This is murder!!
				sebastian.emit("safemenow!", sebastian);
				return;
			break;

			case 'ENETUNREACH':
				console.log("socket.error=> internet cannot resolve host information, possibly server is malfunctioning");
				socket = null;
				await Tools.sleep();
				sebastian.emit("safemenow!", sebastian);
				return;
			break;


			case 'ECONNRESET':
				console.log("socket.error=> TCP abrupt termination of connection, if this continues call devs");
				await Tools.sleep();
				socket = null; //This is murder!!
				sebastian.emit("safemenow!", sebastian);
				return;
			break;

			case 'EADDRNOTAVAIL':
				console.log("socket.error=> most probably running from a mac laptop or why don't you have localhost??");
				await Tools.sleep();
				socket = null;
				sebastian.emit("safemenow!", sebastian);
				return

			default:
				console.log("socket.error=> unregistered error", error.message, error.code);
				socket = null;
				sebastian.emit("safemenow!", sebastian);
			break;
		}
	});


	socket.on('message', (data ) => {
		console.log("socket.message=> new message...");
		try {
			if(typeof data.type !== undefined) {
				switch( data.type ) {
					case "terminal":
						console.log("socket.message=> running a config command");
						let terminalType = data.payload.terminalType;
						switch( terminalType ) {
							case "update":
								console.log("socket.message.terminal=> received command for update");
								sebastian.update();
							break;

							case "reload":
								console.log("socket.message.reload=> received command for reload");
							break;
						}
					break;

					case "sms":
						console.log("socket.message=> SMS requested...");
						try {
							sms.sendBulkSMS(data.payload).then((resolve, reject)=>{
								try {
									socket.sendMessage({
										"type" : "confirmation",
										"CLIENT_TOKEN" : CLIENT_TOKEN,
										"CLIENT_UUID" : CLIENT_UUID,
										"DATA_TYPE" : data.type,
										"MESSAGE" : "finished forwarding a bulk message",
										"RESOLVE" : resolve
									})
								}
								catch(error) {
									console.log("socket.message.error=>", error.message);
								}
							});
						}
						catch(error) {
							console.log("socket.message.error=>", error.message);
						}
					break;

					default:
						console.log("socket.message=> running default state for:", data.type);
						let options = {
							detached: true,
							stdio : ['inherit', 'inherit', 'inherit']
						}
						const newProcess = spawn(data.type, data.payload, options);
						newProcess.unref();
					break;
				}
			}
			else {
				throw new Error("unknown request type");
			}
		}
		catch(error) {
			console.log("socket.message.error=> ", error.message);
		}
	})

	socket.on('close', async ( hadError )=> {
		switch( hadError ){
			case true:
				console.log("socket.close=> failed due to transmission error, check internet connection");
				socket = null;
				await Tools.sleep();
				sebastian.emit("safemenow!", sebastian);
			break;

			case false:
				console.log("socket.close=> was murdered by the server.... call Sherlock (Holmes)");
				socket = null;
				await Tools.sleep();
				sebastian.emit("safemenow!", sebastian);
			break;

			default:
				console.log("socket.close=> I'm just confused now....");
			break;
		}
	});
}


var sebastian = new Sebastian;
startScript(sebastian);
sebastian.on("safemenow!", sebastian.restart);
//TODO: Add important things to process file
