
const fs = require('fs')
const xd = new (require("./src/classes/Client"))("https://81.205.168.8:8443/", {
	cert: fs.readFileSync('./lxd-webui.crt'),
	key: fs.readFileSync('./lxd-webui.key')
});

async function start() {
var inst = await xd.instance('test')
var s = await inst.download('/root/s.txt', fs.createWriteStream('./s.txt'))
s.events.on('progress', (s) => {
	console.log(s)
})
}
start()
