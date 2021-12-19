
const fs = require('fs')
const xd = new (require("./src/classes/Client"))("https://81.205.168.8:8443/", {
	cert: fs.readFileSync('./lxd-webui.crt'),
	key: fs.readFileSync('./lxd-webui.key')
});

async function start() {

	var instance = await xd.instance('test')
	/**
	 * @type {import('ws').WebSocket}
	 */
	var e = await instance.exec("java -jar server.jar".split(' '), {interactive:true})
    e.on('message', d => console.log(d.toString()))
	e.on("close", () => {
		console.log("IT IS CLOSED!!!")
		process.exit(0)
	})
	process.stdin.on('data', (data) => e.send(data, {binary:true}))
}
start()
