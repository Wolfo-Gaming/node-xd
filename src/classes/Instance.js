const { match } = require("assert");
const { EventEmitter } = require("events");
const awaitOperation = require("../lib/awaitOperation");
var fs = require('fs')
function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
class Instance {
	/**
	 * @returns {string}
	 */
	name() {
		return this._name;
	}
	/**
	 * @returns {{key: string, data: string}[]}
	 */
	config() {
		var conf = [];
		Object.keys(this._metadata.meta.expanded_config).forEach((el) => {
			conf.push({ key: el, data: this._metadata.meta.expanded_config[el] });
		});
		return conf;
	}
	/**
	 * Gets the current state of the instance
	 * @returns {Promise<"Running"|"Stopped">}
	 */
	async state() {
		return (await this.client.get("/1.0/instances/" + this._name + "/state"))
			.metadata.status;
	}
	/**
	 * Gets the type of the instance
	 * @returns {"container" | "virtual-machine"}
	 */
	type() {
		return this._metadata.meta.type;
	}
	/**
	 * 
	 * @param {string} path 
	 * @param {fs.WriteStream} writeStream 
	 */
	download(path, writeStream) {
		return new Promise(async (resolve, reject) => {
			if (!path) throw new Error('Path not defined')
			var events = new EventEmitter()
			const url = encodeURI("/1.0/instances/" + this._name + "/files?path=" + path)
			const { data, headers } = await this.client.axios({
				url,
				method: 'GET',
				responseType: 'stream'
			})
			events.emit('open')
			const totalLength = headers['content-length']
			var done = 0
			if (data.headers["content-type"] == "application/json") {
				data.on('data', (chunk) => {
					resolve({
						type: 'dir',
						list: JSON.parse(chunk.toString()).metadata
					})
				})

			} else {
				data.on('data', (chunk) => {
					done += chunk.length;
					var percent = (done * 100) / parseFloat(totalLength)
					var progress = {
						bytes: {
							sent: done,
							total: parseFloat(totalLength)
						},
						percent: percent
					}
					events.emit('progress', progress)
					if (progress.percent == 100) {
						events.emit('finish')
					}
				})
				data.pipe(writeStream)
				resolve({ type: 'file', events })
			}
		})


	}
	/**
	 * Upload file to instance
	 * @param {fs.ReadStream} ReadStream 
	 * @param {string} destPath 
	 * @returns {EventEmitter}
	 */
	upload(ReadStream, destPath) {
		return new Promise(async (resolve, reject) => {
			var events = new EventEmitter()
			var https = require('https')
			var parsedURL = new URL(this.rootClient.host)
			if (this.rootClient.connectionType == "unix") {
				var opts = {
					rejectUnauthorized: false,
					method: "POST",
					socketPath: this.rootClient.unixpath,
					path: encodeURI("/1.0/instances/" + this._name + "/files?path=" + destPath),
					headers: {
						"Content-Type": `application/octet-stream`
					},
				}
			} else if (this.rootClient.connectionType == "http") {
				var opts = {
					cert: this.rootClient.cert,
					key: this.rootClient.key,
					rejectUnauthorized: false,
					method: "POST",
					hostname: parsedURL.hostname,
					port: parsedURL.port,
					path: encodeURI("/1.0/instances/" + this._name + "/files?path=" + destPath),
					headers: {
						"Content-Type": `application/octet-stream`
					},
				}
			}
			var request = https.request(opts, function (response) {
				response.on('error', (err) => {
					reject(err)
				})
			});
			request.on('error', error => {
				reject(error)
			})
			var bytes = 0
			var size = fs.lstatSync(ReadStream.path).size;
			ReadStream.on('data', (chunk) => {
				bytes += chunk.length;
				var percent = ((bytes) * 100) / size
				var data = {
					bytes: {
						sent: bytes,
						total: size
					},
					percent: percent
				}
				events.emit('progress', data)
				if (data.percent == 100) {
					events.emit("finish")
				}
			}).pipe(request)
			resolve(events)
		})

	}
	/**
	 * Returns instances IP on bridge
	 * @param {"ipv4"|"ipv6"} family
	 * @returns {Promise<string>}
	 */
	async ip(family) {
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.get("/1.0/instances/" + this._name + "/state")
				if (!family) {
					resolve(data.metadata.network.eth0.addresses.find(val => val.family == "inet").address)
				} else if (family == "ipv4") {
					resolve(data.metadata.network.eth0.addresses.find(val => val.family == "inet").address)
				} else if (family == "ipv6") {
					resolve(data.metadata.network.eth0.addresses.find(val => val.family == "inet6").address)
				}
			} catch (error) {
				reject(error)
			}
		})
	}
	async stop(force) {
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.put(
					"/1.0/instances/" + this._name + "/state",
					{
						action: "stop",
						force: force ? force : false,
						stateful: false,
						timeout: 30,
					}
				);
				if (data.metadata.err == "The instance is already stopped")
					return resolve();
				await awaitOperation(this.rootClient, data.metadata.id);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
	/**
	 * 
	 * @param {string} command 
	 * @param {object} options
	 * @param {{}?} options.env
	 * @param {string?} options.cwd
	 * @param {number?} options.user
	 * @param {boolean?} options.interactive
	 * @returns {Promise<import('ws').WebSocket | string>}
	 */
	exec(command, options) {
		if (!options) var options = {}
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.post("/1.0/instances/" + this._name + "/exec", {
					"command": command.split(' '),
					"environment": options.env ? options.env : { TERM: "linux" },
					"interactive": true,
					"wait-for-websocket": true,

				})
				var r = await this.client.ws(
					data.data.operation +
					"/websocket?secret=" +
					data.data.metadata.metadata.fds["0"]
				)
				//await awaitOperation(this.rootClient, data.data.metadata.id)
				if (options.interactive == true) {
					r.on('message', (d) => {
						if (d == "") {
							r.close()
						}
					})
					resolve(r)
				} else {
					var str = ""
					function exit() {
						r.close()
						resolve(str)
					}
					r.on("message", async (d) => {
						if (d == "") {
							exit()
						} else {
							str += d
						}
					})
				}
			} catch (error) {
				reject(error)
			}
		})
	}
	async usage(system) {
		return new Promise(async (resolve, reject) => {
			var state = await this.client.get("/1.0/instances/" + this._name + "/state")
			if (state.metadata.status == "Running") {
				var os = require('os')
				if (system == true) {
					var cpuCount = os.cpus().length
				} else {
					var s = (await this.client.get("/1.0/instances/" + this._name)).metadata.config["limits.cpu"]
					var cpuCount = s ? s : os.cpus().length; // thats probs why i did / 2
				}
				var multiplier = 100000 / cpuCount
				var startTime = Date.now()
				var usage1 = ((await this.client.get("/1.0/instances/" + this._name + "/state")).metadata.cpu.usage / 1000000000)
				var usage2 = ((await this.client.get("/1.0/instances/" + this._name + "/state")).metadata.cpu.usage / 1000000000)
				var cpu_usage = ((usage2 - usage1) / (Date.now() - startTime)) * multiplier
				if (cpu_usage > 100) {
					cpu_usage = 100;
				}
				resolve({
					state: state.metadata.status,
					cpu: (cpu_usage),
					swap: {
						usage: (state.metadata.memory.swap_usage * 0.00000095367432)
					},
					memory: {
						usage: (state.metadata.memory.usage),
						percent: (((state.metadata.memory.usage / os.totalmem()) * 100))
					},
					disk: {
						usage: state.metadata.disk ? state.metadata.disk.root ? state.metadata.disk.root.usage : 0 : 0
					}
				})
			} else {
				resolve({
					state: state.metadata.status,
					cpu: 0,
					swap: {
						usage: 0
					},
					memory: {
						usage: 0,
						percent: 0
					},
					disk: {
						usage: state.metadata.disk ? state.metadata.disk.root ? state.metadata.disk.root.usage : 0 : 0
					}
				})
			}



		})

	}
	async start(force) {
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.put(
					"/1.0/instances/" + this._name + "/state",
					{
						action: "start",
						force: force ? force : false,
						stateful: false,
						timeout: 30,
					}
				);
				if (data.metadata.err == "The instance is already running")
					return resolve();

				await awaitOperation(this.rootClient, data.metadata.id);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
	/**
	 * Creates new console websocket (sending commands over text websocket must be sent as binary)
	 * @param {"vga"|"console"} type
	 * @param {{endpoint: "exec" | "console", command: string[], env: {},raw:{}}} options
	 * @returns {Promise<{operation: WebSocket,control: WebSocket, proxy: function(WebSocket): {send: function(string), close: function(), removeAllListeners: function()}, proxyctrl: function(WebSocket): {send: function(string), close: function(), removeAllListeners: function()}}>}
	 */
	async console(type, options) {
		if (!options.raw) options.raw = {}
		return new Promise(async (resolve, reject) => {
			try {
				switch (type) {
					case "vga":
						var data = await this.client.post(
							"/1.0/instances/" + this._name + "/console",
							{
								height: 0,
								type: "vga",
								width: 0,
								...options.raw
							}
						);
						break;
					case "console":
						if (options.endpoint == "console") {
							var data = await this.client.post("/1.0/instances/" + this._name + "/console", {
								"height": 24,
								"type": "console",
								"width": 80,
								...options.raw
							})
							// use console endpoint instead of exec, both work
						} else if (options.endpoint == "exec") {
							var data = await this.client.post(
								"/1.0/instances/" + this._name + "/exec",
								{
									command: options.command ? options.command : ["/bin/bash"],
									environment: {
										TERM: "linux",
										...options.env
									},
									interactive: true,
									"wait-for-websocket": true,
									...options.raw
								}
							);
						} else {
							var data = await this.client.post("/1.0/instances/" + this._name + "/console", {
								"height": 24,
								"type": "console",
								"width": 80,
								...options.raw
							})
							// 
						}
						break;
					default:
						break;
				}
				//console.log(data.data)
				//if (!data.data.operation || data.data.metadata.metadata.fds["0"] || data.data.metadata.metadata.fds["control"]) return reject(new Error('Operation failed to start'))
				try {
					var r = await this.client.ws(
						data.data.operation +
						"/websocket?secret=" +
						data.data.metadata.metadata.fds["0"]
					)
					var ctrl = await this.client.ws(
						data.data.operation +
						"/websocket?secret=" +
						data.data.metadata.metadata.fds["control"]
					)
				} catch (error) {
					return reject(new Error('Failed to connect to operation'))
				}

				/**
				 * 
				 * @param {import('ws').WebSocket} ws 
				 * @param {function(ws)} auth
				 * @returns {{send: <Function(command:string)>}}
				 */
				var proxyctrl = (ws) => {
					ws.on('message', (data) => {
						ctrl.send(data, { binary: true })
					})
					var s = (data) => {
						ws.send(data, { binary: true })
					}
					ctrl.on('message', s)
					return {
						send: function (command) {
							ws.send(command + '\n', { binary: true })
						},
						close: function () {
							ctrl.removeListener("message", s)
							ws.close()
						},
						removeAllListeners: function () {
							ctrl.removeListener("message", s)
						},
					};
				}
				var proxy = (ws) => {
					ws.on('message', (data) => {
						r.send(data, { binary: true })
					})
					var s = (data) => {
						ws.send(data, { binary: true })
					}
					r.on('message', s)
					return {
						send: function (command) {
							ws.send(command + '\n', { binary: true })
						},
						close: function () {
							r.removeListener("message", s)
							ws.close()
						},
						removeAllListeners: function () {
							r.removeListener("message", s)
						},
					};
				}
				resolve(
					{ proxy: proxy, operation: r, control: ctrl, proxyctrl }
				);
			} catch (error) {
				reject(error);
			}
		});
	}
	async delete() {
		return new Promise(async (resolve, reject) => {
			try {
				var res = await this.client.delete('/1.0/instances/' + this._name)
				await awaitOperation(this.rootClient, res.data.metadata.id)
			} catch (error) {
				reject(error)
			}
			resolve()
		})
	}
	/**
	 * 
	 * @param {string} name 
	 * @returns {Promise<EventEmitter>}
	 */
	async scheduleBackup(name) {
		return new Promise(async (resolve, reject) => {
			if (!name) reject('no backup name specified')
			try {
				var res = await this.client.post('/1.0/instances/' + this._name + '/backups', {
					"compression_algorithm": "gzip",
					"container_only": false,
					"instance_only": false,
					"name": name,
					"optimized_storage": true
				})
				var s = new (require('events')).EventEmitter
				var eventsws = await this.client.ws('/1.0/events?type=operation')
				eventsws.on('message', (datam) => {
					var datap = JSON.parse(datam.toString());
					if (datap.metadata.id == res.data.metadata.id)
						s.emit('finish', datap)

				})
				resolve(s)
				await awaitOperation(this.rootClient, res.data.metadata.id)
				s.emit("completed")
			} catch (error) {
				reject(error)
			}
		})


	}
	async deleteBackup(backup) {
		return new Promise(async (resolve, reject) => {
			try {
				await this.client.delete("/1.0/instances/" + this._name + "/backups/" + backup);
			} catch (error) {
				return reject(error);
			}
			return resolve("Success");
		})
	}
	/**
	 * 
	 * @param {*} backup 
	 */
	async downloadBackup(backup, pipe) {
		return new Promise(async (resolve, reject) => {
			var events = new EventEmitter();
			try {
				var { data, headers } = await this.client.axios({
					url: "/1.0/instances/" + this._name + "/backups/" + backup + "/export",
					method: 'GET',
					responseType: 'stream'
				});
			} catch (error) {
				reject(error);
			}
			events.emit("open");
			var length = headers["content-length"]
			var done = 0;
			data.on('data', (chunk) => {
				done += chunk.length;
				events.emit("progress", done / length);
			});
			data.on('end', () => {
				events.emit("finish");
				console.log(events)
				resolve(data);
			});
			data.on('error', (error) => {
				events.emit("error", error);
				reject(error);
			});
			data.pipe(pipe);
		})
	}
	/**
	 *
	 * @returns {Promise<string>}
	 */
	async logs() {
		return this.client.get("/1.0/instances/" + this._name + "/logs");
	}
	restart(force) {
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.put(
					"/1.0/instances/" + this._name + "/state",
					{
						action: "restart",
						force: force ? force : false,
						stateful: false,
						timeout: 30,
					}
				);
				await awaitOperation(this.rootClient, data.metadata.id);
				resolve();
			} catch (error) {
				reject(error);
			}
		});
	}
	/**
	 * @param {import('./Client')} self
	 */
	constructor(self, data) {

		/**
		 * @private
		 */
		this._metadata = data;
		/**
		 * @private
		 */
		this._name = data.meta.name;
		/**
		 * @private
		 * @type {import('../lib/RequestClient')}
		 */
		this.client = self.client;
		/**
		 * @private
		 * @type {import('./Client')}
		 */
		this.rootClient = self;
	}
}
module.exports = Instance;
