const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, Tray } = require('electron');
const path = require('path');
const WebSocket = require('ws');
const Store = require('./store');

// Fix Linux Wayland color space errors and window layering when rendering above games
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('disable-features', 'WaylandColorManagement,WaylandColorManager,ColorManagement,ColorManager');
    app.commandLine.appendSwitch('force-color-profile', 'srgb');
    app.commandLine.appendSwitch('ozone-platform', 'x11');
}

const store = new Store({
    configName: 'user-preferences',
    defaults: {
        opacity: 0.4,
        msgOpacity: 0.0,
        autoHide: true,
        autoHideDelay: 20,
        deleteMessages: true,
        showTextSection: true,
        showVoiceSection: true,
        showVoiceNotifs: true,
        voiceSortOrder: 'friends',
        textSectionHeight: 140,
        voiceSectionHeight: 250,
        autoExpandVoice: false,
        displayId: null,
        position: 'top-right',
        visibilityKey: 'CommandOrControl+Shift+H',
        typingKey: 'CommandOrControl+Shift+Enter'
    }
});

let mainWindow;
let settingsWindow;
let tray = null;
let typingMode = false;
let isOverlayVisible = true;
let wss;

function getSelectedDisplay(prefId) {
    const displays = screen.getAllDisplays();
    if (prefId) {
        const found = displays.find(d => d.id === prefId);
        if (found) return found;
    }
    return screen.getPrimaryDisplay();
}

function calculateWindowPosition(display, pos, textHeight = 140, voiceHeight = 250, autoExpandVoice = false, voiceUserCount = 0) {
    const bounds = display.bounds; // x, y, width, height
    const winWidth = 350;
    
    let effectiveVoiceHeight = voiceHeight || 250;
    if (autoExpandVoice) {
        const count = Math.max(1, voiceUserCount || 1);
        const needed = count * 50 + 24; // 50px per full voice card + header padding
        const maxAvail = bounds.height - (textHeight || 140) - 90;
        effectiveVoiceHeight = Math.min(maxAvail, Math.max(120, needed));
    }

    const totalRequired = (textHeight || 140) + effectiveVoiceHeight + 130;
    const winHeight = Math.min(bounds.height - 40, Math.max(300, totalRequired));
    const padding = 20;
    
    let x = bounds.x;
    let y = bounds.y;
    
    if (pos.includes('right')) {
        x += bounds.width - winWidth - padding;
    } else {
        x += padding;
    }
    
    if (pos.includes('bottom')) {
        y += bounds.height - winHeight - padding;
    } else {
        y += padding;
    }
    
    return { x, y, width: winWidth, height: winHeight, effectiveVoiceHeight };
}

function createWindow() {
    const targetDisplay = getSelectedDisplay(store.get('displayId'));
    const bounds = calculateWindowPosition(
        targetDisplay, 
        store.get('position'), 
        store.get('textSectionHeight'), 
        store.get('voiceSectionHeight'),
        store.get('autoExpandVoice')
    );

    const windowOptions = {
        title: 'Discord Gaming Overlay',
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    };

    if (process.platform === 'linux') {
        windowOptions.type = 'utility';
    }

    mainWindow = new BrowserWindow(windowOptions);

    if (process.platform === 'linux') {
        mainWindow.setIgnoreMouseEvents(true);
    } else {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    
    if (typeof mainWindow.setVisibleOnAllWorkspaces === 'function') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    mainWindow.loadFile('index.html');
    
    // Set initial opacity when ready
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('set-opacity', store.get('opacity'));
        mainWindow.webContents.send('set-msg-opacity', store.get('msgOpacity') || 0);
        mainWindow.webContents.send('set-auto-hide', {
            autoHide: store.get('autoHide') !== false,
            autoHideDelay: store.get('autoHideDelay') || 20
        });
        mainWindow.webContents.send('set-sync-deleted', store.get('deleteMessages') !== false);
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: store.get('showTextSection') !== false,
            showVoiceSection: store.get('showVoiceSection') !== false,
            showVoiceNotifs: store.get('showVoiceNotifs') !== false,
            textSectionHeight: store.get('textSectionHeight') || 140,
            voiceSectionHeight: store.get('voiceSectionHeight') || 250,
            autoExpandVoice: store.get('autoExpandVoice') || false
        });
        mainWindow.webContents.send('set-voice-sort', store.get('voiceSortOrder') || 'friends');

        // Apply saved window height bounds immediately on launch
        const initDisplay = getSelectedDisplay(store.get('displayId'));
        const initBounds = calculateWindowPosition(
            initDisplay,
            store.get('position'),
            store.get('textSectionHeight'),
            store.get('voiceSectionHeight'),
            store.get('autoExpandVoice')
        );
        mainWindow.setBounds(initBounds);
    });
}

function createSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 450,
        height: 600,
        autoHideMenuBar: true,
        title: "Overlay Settings",
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    settingsWindow.loadFile('settings.html');
    
    settingsWindow.webContents.on('did-finish-load', () => {
        settingsWindow.webContents.send('load-settings', {
            config: store.getAll(),
            displays: screen.getAllDisplays()
        });
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

const { uIOhook, UiohookKey } = require('uiohook-napi');

// Setup global key listener for chorded shortcuts
const pressedKeys = new Set();
let isRecordingHotkey = false;

function getKeyName(keycode) {
    let keyName = Object.keys(UiohookKey).find(k => UiohookKey[k] === keycode);
    if (!keyName) return null;
    
    // Normalize some names to match the settings UI expectations
    if (keyName.includes('Ctrl')) return 'Ctrl';
    if (keyName.includes('Shift')) return 'Shift';
    if (keyName.includes('Alt')) return 'Alt';
    if (keyName.includes('Meta') || keyName.includes('Super')) return 'Super';
    return keyName;
}

uIOhook.on('keydown', (e) => {
    const keyName = getKeyName(e.keycode);
    if (!keyName) return;

    if (pressedKeys.has(keyName)) return; // Ignore hardware key repeats
    pressedKeys.add(keyName);

    if (isRecordingHotkey && settingsWindow) {
        settingsWindow.webContents.send('recording-hotkey-progress', Array.from(pressedKeys).join('+'));
    } else {
        checkHotkeys();
    }
});

uIOhook.on('keyup', (e) => {
    if (isRecordingHotkey && pressedKeys.size > 0 && settingsWindow) {
        isRecordingHotkey = false;
        settingsWindow.webContents.send('recording-hotkey-done', Array.from(pressedKeys).join('+'));
    }

    const keyName = getKeyName(e.keycode);
    if (keyName) pressedKeys.delete(keyName);
});

uIOhook.on('mousedown', (e) => {
    const btnName = `Mouse${e.button}`;
    pressedKeys.add(btnName);

    if (isRecordingHotkey && settingsWindow) {
        settingsWindow.webContents.send('recording-hotkey-progress', Array.from(pressedKeys).join('+'));
    } else {
        checkHotkeys();
    }
});

uIOhook.on('mouseup', (e) => {
    if (isRecordingHotkey && pressedKeys.size > 0 && settingsWindow) {
        isRecordingHotkey = false;
        settingsWindow.webContents.send('recording-hotkey-done', Array.from(pressedKeys).join('+'));
    }

    const btnName = `Mouse${e.button}`;
    pressedKeys.delete(btnName);
});

uIOhook.start();

ipcMain.on('start-recording-hotkey', () => {
    pressedKeys.clear();
    isRecordingHotkey = true;
});

ipcMain.on('cancel-recording-hotkey', () => {
    isRecordingHotkey = false;
});

function checkHotkeys() {
    const pressedCombo = Array.from(pressedKeys).join('+');
    
    // Check visibility toggle
    const visKey = store.get('visibilityKey');
    if (visKey && visKey === pressedCombo) {
        if (mainWindow) {
            if (isOverlayVisible) {
                mainWindow.hide();
                isOverlayVisible = false;
            } else {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true, 'screen-saver');
                isOverlayVisible = true;
            }
        }
    }

    // Check typing toggle
    const typeKey = store.get('typingKey');
    if (typeKey && typeKey === pressedCombo) {
        if (!mainWindow || !isOverlayVisible) return;
        typingMode = !typingMode;
        if (typingMode) {
            if (typeof mainWindow.setFocusable === 'function') mainWindow.setFocusable(true);
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.focus();
        } else {
            if (process.platform === 'linux') {
                mainWindow.setIgnoreMouseEvents(true);
            } else {
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
            if (typeof mainWindow.setFocusable === 'function') mainWindow.setFocusable(false);
        }
        mainWindow.webContents.send('toggle-typing', typingMode);
    }
}

function updateShortcuts() {
    // Handled dynamically by checkHotkeys now
}

function createTray() {
    const { nativeImage } = require('electron');
    let icon;
    try {
        icon = nativeImage.createFromPath(process.execPath);
        if (icon.isEmpty()) {
            icon = nativeImage.createEmpty();
        }
    } catch (e) {
        icon = nativeImage.createEmpty();
    }
    
    tray = new Tray(icon);
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Settings', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: 'Quit', click: () => {
            app.isQuiting = true;
            app.quit();
        }}
    ]);
    
    tray.setToolTip('Gaming Overlay');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
        createSettingsWindow();
    });
}

