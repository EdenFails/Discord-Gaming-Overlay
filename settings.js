const { ipcRenderer } = require('electron');

const opacityInput = document.getElementById('opacity-input');
const opacityVal = document.getElementById('opacity-val');
const msgOpacityInput = document.getElementById('msg-opacity-input');
const msgOpacityVal = document.getElementById('msg-opacity-val');
const autoHideInput = document.getElementById('auto-hide-input');
const autoHideDelayInput = document.getElementById('auto-hide-delay-input');
const deleteMessagesInput = document.getElementById('delete-messages-input');
const typingKeepsAwakeInput = document.getElementById('typing-keeps-awake-input');
const highlightMessagesInput = document.getElementById('highlight-messages-input');
const highlightKeywordsInput = document.getElementById('highlight-keywords-input');
const showTextSectionInput = document.getElementById('show-text-section-input');
const showVoiceSectionInput = document.getElementById('show-voice-section-input');
const showVoiceNotifsInput = document.getElementById('show-voice-notifs-input');
const autoMonitorVoiceInput = document.getElementById('auto-monitor-voice-input');
const voiceThresholdInput = document.getElementById('voice-threshold-input');
const voiceThresholdVal = document.getElementById('voice-threshold-val');
const textHeightInput = document.getElementById('text-height-input');
const voiceHeightInput = document.getElementById('voice-height-input');
const autoExpandVoiceInput = document.getElementById('auto-expand-voice-input');
const voiceSortInput = document.getElementById('voice-sort-input');
const themeInput = document.getElementById('theme-input');
const displayInput = document.getElementById('display-input');
const positionInput = document.getElementById('position-input');
const visibilityKeyInput = document.getElementById('visibility-key-input');
const typingKeyInput = document.getElementById('typing-key-input');
const vencordPluginPathInput = document.getElementById('vencord-plugin-path-input');
const messageChimeInput = document.getElementById('message-chime-input');
const chimeCooldownInput = document.getElementById('chime-cooldown-input');
const chimeCooldownVal = document.getElementById('chime-cooldown-val');
const saveBtn = document.getElementById('save-btn');

// Send live preview updates
function sendLiveUpdate() {
    ipcRenderer.send('preview-settings', {
        opacity: parseFloat(opacityInput.value),
        msgOpacity: parseFloat(msgOpacityInput.value),
        autoHide: autoHideInput.checked,
        autoHideDelay: parseInt(autoHideDelayInput.value),
        deleteMessages: deleteMessagesInput.checked,
        typingKeepsAwake: typingKeepsAwakeInput ? typingKeepsAwakeInput.checked : true,
        showTextSection: showTextSectionInput.checked,
        showVoiceSection: showVoiceSectionInput.checked,
        showVoiceNotifs: showVoiceNotifsInput.checked,
        autoMonitorVoice: autoMonitorVoiceInput.checked,
        voiceSpeakingThreshold: parseFloat(voiceThresholdInput.value) || 0.5,
        textSectionHeight: parseInt(textHeightInput.value) || 140,
        voiceSectionHeight: parseInt(voiceHeightInput.value) || 250,
        autoExpandVoice: autoExpandVoiceInput.checked,
        voiceSortOrder: voiceSortInput.value,
        theme: themeInput ? themeInput.value : 'default',
        highlightMessages: highlightMessagesInput ? highlightMessagesInput.checked : true,
        highlightKeywords: highlightKeywordsInput ? highlightKeywordsInput.value : '',
        displayId: parseInt(displayInput.value),
        position: positionInput.value,
        messageChimeEnabled: messageChimeInput.checked,
        messageChimeCooldown: parseInt(chimeCooldownInput.value) || 5
    });
}

// Update opacity percentage text live and preview
opacityInput.addEventListener('input', () => {
    opacityVal.textContent = Math.round(opacityInput.value * 100) + '%';
    sendLiveUpdate();
});

msgOpacityInput.addEventListener('input', () => {
    msgOpacityVal.textContent = Math.round(msgOpacityInput.value * 100) + '%';
    sendLiveUpdate();
});

if (voiceThresholdInput) {
    voiceThresholdInput.addEventListener('input', () => {
        if (voiceThresholdVal) voiceThresholdVal.textContent = `${voiceThresholdInput.value}s`;
        sendLiveUpdate();
    });
}

if (chimeCooldownInput) {
    chimeCooldownInput.addEventListener('input', () => {
        if (chimeCooldownVal) {
            chimeCooldownVal.textContent = parseInt(chimeCooldownInput.value) + 's';
        }
        sendLiveUpdate();
    });
}

function updateVoiceHeightDisabledState() {
    voiceHeightInput.disabled = autoExpandVoiceInput.checked;
    voiceHeightInput.style.opacity = autoExpandVoiceInput.checked ? '0.4' : '1';
}

