const RequestClient = require('../lib/RequestClient')
const ws = require('ws')
const Instance = require('./Instance')
const awaitOperation = require("../lib/awaitOperation");

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
   * @param {"operation"|"logging"|"lifecycle"} type
   * @returns {Promise<ws>}
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
    return new Promise(async (resolve,reject) => {
      try {
        var data = await this.client.get('/1.0/resources')
      } catch (error) {
        reject(error)
      }
      resolve(data.metadata)
    })
  }
  /**
   * Creates LXD Container/VM
   * @param {import('../types/types').CreateInstance.RootObject} data
   * @returns {Promise<Instance>}
   */
  async create(data) {
    return new Promise(async (resolve, reject) => {
      try {
        var res = await this.client.post('/1.0/instances', {
          "architecture": "x86_64",
          "config": data.config ? data.config : {
            "security.nesting": "true"
          },
          "empheral": false,
          "name": data.name,
          "profiles": data.profiles ? data.profiles : [
            "default"
          ],
          "source": data.source ? data.source : {
            'type': 'image',
            'fingerprint': 'd1b447d815ff'
          }
        })
      } catch (error) {
        reject(error)
      }
      await awaitOperation(this, res.data.metadata.id)
      resolve(await this.instance(data.name))
    })
  }

  /**
   * Gets a single instance
   * @param {string} name 
   * @returns {Promise<Instance | null>}
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
 * @returns {Promise<Instance[]>}
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
   * @param {string} url 
   * @param {object} trust 
   * @param {import('fs').ReadStream} trust.cert
   * @param {import('fs').ReadStream} trust.key
   */
  constructor(url, trust) {
    if (new URL(url).protocol == "https:") {
      if (!trust || !trust.key || !trust.cert) throw new Error('Trust cert and/or key not specified')
      /**
       * @private
       */
      this.client = new RequestClient(url, trust)
    } else if (new URL(url).protocol == "unix:") {
      /**
      * @private
      */
      this.client = new RequestClient(url)
    } else {
      throw new Error('Invalid LXD URL, Must start with unix:// or https://')
    }
  }
}

module.exports = Client;