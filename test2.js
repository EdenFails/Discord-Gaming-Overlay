const { GlobalKeyboardListener } = require('node-global-key-listener');
const v = new GlobalKeyboardListener();
v.addListener(function (e, down) {
    if (e.state === 'DOWN') {
        console.log(e.name);
    }
});
setTimeout(() => { process.exit(0); }, 2000);