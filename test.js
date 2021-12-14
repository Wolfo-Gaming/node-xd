

const rc = new (require("./src/classes/Client"))(
	"unix:///var/snap/lxd/common/lxd/unix.socket"
);

async function start() {
	var controller = rc.network('lxdbr2')
	var s = await controller.fetchNetworkForwards()
	console.log(s)
	var e = await controller.updateNetworkConfig({
		"ipv4.dhcp": null
	})
	console.log(e)
}
start()
