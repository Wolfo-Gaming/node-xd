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
   * @returns {Promise<string[]>} Array of images "(name)/(version)"
   */
  images(os) {
    return new Promise(async (resolve, reject) => {
      if (os) {
        os = capitalizeFirstLetter(os)
        var s = await this.client.get(`https://uk.lxd.images.canonical.com/streams/v1/images.json`)
        var products = s.products;
        var productsKeys = Object.keys(s.products)
        var filterProducts = productsKeys.map((product) => {
          return products[product]
        })
        var a = filterProducts.map((product) => {
          if (product.variant == "default" && product.os == os) {
            if (product.aliases.split(',')[1] != undefined) {
              if (product.aliases.split(',')[1].split('/')[2] == "default") {
                var p = product.aliases.split(',')[1].split('/')
                p.pop()
                return p.join('/');
              } else {
                return product.aliases.split(',')[1];
              }

            }

          }
        })
        resolve(a.filter(s => s != undefined))
      } else {
        var s = await this.client.get(`https://uk.lxd.images.canonical.com/streams/v1/images.json`)
        var products = s.products;
        var productsKeys = Object.keys(s.products)
        var filterProducts = productsKeys.map((product) => {
          return products[product]
        })
        var a = filterProducts.map((product) => {
          if (product.variant == "default") {
            if (product.aliases.split(',')[1] != undefined) {
              if (product.aliases.split(',')[1].split('/')[2] == "default") {
                var p = product.aliases.split(',')[1].split('/')
                p.pop()
                return p.join('/');
              } else {
                return product.aliases.split(',')[1];
              }
            }

          }
        })
        resolve(a.filter(s => s != undefined))
      }

    })
  }
  /**
   * 
   * @param {string} os OS name i.e. "Ubuntu"
   * @param {string} version OS version i.e. "20.04"
   * @param {object} option
   * @param {"armhf"|"arm64"|"i386"|"amd64"|"ppc64el"|"s390x"} option.arch Architecture to use
   * @param {"virtual-machine" | "container"} option.type
   * @param {"simplestreams"|"lxd"} option.connection
   * @param {string} option.server
   * @returns {Promise<string>} Image Fingerprint
   */
  fetchImage(os, option) {
    return new Promise(async (resolve, reject) => {
      if (!arguments[1]) var option = {}
      else var option = arguments[1]
      try {
        console.log(option)
        if (option.connection == "simplestreams") {
          if (option.type == "virtual-machine") {
            var s = await this.client.get(this.imageServer ? this.imageServer : `https://images.linuxcontainers.org/streams/v1/images.json`)
            if (!option.arch) option.arch = 'amd64'
            var sKeys = Object.keys(s.products)
            var productF = sKeys.find((productKey) => {
              var p = s.products[productKey]
              return p.aliases.includes(`${os}`) && p.arch == option.arch
            });
            productF = s.products[productF];
            if (!productF) reject(new Error('Product ' + `${os}` + ' not found.'))
            var releaseKeys = Object.keys(productF.versions)
            var release = productF.versions[releaseKeys[releaseKeys.length - 1]]
            var fingerprint = release.items["lxd.tar.xz"]['combined_disk-kvm-img_sha256']
          } else if (option.type == "container" || !option.type) {
            var s = await this.client.get(this.imageServer ? this.imageServer : `https://images.linuxcontainers.org/streams/v1/images.json`)
            if (!option.arch) option.arch = 'amd64'
            var sKeys = Object.keys(s.products)
            var productF = sKeys.find((productKey) => {
              var p = s.products[productKey]
              return p.aliases.includes(`${os}`) && p.arch == option.arch
            });
            productF = s.products[productF];
            if (!productF) reject(new Error('Product ' + `${os}` + ' not found.'))
            var releaseKeys = Object.keys(productF.versions)
            var release = productF.versions[releaseKeys[releaseKeys.length - 1]]
            var fingerprint = release.items["lxd.tar.xz"]['combined_squashfs_sha256']
          }
        } else if (option.connection == "lxd") {
          var s = (await axios.get(option.server + "1.0/images?public&recursion=1")).data
          var a = s.metadata.find(image => {
            return image.aliases[0].name == os
          });
          var fingerprint = a.fingerprint;
        }
      } catch (error) {
        reject(error)
      }
      resolve(fingerprint)
    })
  }
  /**
   * Creates LXD Container/VM
   * @param {string} name Instance name
   * @param {string} fingerprint Image Fingerprint, can be fetched by Client.fetchImage()
   * @param {import('../types/types').CreateInstance.RootObject} data Additional data
   * @returns {Promise<import('../types/types').CreateEmitter>} Event emitter for operation updates
   */
  async create(name, fingerprint, data) {
    return new Promise(async (resolve, reject) => {

      try {
        var res = await this.client.post('/1.0/instances', {
          name: name,
          source: {
            type: "image",
            fingerprint: fingerprint,
            "server": this.imageServer ? this.imageServer : "https://images.linuxcontainers.org",
            "protocol": "simplestreams"
          },
          ...data
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