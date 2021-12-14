

const xd = new (require("./src/classes/Client"))(
	"unix:///var/snap/lxd/common/lxd/unix.socket"
);

async function start() {
	const ws = await xd.events("operation")
	ws.on('message', (data) => {
		console.log(data.toString())
	})
	try {
		var e = await xd.create({
			"name": "test",
			"source": {
				"alias": "ubuntu/20.04",
				"type": "image",
				"mode": "pull",
				"server": "https://images.linuxcontainers.org",
				"protocol": "simplestreams"
			}
		})	
	} catch (error) {
		console.log(error)
	}
	console.log(e)
}
start()
