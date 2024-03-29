const RequestClient = require('../lib/RequestClient')
const ws = require('ws')
const Instance = require('./Instance')
const awaitOperation = require("../lib/awaitOperation");
const EventEmitter = require('events').EventEmitter;
const Network = require('./Network');
const { default: axios } = require('axios');
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

class Client {
  /**
   * Gets LXD Info
   * @returns {Promise<import('../types/types').Info.RootObject>}
   */
  info() {
    return this.client.get('/1.0')
  }

  /**
   * Gets LXD's Event websocket
   * @param {"operation"|"logging"|"lifecycle"} type Operation type
   * @returns {Promise<ws>} Operation Websocket
   */
  events(type) {
    if (!type) {
      return this.client.ws('/1.0/events')
    } else {
      return this.client.ws('/1.0/events?type=' + type)
    }
  }
  /**
   * Gets the nodes resource information
   * @returns {Promise<import('../types/types').Resources.Metadata>}
   */
  resources() {
    return new Promise(async (resolve, reject) => {
      try {
        var data = await this.client.get('/1.0/resources')
      } catch (error) {
        reject(error)
      }
      resolve(data.metadata)
    })
  }
  async usage() {
    return new Promise(async (resolve, reject) => {
      var instances = await this.instances()
      var systemCPU = 0
      var systemRAMPercent = 0
      var systemRAM = 0
      var instancesUsage = await Promise.all(instances.map(async instance => {
        var usage = await instance.usage(true)
        systemCPU += usage.cpu
        systemRAMPercent += usage.memory.percent
        systemRAM += usage.memory.usage
        return {
          type: instance.type(),
          name: instance.name(),
          usage: usage
        }
      }))
      resolve({
        system: {
          memory: {
            percent: systemRAMPercent,
            usage: systemRAM
          },
          cpu: systemCPU
        },
        instances: instancesUsage
      })
    })
  }
  /**
   * Gets all available images
   * @param {string?} os OS to filter
   * @param {{
   *    server: string,
   *    protocol: "lxd" | "simplestreams"
   * }} options
   * @returns {Promise<string[]>} Array of images "(name)/(version)"
   */
  images(options) {
    return new Promise(async (resolve, reject) => {
      if (options.protocol == "simplestreams") {

        var s = await this.client.get(`https://uk.lxd.images.canonical.com/streams/v1/images.json`)
        var products = s.products;
        var productsKeys = Object.keys(s.products)
        var filterProducts = productsKeys.map((product) => {
          return products[product]
        })
        var ppp = {}
        var a = filterProducts.map((product) => {
          var vm = false

          if (product.variant == "default") {
            var k = Object.keys(product.versions)
            for (const pro of k) {
              var d = product.versions[pro];
              console.log(d.items["root.squashfs"])
              if (d.items["root.squashfs"]) {
                vm = true
              }
            }
            if (product.aliases.split(',')[1] != undefined) {
              if (product.aliases.split(',')[1].split('/')[2] == "default") {
                var p = product.aliases.split(',')[1].split('/')
                p.pop()
                if (ppp[p.join('/')]) {

                } else {
                  ppp[p.join('/')] = true
                  return { alias: p.join('/'), supportVM: vm, os: p.join('/').split('/')[0], version: p.join('/').split('/')[1] };
                }

              } else {
                if (ppp[product.aliases.split(',')[1]]) {

                } else {
                  ppp[product.aliases.split(',')[1]] = true
                  return { alias: product.aliases.split(',')[1], supportVM: vm, os: product.aliases.split(',')[1].split('/')[0], version: product.aliases.split(',')[1].split('/')[1] };
                }

              }
            }

          }
        })
        resolve([...new Set(a.filter(s => s != undefined))])

      } else if (options.protocol == "lxd") {

        var serv = options.server ? options.server : ""
        var s = await this.client.get(serv + '1.0/images?recursion=1')
        resolve(s.metadata.map(image => {
          return {
            alias: image.aliases[0] ? image.aliases[0].name : "",
            fingerprint: image.fingerprint,
            properties: image.properties,
            arch: image.architecture,
            type: image.type,
            size: image.size
          }
        }))


      }

    })
  }
  /**
   * Creates LXD Container/VM
   * @param {string} name Instance name
   * @param {string} fingerprint Image Fingerprint, can be fetched by Client.fetchImage()
   * @param {{image: { server: string, alias: string, protocol: string}, raw:import('../types/types').CreateInstance.RootObject}} options Additional data
   * @returns {Promise<import('../types/types').CreateEmitter>} Event emitter for operation updates
   */
  async create(name, options) {
    return new Promise(async (resolve, reject) => {

      try {
        var res = await this.client.post('/1.0/instances', {
          name: name,
          source: {
            type: "image",
            alias: options.source.alias,
            "server": options.source.server ? options.source.server : "https://uk.lxd.images.canonical.com/",
            "protocol": options.source.protocol ? options.source.protocol : "simplestreams"
          },
          ...options
        })
        var waiter = new EventEmitter()
        var events = await this.events("operation")
        var operationID = res.data.metadata.id
        var self = this
        async function listener(d) {

          var data = JSON.parse(d.toString())
          if (data.metadata.id == operationID) {
            if (data.metadata.status == "Failure") {
              waiter.emit("error", data.metadata.err)
              events.removeAllListeners()
              events.close()
            }
            if (data.metadata.status == "Success") {
              waiter.emit("finished", await self.instance(name))
              events.removeAllListeners()
              events.close()
            }
            if (!data.metadata.metadata) return;
            if (data.metadata.metadata.download_progress) {
              var s = data.metadata.metadata.download_progress.match(/: (.*)%/)
              waiter.emit("progress", s[1])
            }
          }
        }
        events.on('message', listener)
      } catch (error) {
        return reject(error)
      }
      if (res.data.type == "error") {
        return reject(res.data)
      }
      //
      return resolve(waiter)
    })
  }
  network(bridge) {
    const network = require('./Network')
    return new network(bridge, this.client)
  }
  /**
   * Create a new LXD Bridge and returns a new Network Manager
   * @param {string} name Bridge name
   * @param {import('../types/types').BridgeConfig} config Bridge config
   * @param {string} description Bridge description
   * @returns {Promise<Network>}
   */
  createBridge(name, config, description) {
    return new Promise(async (resolve, reject) => {
      var data = {
        name: name,
        type: "bridge",
        description: description ? description : "",
        config: config ? config : {}
      }
      try {
        var res = await this.client.post('/1.0/networks', data)
      } catch (error) {
        reject(error)
      }
      resolve(this.network(name))
    })
  }
  /**
   * Gets a single instance
   * @param {string} name Instance name
   * @returns {Promise<Instance | null>} Returns Instance or null if not found
   */
  instance(name) {
    return new Promise(async (resolve, reject) => {
      try {
        var body = {
          meta: (await this.client.get('/1.0/instances/' + name)).metadata,
          status: (await this.client.get('/1.0/instances/' + name + '/state')).metadata
        }
      } catch (error) {
        reject(error)
      }
      if (!body.meta) return resolve(null)
      resolve(new Instance(this, body))
    })

  }