// IPC Handlers
ipcMain.on('save-settings', (event, newConfig) => {
    store.set('opacity', newConfig.opacity);
    store.set('msgOpacity', newConfig.msgOpacity);
    store.set('autoHide', newConfig.autoHide);
    store.set('autoHideDelay', newConfig.autoHideDelay);
    store.set('deleteMessages', newConfig.deleteMessages);
    store.set('showTextSection', newConfig.showTextSection);
    store.set('showVoiceSection', newConfig.showVoiceSection);
    store.set('showVoiceNotifs', newConfig.showVoiceNotifs);
    store.set('voiceSortOrder', newConfig.voiceSortOrder);
    store.set('textSectionHeight', newConfig.textSectionHeight);
    store.set('voiceSectionHeight', newConfig.voiceSectionHeight);
    store.set('autoExpandVoice', newConfig.autoExpandVoice);
    store.set('displayId', newConfig.displayId);
    store.set('position', newConfig.position);
    store.set('visibilityKey', newConfig.visibilityKey);
    store.set('typingKey', newConfig.typingKey);

    if (mainWindow) {
        mainWindow.webContents.send('set-opacity', newConfig.opacity);
        mainWindow.webContents.send('set-msg-opacity', newConfig.msgOpacity);
        mainWindow.webContents.send('set-auto-hide', {
            autoHide: newConfig.autoHide,
            autoHideDelay: newConfig.autoHideDelay
        });
        mainWindow.webContents.send('set-sync-deleted', newConfig.deleteMessages);
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: newConfig.showTextSection,
            showVoiceSection: newConfig.showVoiceSection,
            showVoiceNotifs: newConfig.showVoiceNotifs,
            textSectionHeight: newConfig.textSectionHeight || 140,
            voiceSectionHeight: newConfig.voiceSectionHeight || 250,
            autoExpandVoice: newConfig.autoExpandVoice || false
        });
        mainWindow.webContents.send('set-voice-sort', newConfig.voiceSortOrder || 'friends');
        
        const targetDisplay = getSelectedDisplay(newConfig.displayId);
        const bounds = calculateWindowPosition(
            targetDisplay, 
            newConfig.position, 
            newConfig.textSectionHeight, 
            newConfig.voiceSectionHeight
        );
        mainWindow.setBounds(bounds);
    }

    updateShortcuts();
});

