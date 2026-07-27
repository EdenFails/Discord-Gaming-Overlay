const { app, BrowserWindow, ipcMain, globalShortcut, screen, Menu, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const Store = require('./store');

function formatThemeName(filename) {
    const base = filename.replace(/\.[^/.]+$/, "");
    return base
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

function getCustomThemes() {
    const themesDir = path.join(__dirname, 'themes');
    if (!fs.existsSync(themesDir)) {
        try { fs.mkdirSync(themesDir, { recursive: true }); } catch (e) {}
    }

    const customThemes = [];
    try {
        const files = fs.readdirSync(themesDir);
        files.forEach(file => {
            if (file.startsWith('_') || file.endsWith('.example')) return;
            const ext = path.extname(file).toLowerCase();
            if (ext === '.css' || ext === '.txt' || ext === '.theme') {
                const fullPath = path.join(themesDir, file);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const displayName = formatThemeName(file);
                customThemes.push({
                    id: `custom:${file}`,
                    displayName: displayName,
                    filename: file,
                    cssContent: content
                });
            }
        });
    } catch (e) {}
    return customThemes;
}

// Disable hardware acceleration on Linux to prevent Mesa DRI GPU crashes (exit_code=139)
if (process.platform === 'linux') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('disable-features', 'WaylandColorManagement,WaylandColorManager,ColorManagement,ColorManager');
    app.commandLine.appendSwitch('force-color-profile', 'srgb');
}

const store = new Store({
    configName: 'user-preferences',
    defaults: {
        opacity: 0.4,
        msgOpacity: 0.0,
        autoHide: true,
        autoHideDelay: 20,
        deleteMessages: true,
        typingKeepsAwake: true,
        showTextSection: true,
        showVoiceSection: true,
        showVoiceNotifs: true,
        voiceSortOrder: 'friends',
        textSectionHeight: 140,
        voiceSectionHeight: 250,
        autoExpandVoice: false,
        autoMonitorVoice: true,
        voiceSpeakingThreshold: 0.5,
        displayId: null,
        position: 'top-right',
        visibilityKey: 'Ctrl+Shift+H',
        typingKey: 'Ctrl+Shift+Enter',
        messageChimeEnabled: true,
        messageChimeCooldown: 5,
        theme: 'default'
    }
});

function updateVencordPlugin() {
    try {
        const pluginPath = store.get('vencordPluginPath');
        if (pluginPath && fs.existsSync(pluginPath)) {
            const sourcePath = path.join(__dirname, 'vencord-plugin', 'GamingOverlay');
            const destPath = path.join(pluginPath, 'GamingOverlay');
            if (fs.existsSync(sourcePath)) {
                fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
                console.log('Automatically updated Vencord plugin at', destPath);
            }
        }
    } catch (err) {
        console.error('Failed to auto-update Vencord plugin:', err);
    }
}

let mainWindow;
let settingsWindow;
let activePreviewConfig = null;
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
        focusable: true,
        resizable: false,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    };

    if (process.platform === 'linux') {
        windowOptions.type = 'tooltip';
    } else if (process.platform === 'win32') {
        windowOptions.type = 'toolbar';
    }

    mainWindow = new BrowserWindow(windowOptions);

    if (process.platform === 'linux') {
        mainWindow.setIgnoreMouseEvents(true);
    } else {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

    // Periodic assertion to prevent DirectX Flip Model borderless games (Unreal Engine, etc.) from taking over Z-order
    setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed() && isOverlayVisible) {
            mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        }
    }, 3000);
    
    if (typeof mainWindow.setVisibleOnAllWorkspaces === 'function') {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    mainWindow.loadFile('index.html');
    
    // Set initial opacity when ready
    mainWindow.webContents.on('did-finish-load', () => {
        broadcastSavedConfigToOverlay();
    });
}