  /**
  * Gets all instances
  * @returns {Promise<Instance[]>} Array of Instances
  */
  instances() {
    return new Promise(async (resolve, reject) => {
      try {
        var names = (await this.client.get('/1.0/instances')).metadata
        var instances = []
        for (var i = 0; i < names.length; i++) {
          instances.push(await this.instance(names[i].split("/")[3]))
        }
        resolve(instances)
      } catch (error) {
        reject(error)
      }
    })
  }

  /** 
   * Creates LXD Client
   * @param {string} url LXD URL (Local: "unix:///var/snap/lxd/common/lxd/unix.socket")
   * @param {object} options 
   * @param {import('fs').ReadStream} options.cert Trust certificate for LXD
   * @param {import('fs').ReadStream} options.key Trust key for LXD
   * @param {string} options.imageServer Override the default image server
   */
  constructor(url, options) {
    if (new URL(url).protocol == "https:") {
      if (!options || !options.key || !options.cert) throw new Error('Trust cert and/or key not specified')
      /**
       * @private
       */
      this.client = new RequestClient(url, options)
      this.cert = options.cert
      this.key = options.key
      this.host = url
      this.connectionType = 'http'
      /**
       * @private
       */
      this.imageServer = options.imageServer ? options.imageServer : null
    } else if (new URL(url).protocol == "unix:") {
      if (!options) var options = {}
      /**
      * @private
      */
      this.client = new RequestClient(url)
      this.connectionType = 'unix'
      this.unixpath = url
      /**
       * @private
       */
      this.imageServer = options.imageServer ? options.imageServer : null
    } else {
      throw new Error('Invalid LXD URL, Must start with unix:// or https://')
    }
  }
}

module.exports = Client;