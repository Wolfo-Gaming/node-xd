class Network {
    /**
     * Creates Port forward on bridge
     * @param {string} listen_address
     * @param {string} description
     * @param {{}[]} ports
     * @returns {Promise<{}>}
     */
    async createNetworkForward(listen_address, description, ports) {
        if (!listen_address) throw new Error('Listen Address not specified');
        var data = {
            "description": description ? description : "A Network Forward",
            "listen_address": listen_address,
            "ports": ports
        }
        console.log(`/1.0/networks/${this.bridge}/forwards`)
        var res = await this.client.post('/1.0/networks/' + this.bridge + '/forwards', data)
        return res;
    }
    /**
     * Appends a port forward to exsisting forward
     * @param {string} listen_address
     * @param {{}[]} ports
     * @returns {Promise<{}>}
     */
    async appendNetworkForward(listen_address, ports) {
        if (!ports) throw new Error('Ports not specified');
        let all_ports = []
        all_ports.concat(ports)
        var existing_ports = await this.client.get("/1.0/networks/" + this.bridge + "/forwards/" + listen_address)
        all_ports = ports.concat(existing_ports.metadata.ports)
        var res = await this.client.patch('/1.0/networks/' + this.bridge + '/forwards/' + listen_address, {
            "ports": all_ports
        })
        return res;
    }
    async fetchNetworkForward(listen_address) {
        var data = await this.client.get("/1.0/networks/" + this.bridge + "/forwards/" + listen_address)
        return data.metadata
    }
    async fetchNetworkForwards() {
        var data = await this.client.get("/1.0/networks/" + this.bridge + "/forwards")
        var res = []
        if (data.metadata != null) for (var forward of data.metadata) {
            res.push((await this.client.get(forward)).metadata)
        }
        return res;
    }
    constructor(bridge, rootClient) {
        /**
         * @private
         * @type {import('../lib/RequestClient')}
         */
        this.client = rootClient;
        /**
         * @private
         * @type {string}
         */
        this.bridge = bridge
    }
}
module.exports = Network;