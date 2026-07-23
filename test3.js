const { uIOhook } = require('uiohook-napi');
uIOhook.on('keydown', (e) => {
    console.log(e.keycode);
});
uIOhook.start();
console.log('started');