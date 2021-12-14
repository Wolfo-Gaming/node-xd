

const rc = new (require("./src/classes/Client"))(
	"unix:///var/snap/lxd/common/lxd/unix.socket"
);

	async function start() {
		var e = await rc.createBridge("lxdbr1")
		console.log(e)
       var controller = rc.network('lxdbr0')
	   var s = await controller.fetchNetworkForwards()
	  console.log(s)
	}
	start()
