

const rc = new (require("./src/classes/Client"))(
	"unix:///var/snap/lxd/common/lxd/unix.socket"
);

	async function start() {
        var res = await rc.client.get('/1.0/metrics')
		console.log(res)
	}
	start()
