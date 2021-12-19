const { EventEmitter } = require("stream");
const awaitOperation = require("../lib/awaitOperation");

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
	 * Returns instances IP on bridge
	 * @param {"ipv4"|"ipv6"} family
	 * @returns {Promise<string>}
	 */
	async ip(family) {
		var data = await this.client.get("/1.0/instances/" + this._name + "/state")
		if (family == "ipv4") {
			return data.metadata.network.eth0.addresses.find(val => val.family == "inet").address
		} else if (family == "ipv6") {
			return data.metadata.network.eth0.addresses.find(val => val.family == "inet6").address
		}
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
	 * @param {string[]} command 
	 * @param {object} options
	 * @param {{}?} options.env
	 * @param {string?} options.cwd
	 * @param {number?} options.user
	 * @param {boolean?} options.interactive
	 * @returns {import('ws').WebSocket | string}
	 */
	exec(command, options) {
		if (!options) var options = {}
		return new Promise(async (resolve, reject) => {
			try {
				var data = await this.client.post("/1.0/instances/" + this._name + "/exec", {
					"command": command,
					"environment": options.env ? options.env : {},
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
							str += d + '\n'
						}
					})
				}
				

			} catch (error) {
				reject(error)
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
	 * @param {{endpoint: "exec" | "console", command: string[], env: {}}} options
	 * @returns {Promise<{operation: WebSocket, proxy: function(WebSocket): {send: function(string)}}>}
	 */
	async console(type, options) {
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
							}
						);

						break;
					case "console":
						if (options.endpoint == "console") {
							var data = await this.client.post("/1.0/instances/" + this._name + "/console", {
								"height": 24,
								"type": "console",
								"width": 80
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
								}
							);
						} else {
							var data = await this.client.post("/1.0/instances/" + this._name + "/console", {
								"height": 24,
								"type": "console",
								"width": 80
							})
							// 
						}

						break;

					default:
						break;
				}

				console.log(JSON.stringify(data.data));
				var r = await this.client.ws(
					data.data.operation +
					"/websocket?secret=" +
					data.data.metadata.metadata.fds["0"]
				)
				/**
				 * 
				 * @param {import('ws').WebSocket} ws 
				 * @param {function(ws)} auth
				 * @returns {{send: <Function(command:string)>}}
				 */
				var proxy = (ws) => {
					ws.on('message', (data) => {
						r.send(data, { binary: true })
					})
					r.on('message', (data) => {
						ws.send(data, { binary: true })
					})
					return {
						send: function (command) {
							r.send(command + '\n', { binary: true })
						}
					};
				}
				resolve(
					{ proxy: proxy, operation: r }
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
				console.log(res)
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
			} catch (error) {
				reject(error)
			}
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
