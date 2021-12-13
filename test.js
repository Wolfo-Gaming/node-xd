

const rc = new (require("./src/classes/Client"))(
	"unix:///var/snap/lxd/common/lxd/unix.socket"
);

	async function start() {
       var controller = rc.network('lxdbr0')
	   var s = await controller.fetchNetworkForwards()
	  console.log(s)
	}
	start()