function broadcastSavedConfigToOverlay() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('set-opacity', store.get('opacity'));
    mainWindow.webContents.send('set-msg-opacity', store.get('msgOpacity') || 0);
    mainWindow.webContents.send('set-typing-key', (store.get('typingKey') || 'CommandOrControl+Shift+Enter').replace(/CommandOrControl/g, 'Ctrl').replace(/Cmd/g, 'Ctrl').replace(/Control/g, 'Ctrl'));
    mainWindow.webContents.send('set-auto-hide', {
        autoHide: store.get('autoHide') !== false,
        autoHideDelay: store.get('autoHideDelay') || 20,
        typingKeepsAwake: store.get('typingKeepsAwake') !== false
    });
    mainWindow.webContents.send('set-sync-deleted', store.get('deleteMessages') !== false);
    mainWindow.webContents.send('set-sections-config', {
        showTextSection: store.get('showTextSection') !== false,
        showVoiceSection: store.get('showVoiceSection') !== false,
        showVoiceNotifs: store.get('showVoiceNotifs') !== false,
        messageChimeEnabled: store.get('messageChimeEnabled') !== false,
        messageChimeCooldown: typeof store.get('messageChimeCooldown') === 'number' ? store.get('messageChimeCooldown') : 5,
        textSectionHeight: store.get('textSectionHeight') || 140,
        voiceSectionHeight: store.get('voiceSectionHeight') || 250,
        autoExpandVoice: store.get('autoExpandVoice') || false,
        voiceSpeakingThreshold: typeof store.get('voiceSpeakingThreshold') === 'number' ? store.get('voiceSpeakingThreshold') : 0.5,
        theme: store.get('theme') || 'default',
        customThemes: getCustomThemes()
    });
    mainWindow.webContents.send('set-voice-sort', store.get('voiceSortOrder') || 'friends');

    const initDisplay = getSelectedDisplay(store.get('displayId'));
    const initBounds = calculateWindowPosition(
        initDisplay,
        store.get('position'),
        store.get('textSectionHeight'),
        store.get('voiceSectionHeight'),
        store.get('autoExpandVoice')
    );
    mainWindow.setBounds(initBounds);
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
            displays: screen.getAllDisplays(),
            customThemes: getCustomThemes()
        });
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
        activePreviewConfig = null;
        broadcastSavedConfigToOverlay();
    });
}

ipcMain.on('request-settings', (event) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('load-settings', {
            config: store.getAll(),
            displays: screen.getAllDisplays(),
            customThemes: getCustomThemes()
        });
    }
});

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

function normalizeHotkey(key) {
    if (!key) return '';
    return key.replace(/CommandOrControl/g, 'Ctrl').replace(/Cmd/g, 'Ctrl').replace(/Control/g, 'Ctrl');
}

let previousActiveHwnd = null;

function getMainWindowHwnd() {
    if (!mainWindow) return '0';
    try {
        const buf = mainWindow.getNativeWindowHandle();
        return process.arch === 'x64' ? buf.readBigInt64LE(0).toString() : buf.readInt32LE(0).toString();
    } catch(e) {
        return '0';
    }
}

function pullFocusToOverlay() {
    if (!mainWindow) return;

    if (process.platform === 'win32') {
        const { execFile } = require('child_process');
        const overlayHwnd = getMainWindowHwnd();
        
        execFile(path.join(__dirname, 'focus.exe'), [overlayHwnd], (err, stdout, stderr) => {
            if (err || stderr) {
                console.error('[Overlay Focus Debug] pullFocusToOverlay Error:', err || stderr);
            }
            if (!err && stdout) {
                const fg = stdout.trim();
                if (fg && fg !== '0' && fg !== overlayHwnd) {
                    previousActiveHwnd = fg;
                    console.log('[Overlay Focus Debug] Captured game HWND:', previousActiveHwnd);
                }
            }
        });
    } else if (process.platform === 'linux') {
        const { exec } = require('child_process');
        
        exec('xdotool getactivewindow', (err, stdout) => {
            if (!err && stdout) {
                const fg = stdout.trim();
                if (fg && /^\d+$/.test(fg)) {
                    previousActiveHwnd = fg;
                    console.log('[Overlay Focus Debug] Captured Linux game Window ID:', previousActiveHwnd);
                }
            }
            
            // Standard Electron focus
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.focus();
            
            // Force focus via xdotool as fallback
            exec('xdotool search --name "Discord Gaming Overlay" windowactivate', () => {});
        });
    }
}