ipcMain.on('preview-settings', (event, previewConfig) => {
    if (mainWindow) {
        mainWindow.webContents.send('set-opacity', previewConfig.opacity);
        mainWindow.webContents.send('set-msg-opacity', previewConfig.msgOpacity);
        mainWindow.webContents.send('set-auto-hide', {
            autoHide: previewConfig.autoHide,
            autoHideDelay: previewConfig.autoHideDelay
        });
        mainWindow.webContents.send('set-sync-deleted', previewConfig.deleteMessages);
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: previewConfig.showTextSection,
            showVoiceSection: previewConfig.showVoiceSection,
            showVoiceNotifs: previewConfig.showVoiceNotifs,
            textSectionHeight: previewConfig.textSectionHeight || 140,
            voiceSectionHeight: previewConfig.voiceSectionHeight || 250,
            autoExpandVoice: previewConfig.autoExpandVoice || false
        });
        mainWindow.webContents.send('set-voice-sort', previewConfig.voiceSortOrder || 'friends');
        
        const targetDisplay = getSelectedDisplay(previewConfig.displayId);
        const bounds = calculateWindowPosition(
            targetDisplay, 
            previewConfig.position, 
            previewConfig.textSectionHeight, 
            previewConfig.voiceSectionHeight
        );
        mainWindow.setBounds(bounds);
    }
});

ipcMain.on('voice-user-count', (event, count) => {
    if (mainWindow && store.get('autoExpandVoice')) {
        const targetDisplay = getSelectedDisplay(store.get('displayId'));
        const bounds = calculateWindowPosition(
            targetDisplay,
            store.get('position'),
            store.get('textSectionHeight'),
            store.get('voiceSectionHeight'),
            true,
            count
        );
        mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: store.get('showTextSection') !== false,
            showVoiceSection: store.get('showVoiceSection') !== false,
            showVoiceNotifs: store.get('showVoiceNotifs') !== false,
            textSectionHeight: store.get('textSectionHeight') || 140,
            voiceSectionHeight: bounds.effectiveVoiceHeight,
            autoExpandVoice: true
        });
    }
});

ipcMain.on('send-message', (event, content) => {
    if (wss) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "SEND_MESSAGE", content }));
            }
        });
    }
    typingMode = false;
    if (process.platform === 'linux') {
        mainWindow.setIgnoreMouseEvents(true);
    } else {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }
    if (typeof mainWindow.setFocusable === 'function') mainWindow.setFocusable(false);
    mainWindow.webContents.send('toggle-typing', false);
});

function startWebSocketServer() {
    wss = new WebSocket.Server({ port: 6969 });

    wss.on('connection', (ws) => {
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === "MESSAGES_UPDATE") {
                    if (mainWindow) {
                        mainWindow.webContents.send('messages-update', data.messages);
                    }
                } else if (data.type === "VOICE_UPDATE") {
                    if (mainWindow) {
                        mainWindow.webContents.send('voice-update', data);
                    }
                } else if (data.type === "ENABLE_SECTION") {
                    if (data.section === "text") {
                        store.set('showTextSection', true);
                    } else if (data.section === "voice") {
                        store.set('showVoiceSection', true);
                    }
                    if (mainWindow) {
                        mainWindow.webContents.send('set-sections-config', {
                            showTextSection: store.get('showTextSection') !== false,
                            showVoiceSection: store.get('showVoiceSection') !== false,
                            showVoiceNotifs: store.get('showVoiceNotifs') !== false
                        });
                    }
                    if (settingsWindow) {
                        settingsWindow.webContents.send('load-settings', {
                            config: store.getAll(),
                            displays: screen.getAllDisplays()
                        });
                    }
                } else if (data.type === "DEBUG_LOG") {
                    console.log("Plugin Debug:", data.message);
                }
            } catch (e) {
                console.error("WS Parse Error", e);
            }
        });

        ws.on('close', () => {
            if (mainWindow) {
                mainWindow.webContents.send('messages-update', []);
            }
        });
    });
}

app.whenReady().then(() => {
    try {
        createTray();
    } catch (e) {
        // Fallback if no icon exists
        const nativeImage = require('electron').nativeImage;
        tray = new Tray(nativeImage.createEmpty());
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Settings', click: () => createSettingsWindow() },
            { type: 'separator' },
            { label: 'Quit', click: () => app.quit() }
        ]);
        tray.setToolTip('Gaming Overlay');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => createSettingsWindow());
    }

    createWindow();
    updateShortcuts();
    startWebSocketServer();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
