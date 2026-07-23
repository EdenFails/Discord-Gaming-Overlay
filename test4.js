const { uIOhook } = require('uiohook-napi');
uIOhook.on('mousedown', (e) => {
    console.log(e);
});
uIOhook.start();
console.log('started');