autoExpandVoiceInput.addEventListener('change', () => {
    updateVoiceHeightDisabledState();
    sendLiveUpdate();
});

function updateAutoHideDisabledState() {
    const autoHideDelayGroup = document.getElementById('auto-hide-delay-group');
    if (autoHideDelayGroup) {
        autoHideDelayGroup.style.opacity = autoHideInput.checked ? '1' : '0.4';
        autoHideDelayInput.disabled = !autoHideInput.checked;
    }
}

autoHideInput.addEventListener('change', () => {
    updateAutoHideDisabledState();
    sendLiveUpdate();
});
autoHideDelayInput.addEventListener('change', sendLiveUpdate);
autoHideDelayInput.addEventListener('input', sendLiveUpdate);
deleteMessagesInput.addEventListener('change', sendLiveUpdate);
if (typingKeepsAwakeInput) typingKeepsAwakeInput.addEventListener('change', sendLiveUpdate);
if (highlightMessagesInput) highlightMessagesInput.addEventListener('change', sendLiveUpdate);
if (highlightKeywordsInput) highlightKeywordsInput.addEventListener('input', sendLiveUpdate);
showTextSectionInput.addEventListener('change', sendLiveUpdate);
showVoiceSectionInput.addEventListener('change', sendLiveUpdate);
showVoiceNotifsInput.addEventListener('change', sendLiveUpdate);
autoMonitorVoiceInput.addEventListener('change', sendLiveUpdate);
textHeightInput.addEventListener('input', sendLiveUpdate);
textHeightInput.addEventListener('change', sendLiveUpdate);
voiceHeightInput.addEventListener('input', sendLiveUpdate);
voiceHeightInput.addEventListener('change', sendLiveUpdate);
if (voiceSortInput) voiceSortInput.addEventListener('change', sendLiveUpdate);
if (themeInput) themeInput.addEventListener('change', sendLiveUpdate);
if (messageChimeInput) messageChimeInput.addEventListener('change', sendLiveUpdate);

// Keybind listener logic
let currentRecordingInput = null;

function setupKeybindListener(inputElement) {
    inputElement.addEventListener('focus', () => {
        currentRecordingInput = inputElement;
        inputElement.value = 'Listening...';
        ipcRenderer.send('start-recording-hotkey');
    });
    
    inputElement.addEventListener('blur', () => {
        if (currentRecordingInput === inputElement) {
            ipcRenderer.send('cancel-recording-hotkey');
            currentRecordingInput = null;
        }
    });
}

ipcRenderer.on('recording-hotkey-progress', (event, combo) => {
    if (currentRecordingInput) {
        currentRecordingInput.value = combo;
    }
});

ipcRenderer.on('recording-hotkey-done', (event, combo) => {
    if (currentRecordingInput) {
        currentRecordingInput.value = combo;
        sendLiveUpdate();
        currentRecordingInput.blur();
        currentRecordingInput = null;
    }
});

setupKeybindListener(visibilityKeyInput);
setupKeybindListener(typingKeyInput);

displayInput.addEventListener('change', sendLiveUpdate);
positionInput.addEventListener('change', sendLiveUpdate);