function returnFocusToGame() {
    if (!previousActiveHwnd) return;

    if (process.platform === 'win32') {
        const { execFile } = require('child_process');
        const gameHwnd = previousActiveHwnd;
        previousActiveHwnd = null;
        console.log('[Overlay Focus Debug] Returning focus to game HWND:', gameHwnd);
        
        execFile(path.join(__dirname, 'focus.exe'), [gameHwnd], (err, stdout, stderr) => {
            if (err || stderr) {
                console.error('[Overlay Focus Debug] returnFocusToGame Error:', err || stderr);
            }
        });
    } else if (process.platform === 'linux') {
        const { exec } = require('child_process');
        const gameId = previousActiveHwnd;
        previousActiveHwnd = null;
        console.log('[Overlay Focus Debug] Returning focus to Linux game Window ID:', gameId);
        
        exec(`xdotool windowactivate ${gameId}`, (err, stdout, stderr) => {
            if (err) {
                console.error('[Overlay Focus Debug] returnFocusToGame Linux Error:', err || stderr);
            }
        });
    }
}

function checkHotkeys() {
    const pressedCombo = Array.from(pressedKeys).join('+');
    
    // Check visibility toggle
    const visKey = normalizeHotkey(store.get('visibilityKey'));
    if (visKey && visKey === pressedCombo) {
        if (mainWindow) {
            if (isOverlayVisible) {
                mainWindow.hide();
                isOverlayVisible = false;
            } else {
                mainWindow.showInactive();
                mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                isOverlayVisible = true;
            }
        }
    }

    // Check typing toggle
    const typeKey = normalizeHotkey(store.get('typingKey'));
    if (typeKey && typeKey === pressedCombo) {
        if (!mainWindow || !isOverlayVisible) return;
        typingMode = !typingMode;
        if (typingMode) {
            pullFocusToOverlay();
            mainWindow.setIgnoreMouseEvents(false);
            mainWindow.show();
            mainWindow.focus();
            if (mainWindow.webContents) mainWindow.webContents.focus();
        } else {
            if (process.platform === 'linux') {
                mainWindow.setIgnoreMouseEvents(true);
            } else {
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
            mainWindow.blur();
            returnFocusToGame();
        }
        mainWindow.webContents.send('toggle-typing', typingMode);
    }
}

function updateShortcuts() {
    // Handled dynamically by checkHotkeys now
}

function createTray() {
    const { nativeImage } = require('electron');
    let iconPath = path.join(__dirname, 'icon.ico');
    if (!fs.existsSync(iconPath)) {
        iconPath = path.join(__dirname, 'icon.png');
    }
    
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        try { icon = nativeImage.createFromPath(process.execPath); } catch(e) {}
    }
    
    tray = new Tray(icon);
    tray.setToolTip('Discord Gaming Overlay (Click to open Settings)');
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Settings', click: () => createSettingsWindow() },
        { type: 'separator' },
        { label: 'Quit', click: () => {
            app.isQuiting = true;
            app.quit();
        }}
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => createSettingsWindow());
    tray.on('click', () => createSettingsWindow());
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
    store.set('messageChimeEnabled', newConfig.messageChimeEnabled);
    store.set('messageChimeCooldown', newConfig.messageChimeCooldown);
    store.set('voiceSortOrder', newConfig.voiceSortOrder);
    store.set('textSectionHeight', newConfig.textSectionHeight);
    store.set('voiceSectionHeight', newConfig.voiceSectionHeight);
    store.set('autoExpandVoice', newConfig.autoExpandVoice);
    store.set('autoMonitorVoice', newConfig.autoMonitorVoice);
    store.set('voiceSpeakingThreshold', newConfig.voiceSpeakingThreshold);
    store.set('theme', newConfig.theme || 'default');
    store.set('displayId', newConfig.displayId);
    store.set('position', newConfig.position);
    store.set('visibilityKey', newConfig.visibilityKey);
    store.set('typingKey', newConfig.typingKey);
    store.set('vencordPluginPath', newConfig.vencordPluginPath);

    if (mainWindow) {
        mainWindow.webContents.send('set-opacity', newConfig.opacity);
        mainWindow.webContents.send('set-msg-opacity', newConfig.msgOpacity);
        mainWindow.webContents.send('set-typing-key', (newConfig.typingKey || 'CommandOrControl+Shift+Enter').replace(/CommandOrControl/g, 'Ctrl').replace(/Cmd/g, 'Ctrl').replace(/Control/g, 'Ctrl'));
        mainWindow.webContents.send('set-auto-hide', {
            autoHide: newConfig.autoHide,
            autoHideDelay: newConfig.autoHideDelay,
            typingKeepsAwake: newConfig.typingKeepsAwake
        });
        mainWindow.webContents.send('set-sync-deleted', newConfig.deleteMessages);
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: newConfig.showTextSection,
            showVoiceSection: newConfig.showVoiceSection,
            showVoiceNotifs: newConfig.showVoiceNotifs,
            messageChimeEnabled: newConfig.messageChimeEnabled !== false,
            messageChimeCooldown: typeof newConfig.messageChimeCooldown === 'number' ? newConfig.messageChimeCooldown : 5,
            textSectionHeight: newConfig.textSectionHeight || 140,
            voiceSectionHeight: newConfig.voiceSectionHeight || 250,
            autoExpandVoice: newConfig.autoExpandVoice || false,
            voiceSpeakingThreshold: typeof newConfig.voiceSpeakingThreshold === 'number' ? newConfig.voiceSpeakingThreshold : 0.5,
            theme: newConfig.theme || 'default',
            customThemes: getCustomThemes()
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

    activePreviewConfig = null;
    updateVencordPlugin();
    broadcastConfigToPlugin();
    updateShortcuts();
});

