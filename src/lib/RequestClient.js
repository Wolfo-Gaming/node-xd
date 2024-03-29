const axios = require("axios");
const https = require("https");
const ws = require("ws");
class RequestClient {
  requests = 0;
  async get(url) {
    this.requests++;
    return (await this.client.get(url)).data
  }
  post(url, data, headers) {
    this.requests++;
    return new Promise((resolve, reject) => {
      this.client.post(url, data, headers).catch(err => {
        console.log(err)
      }).then((data) => { resolve(data) })
    })
  }
  delete(url) {
    this.requests++;
    return new Promise((resolve, reject) => {
      this.client.delete(url).catch(reject).then((data) => resolve(data))
    })
  }
  put(url, data) {
    this.requests++;
    return new Promise((resolve, reject) => {
      this.client.put(url, data).catch(reject).then(({ data }) => resolve(data))
    })
  }
  patch(url, data) {
    this.requests++;
    return new Promise((resolve, reject) => {
      this.client.patch(url, data).catch(reject).then(({ data }) => resolve(data))
    })
  }
  axios(args) {
    if (this.prot == "unix") {
      return this.client({
        socketPath: this.socketPath,
        ...args
      })
    } else {
      return this.client({
        baseURL: this.baseURL,
        httpsAgent: this.agent,
        ...args
      })
    }

  }
  /**
   * 
   * @param {string} url 
   * @returns {Promise<ws>}
   */
  ws(url) {
    this.requests++;
    return new Promise((resolve, reject) => {
      try {
        var wss = this.wsConnect(url)
      } catch (error) {
        reject(error)
      }
      resolve(wss)
    })
  }
  constructor(url, optionalTrust) {
    var type = new URL(url);
    if (type.protocol == "unix:") {
      this.socketPath = type.pathname
      this.prot = 'unix'
      this.client = axios.default.create({
        //validateStatus: false,
        socketPath: type.pathname,
      });
      this.wsConnect = (url) => {
        var s = new ws("ws+unix://" + type.pathname + ":" + url);
        s.rm = s.close
        return s
      };
    } else if (type.protocol == "https:") {
      this.baseURL = url
      this.prot = 'http'
      var httpsClient = new https.Agent({
        cert: optionalTrust.cert,
        key: optionalTrust.key,
        rejectUnauthorized: false,
      });
      this.agent = httpsClient
      this.client = axios.default.create({
        httpsAgent: httpsClient,
        baseURL: url,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      this.wsConnect = (url) => {
        return new ws.WebSocket("wss://" + type.host + url, {
          cert: optionalTrust.cert,
          key: optionalTrust.key,
          rejectUnauthorized: false
        });
      };
    }
  }
}
module.exports = RequestClient