// Load current settings from main process
ipcRenderer.on('load-settings', (event, { config, displays }) => {
    opacityInput.value = config.opacity;
    opacityVal.textContent = Math.round(config.opacity * 100) + '%';
    
    msgOpacityInput.value = config.msgOpacity || 0;
    msgOpacityVal.textContent = Math.round((config.msgOpacity || 0) * 100) + '%';
    
    autoHideInput.checked = config.autoHide !== false;
    autoHideDelayInput.value = config.autoHideDelay || 20;
    deleteMessagesInput.checked = config.deleteMessages !== false;
    if (typingKeepsAwakeInput) {
        typingKeepsAwakeInput.checked = config.typingKeepsAwake !== false;
    }
    if (highlightMessagesInput) {
        highlightMessagesInput.checked = config.highlightMessages !== false;
    }
    if (highlightKeywordsInput) {
        highlightKeywordsInput.value = config.highlightKeywords || '';
    }
    showTextSectionInput.checked = config.showTextSection !== false;
    showVoiceSectionInput.checked = config.showVoiceSection !== false;
    showVoiceNotifsInput.checked = config.showVoiceNotifs !== false;
    autoMonitorVoiceInput.checked = config.autoMonitorVoice !== false;
    if (voiceThresholdInput) {
        const thresholdVal = typeof config.voiceSpeakingThreshold === 'number' ? config.voiceSpeakingThreshold : 0.5;
        voiceThresholdInput.value = thresholdVal;
        if (voiceThresholdVal) voiceThresholdVal.textContent = `${thresholdVal}s`;
    }
    textHeightInput.value = config.textSectionHeight || 140;
    voiceHeightInput.value = config.voiceSectionHeight || 250;
    autoExpandVoiceInput.checked = Boolean(config.autoExpandVoice);
    updateVoiceHeightDisabledState();
    updateAutoHideDisabledState();
    if (voiceSortInput) voiceSortInput.value = config.voiceSortOrder || 'friends';
    if (themeInput) {
        if (Array.isArray(data.customThemes) && data.customThemes.length > 0) {
            let customGroup = themeInput.querySelector('optgroup[label="Custom Themes"]');
            if (!customGroup) {
                customGroup = document.createElement('optgroup');
                customGroup.label = "Custom Themes (from /themes folder)";
                themeInput.appendChild(customGroup);
            }
            customGroup.innerHTML = '';
            data.customThemes.forEach(ct => {
                const opt = document.createElement('option');
                opt.value = ct.id;
                opt.textContent = ct.displayName;
                customGroup.appendChild(opt);
            });
        }
        const targetTheme = config.theme || 'default';
        themeInput.value = targetTheme;
        Array.from(themeInput.options).forEach(opt => {
            opt.selected = (opt.value === targetTheme);
        });
    }

    positionInput.value = config.position;
    visibilityKeyInput.value = config.visibilityKey;
    typingKeyInput.value = config.typingKey;
    if (vencordPluginPathInput) {
        vencordPluginPathInput.value = config.vencordPluginPath || '';
    }
    if (messageChimeInput) {
        messageChimeInput.checked = config.messageChimeEnabled !== false;
    }
    if (chimeCooldownInput) {
        chimeCooldownInput.value = config.messageChimeCooldown ?? 5;
        if (chimeCooldownVal) chimeCooldownVal.textContent = (config.messageChimeCooldown ?? 5) + 's';
    }
    
    // Populate displays
    displayInput.innerHTML = '';
    displays.forEach((display, index) => {
        const option = document.createElement('option');
        option.value = display.id;
        const isPrimary = display.bounds.x === 0 && display.bounds.y === 0 ? " (Primary)" : "";
        option.textContent = `Display ${index + 1} - ${display.bounds.width}x${display.bounds.height}${isPrimary}`;
        displayInput.appendChild(option);
    });
    
    // Select current display
    if (config.displayId) {
        displayInput.value = config.displayId;
    } else if (displays.length > 0) {
        // Fallback to primary if not set
        const primary = displays.find(d => d.bounds.x === 0 && d.bounds.y === 0) || displays[0];
        displayInput.value = primary.id;
    }
});

saveBtn.addEventListener('click', () => {
    const newConfig = {
        opacity: parseFloat(opacityInput.value),
        msgOpacity: parseFloat(msgOpacityInput.value),
        autoHide: autoHideInput.checked,
        autoHideDelay: parseInt(autoHideDelayInput.value),
        deleteMessages: deleteMessagesInput.checked,
        typingKeepsAwake: typingKeepsAwakeInput ? typingKeepsAwakeInput.checked : true,
        showTextSection: showTextSectionInput.checked,
        showVoiceSection: showVoiceSectionInput.checked,
        showVoiceNotifs: showVoiceNotifsInput.checked,
        autoMonitorVoice: autoMonitorVoiceInput.checked,
        voiceSpeakingThreshold: voiceThresholdInput ? parseFloat(voiceThresholdInput.value) || 0.5 : 0.5,
        textSectionHeight: parseInt(textHeightInput.value) || 140,
        voiceSectionHeight: parseInt(voiceHeightInput.value) || 250,
        autoExpandVoice: autoExpandVoiceInput.checked,
        voiceSortOrder: voiceSortInput.value,
        theme: themeInput ? themeInput.value : 'default',
        highlightMessages: highlightMessagesInput ? highlightMessagesInput.checked : true,
        highlightKeywords: highlightKeywordsInput ? highlightKeywordsInput.value : '',
        displayId: parseInt(displayInput.value),
        position: positionInput.value,
        visibilityKey: visibilityKeyInput.value,
        typingKey: typingKeyInput.value,
        vencordPluginPath: vencordPluginPathInput ? vencordPluginPathInput.value : '',
        messageChimeEnabled: messageChimeInput ? messageChimeInput.checked : true,
        messageChimeCooldown: chimeCooldownInput ? (parseInt(chimeCooldownInput.value) || 5) : 5
    };
    
    saveBtn.textContent = 'Saved!';
    saveBtn.style.backgroundColor = '#2e8b57';
    
    setTimeout(() => {
        saveBtn.textContent = 'Save Settings';
        saveBtn.style.backgroundColor = '#5865F2';
    }, 1500);

    ipcRenderer.send('save-settings', newConfig);
});

// Request settings from main process immediately on script load
ipcRenderer.send('request-settings');