ipcMain.on('preview-settings', (event, previewConfig) => {
    activePreviewConfig = previewConfig;
    if (mainWindow) {
        mainWindow.webContents.send('set-opacity', previewConfig.opacity);
        mainWindow.webContents.send('set-msg-opacity', previewConfig.msgOpacity);
        mainWindow.webContents.send('set-typing-key', (previewConfig.typingKey || 'CommandOrControl+Shift+Enter').replace(/CommandOrControl/g, 'Ctrl').replace(/Cmd/g, 'Ctrl').replace(/Control/g, 'Ctrl'));
        mainWindow.webContents.send('set-auto-hide', {
            autoHide: previewConfig.autoHide !== false,
            autoHideDelay: previewConfig.autoHideDelay || 20,
            typingKeepsAwake: previewConfig.typingKeepsAwake !== false
        });
        mainWindow.webContents.send('set-sync-deleted', previewConfig.deleteMessages);
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: previewConfig.showTextSection,
            showVoiceSection: previewConfig.showVoiceSection,
            showVoiceNotifs: previewConfig.showVoiceNotifs,
            messageChimeEnabled: previewConfig.messageChimeEnabled !== false,
            messageChimeCooldown: typeof previewConfig.messageChimeCooldown === 'number' ? previewConfig.messageChimeCooldown : 5,
            textSectionHeight: previewConfig.textSectionHeight || 140,
            voiceSectionHeight: previewConfig.voiceSectionHeight || 250,
            autoExpandVoice: previewConfig.autoExpandVoice || false,
            voiceSpeakingThreshold: typeof previewConfig.voiceSpeakingThreshold === 'number' ? previewConfig.voiceSpeakingThreshold : 0.5,
            theme: previewConfig.theme || 'default',
            customThemes: getCustomThemes()
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

    broadcastConfigToPlugin();
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
        const curr = mainWindow.getBounds();
        if (curr.x !== bounds.x || curr.y !== bounds.y || curr.width !== bounds.width || curr.height !== bounds.height) {
            mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        }
        const currentThemeVal = activePreviewConfig ? activePreviewConfig.theme : (store.get('theme') || 'default');
        mainWindow.webContents.send('set-sections-config', {
            showTextSection: store.get('showTextSection') !== false,
            showVoiceSection: store.get('showVoiceSection') !== false,
            showVoiceNotifs: store.get('showVoiceNotifs') !== false,
            messageChimeEnabled: store.get('messageChimeEnabled') !== false,
            messageChimeCooldown: typeof store.get('messageChimeCooldown') === 'number' ? store.get('messageChimeCooldown') : 5,
            textSectionHeight: store.get('textSectionHeight') || 140,
            voiceSectionHeight: bounds.effectiveVoiceHeight,
            autoExpandVoice: true,
            theme: currentThemeVal,
            customThemes: getCustomThemes()
        });
    }
});

