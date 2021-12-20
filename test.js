
const fs = require('fs')
const xd = new (require("./src/classes/Client"))("https://images.speed.hye.gg:8443/", {
	cert: fs.readFileSync('./lxd-webui.crt'),
	key: fs.readFileSync('./lxd-webui.key')
});

async function start() {

  console.log(await xd.fetchImage("openjdk/17/x86_64", {type: "container", server: "https://images.speed.hye.gg:8443/", connection: "lxd"}))
}
start()
