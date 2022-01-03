
const fs = require('fs')
const xd = new (require("./src/classes/Client"))("https://81.205.168.8:8443/", {
	cert: fs.readFileSync('./lxd-webui.crt'),
	key: fs.readFileSync('./lxd-webui.key')
});

async function start() {
	var res = await xd.images({protocol: "simplestreams"})
   console.log(JSON.stringify(res))
}
start()