ipcMain.on('send-message', (event, content) => {
    if (content && wss) {
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
    mainWindow.blur();
    returnFocusToGame();
    mainWindow.webContents.send('toggle-typing', false);
});

function broadcastConfigToPlugin() {
    if (wss) {
        const payload = JSON.stringify({
            type: "CONFIG_UPDATE",
            autoMonitorVoice: store.get('autoMonitorVoice') !== false
        });
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }
}

function startWebSocketServer() {
    wss = new WebSocket.Server({ port: 6969 });

    wss.on('connection', (ws) => {
        // Send initial config to Vencord plugin on connection
        ws.send(JSON.stringify({
            type: "CONFIG_UPDATE",
            autoMonitorVoice: store.get('autoMonitorVoice') !== false
        }));

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type === "MESSAGES_UPDATE") {
                    if (mainWindow) {
                        mainWindow.webContents.send('messages-update', data.messages);
                    }
                } else if (data.type === "TYPING_UPDATE") {
                    if (mainWindow) {
                        mainWindow.webContents.send('typing-update', data.typingUsers);
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
                        const currentThemeVal = activePreviewConfig ? activePreviewConfig.theme : (store.get('theme') || 'default');
                        mainWindow.webContents.send('set-sections-config', {
                            showTextSection: store.get('showTextSection') !== false,
                            showVoiceSection: store.get('showVoiceSection') !== false,
                            showVoiceNotifs: store.get('showVoiceNotifs') !== false,
                            messageChimeEnabled: store.get('messageChimeEnabled') !== false,
                            messageChimeCooldown: typeof store.get('messageChimeCooldown') === 'number' ? store.get('messageChimeCooldown') : 5,
                            textSectionHeight: store.get('textSectionHeight') || 140,
                            voiceSectionHeight: store.get('voiceSectionHeight') || 250,
                            autoExpandVoice: store.get('autoExpandVoice') || false,
                            voiceSpeakingThreshold: typeof store.get('voiceSpeakingThreshold') === 'number' ? store.get('voiceSpeakingThreshold') : 0.5,
                            theme: currentThemeVal,
                            customThemes: getCustomThemes()
                        });
                    }
                } else if (data.type === "DEBUG_LOG") {
                    console.log("Plugin Debug:", data.message);
                    if (mainWindow) {
                        mainWindow.webContents.send('messages-update', [{
                            id: 'debug-' + Date.now() + Math.random(),
                            content: 'DEBUG: ' + data.message,
                            author: { username: 'System', globalName: 'System', colorString: '#ff0000' },
                            timestamp: Date.now()
                        }]);
                    }
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

function checkLinuxDependencies() {
    if (process.platform !== 'linux') return;
    const { exec } = require('child_process');
    exec('which xdotool', (err) => {
        if (err) {
            dialog.showMessageBox({
                type: 'info',
                title: 'Missing Dependency',
                message: 'Discord Gaming Overlay requires "xdotool" for the typing hotkey to work on Linux.\n\nWould you like to automatically install it now? (You will be prompted for your password via pkexec)',
                buttons: ['Install', 'Cancel'],
                defaultId: 0
            }).then(result => {
                if (result.response === 0) {
                    exec('which apt-get || which pacman || which dnf', (err2, stdout) => {
                        const pkg = stdout ? stdout.trim() : '';
                        let cmd = '';
                        if (pkg.includes('apt-get')) cmd = 'pkexec apt-get install -y xdotool';
                        else if (pkg.includes('pacman')) cmd = 'pkexec pacman -S --noconfirm xdotool';
                        else if (pkg.includes('dnf')) cmd = 'pkexec dnf install -y xdotool';
                        
                        if (cmd) {
                            exec(cmd, (err3, stdout3, stderr3) => {
                                if (err3) {
                                    dialog.showMessageBox({ type: 'error', message: 'Failed to install xdotool.\n\n' + (stderr3 || err3.message) });
                                } else {
                                    dialog.showMessageBox({ type: 'info', message: 'xdotool installed successfully! The typing hotkey will now work.' });
                                }
                            });
                        } else {
                            dialog.showMessageBox({ type: 'error', message: 'Could not detect package manager to install xdotool automatically.' });
                        }
                    });
                }
            });
        }
    });
}

app.whenReady().then(() => {
    checkLinuxDependencies();
    updateVencordPlugin();

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
