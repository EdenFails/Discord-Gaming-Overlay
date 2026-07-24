const { ipcRenderer } = require('electron');

const container = document.getElementById('container');
const messagesContainer = document.getElementById('messages-container');
const inputContainer = document.getElementById('input-container');
const chatInput = document.getElementById('chat-input');

let isTyping = false;
let autoHide = true;
let autoHideDelay = 20;
let hideTimeout = null;
let syncDeletedMessages = true;

let sectionsConfig = {
    showTextSection: true,
    showVoiceSection: true,
    showVoiceNotifs: true,
    textSectionHeight: 140,
    voiceSectionHeight: 250,
    autoExpandVoice: false
};

let hasConnectedMessagesChannel = false;

ipcRenderer.on('set-sections-config', (event, config) => {
    sectionsConfig = config;
    updateSectionsVisibility();
});

function updateSectionsVisibility() {
    const textSection = document.getElementById('text-section');
    const voiceSection = document.getElementById('voice-section');
    const voiceNotifs = document.getElementById('voice-notifs-container');
    const messagesContainer = document.getElementById('messages-container');
    const voiceUsersContainer = document.getElementById('voice-users-container');

    const showText = sectionsConfig.showTextSection && hasConnectedMessagesChannel;
    const showVoice = sectionsConfig.showVoiceSection;

    if (textSection) {
        textSection.style.display = showText ? 'block' : 'none';
    }
    if (voiceSection) {
        voiceSection.style.display = showVoice ? 'flex' : 'none';
    }
    if (voiceNotifs) {
        voiceNotifs.style.display = sectionsConfig.showVoiceNotifs ? 'flex' : 'none';
    }

    const tHeight = sectionsConfig.textSectionHeight || 140;
    const vHeight = sectionsConfig.voiceSectionHeight || 250;
    
    if (messagesContainer) {
        messagesContainer.style.maxHeight = `${tHeight}px`;
    }
    if (voiceUsersContainer) {
        voiceUsersContainer.style.maxHeight = `${vHeight}px`;
    }
}

function resetHideTimer() {
    if (hideTimeout) clearTimeout(hideTimeout);
    
    if (!autoHide || isTyping) {
        container.style.opacity = 1;
        return;
    }
    
    container.style.opacity = 1;
    hideTimeout = setTimeout(() => {
        container.style.opacity = 0;
    }, autoHideDelay * 1000);
}

ipcRenderer.on('set-auto-hide', (event, config) => {
    autoHide = config.autoHide;
    autoHideDelay = config.autoHideDelay;
    resetHideTimer();
});

ipcRenderer.on('set-sync-deleted', (event, sync) => {
    syncDeletedMessages = sync;
});

ipcRenderer.on('set-opacity', (event, opacity) => {
    container.style.background = `rgba(0, 0, 0, ${opacity})`;
    resetHideTimer();
});

ipcRenderer.on('set-msg-opacity', (event, msgOpacity) => {
    let styleTag = document.getElementById('dynamic-msg-style');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-msg-style';
        document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = `.gaming-overlay-message { background-color: rgba(0, 0, 0, ${msgOpacity}) !important; border-radius: 4px; padding: 4px; margin-bottom: 2px; }`;
});

// Simple custom emoji parser: <:name:id> -> <img src="...">
function parseCustomEmojis(text) {
    if (!text) return "";
    
    // Parse fake nitro markdown links for emojis
    text = text.replace(/\[([^\]]+)\]\((https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.(?:webp|gif|png)[^\)]*)\)/g, (match, name, url) => {
        return `<img src="${url}" alt=":${name}:" title=":${name}:" class="emoji">`;
    });

    // Parse standard custom emojis
    return text.replace(/<a?:(\w+):(\d+)>/g, (match, name, id) => {
        const isAnimated = match.startsWith("<a:");
        const ext = isAnimated ? "gif" : "webp";
        return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=44" alt=":${name}:" title=":${name}:" class="emoji">`;
    });
}

ipcRenderer.on('toggle-typing', (event, typingMode) => {
    isTyping = typingMode;
    
    if (typingMode) {
        container.classList.add('typing-active');
        inputContainer.style.display = 'block';
        chatInput.focus();
    } else {
        container.classList.remove('typing-active');
        inputContainer.style.display = 'none';
        chatInput.blur();
    }
    resetHideTimer();
});

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let lastMessagesJson = '';

function createMessageElement(m) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'gaming-overlay-message';
    msgDiv.dataset.msgId = m.id;
    
    // Strip image/GIF/Tenor URLs from text line to keep messages compact
    const mediaUrlRegex = /(https?:\/\/[^\s]+\.(?:gif|png|jpe?g|webp))|(https?:\/\/(?:media\.)?tenor\.com\/[^\s]+)|(https?:\/\/(?:media\.)?giphy\.com\/[^\s]+)/gi;
    const cleanContent = (m.content || '').replace(mediaUrlRegex, '').trim();

    if (cleanContent) {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'gaming-overlay-author';
        authorSpan.style.color = m.author.color;
        authorSpan.textContent = m.author.username + ': ';
        
        const contentSpan = document.createElement('span');
        contentSpan.className = 'gaming-overlay-content';
        contentSpan.innerHTML = parseCustomEmojis(cleanContent);
        
        msgDiv.appendChild(authorSpan);
        msgDiv.appendChild(contentSpan);
    } else {
        const authorSpan = document.createElement('span');
        authorSpan.className = 'gaming-overlay-author';
        authorSpan.style.color = m.author.color;
        authorSpan.textContent = m.author.username + ':';
        msgDiv.appendChild(authorSpan);
    }

    let hasRenderedMedia = false;

    if (m.attachments && m.attachments.length > 0) {
        m.attachments.forEach(a => {
            const isImage = (a.content_type && a.content_type.startsWith('image/')) || 
                            (a.filename && /\.(gif|png|jpe?g|webp)$/i.test(a.filename)) ||
                            (a.url && /\.(gif|png|jpe?g|webp)/i.test(a.url));
            if (isImage) {
                hasRenderedMedia = true;
                const mediaSrc = a.proxy_url || a.url;
                const img = document.createElement('img');
                img.src = mediaSrc;
                img.className = 'gaming-overlay-attachment';
                img.onerror = () => { img.remove(); };
                img.onload = () => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                };
                msgDiv.appendChild(img);
            } else {
                const fileDiv = document.createElement('div');
                fileDiv.className = 'gaming-overlay-file';
                fileDiv.textContent = a.filename || 'Unknown File';
                msgDiv.appendChild(fileDiv);
            }
        });
    }

    if (m.embeds && m.embeds.length > 0) {
        m.embeds.forEach(e => {
            const mediaUrl = e.video || e.image || e.thumbnail || (e.url && /\.(gif|png|jpe?g|webp|mp4)/i.test(e.url) ? e.url : null);
            if (mediaUrl) {
                hasRenderedMedia = true;
                if (/\.(mp4|webm)/i.test(mediaUrl) || e.type === 'gifv' || e.video) {
                    const vid = document.createElement('video');
                    vid.src = mediaUrl;
                    vid.autoplay = true;
                    vid.loop = true;
                    vid.muted = true;
                    vid.setAttribute('playsinline', '');
                    vid.className = 'gaming-overlay-attachment';
                    vid.onerror = () => { vid.remove(); };
                    vid.onloadeddata = () => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    };
                    msgDiv.appendChild(vid);
                } else {
                    const img = document.createElement('img');
                    img.src = mediaUrl;
                    img.className = 'gaming-overlay-attachment';
                    img.onerror = () => { img.remove(); };
                    img.onload = () => {
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    };
                    msgDiv.appendChild(img);
                }
            }
        });
    }

    if (!hasRenderedMedia && m.content) {
        const directImgMatch = m.content.match(/https?:\/\/[^\s]+?\.(?:gif|png|jpe?g|webp|mp4)(?:\?[^\s]*)?/i);
        if (directImgMatch && directImgMatch[0]) {
            const mediaUrl = directImgMatch[0];
            hasRenderedMedia = true;
            if (/\.(mp4|webm)/i.test(mediaUrl)) {
                const vid = document.createElement('video');
                vid.src = mediaUrl;
                vid.autoplay = true;
                vid.loop = true;
                vid.muted = true;
                vid.setAttribute('playsinline', '');
                vid.className = 'gaming-overlay-attachment';
                vid.onerror = () => { vid.remove(); };
                vid.onloadeddata = () => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                };
                msgDiv.appendChild(vid);
            } else {
                const img = document.createElement('img');
                img.src = mediaUrl;
                img.className = 'gaming-overlay-attachment';
                img.onerror = () => { img.remove(); };
                img.onload = () => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                };
                msgDiv.appendChild(img);
            }
        }
    }
    return msgDiv;
}

ipcRenderer.on('messages-update', (event, messages) => {
    if (syncDeletedMessages && messages) {
        messages = messages.filter(m => m.state !== 'DELETED');
    }

    if (!messages || messages.length === 0) {
        hasConnectedMessagesChannel = false;
        messagesContainer.innerHTML = '';
        updateSectionsVisibility();
        return;
    }

    hasConnectedMessagesChannel = true;
    updateSectionsVisibility();

    const currentJson = JSON.stringify(messages);
    if (currentJson === lastMessagesJson) return;
    lastMessagesJson = currentJson;
    
    // Incremental DOM update: reuse existing message elements by data-msg-id
    const existingMsgMap = new Map();
    Array.from(messagesContainer.children).forEach(child => {
        if (child.dataset && child.dataset.msgId) {
            existingMsgMap.set(child.dataset.msgId, child);
        }
    });

    const newMsgSet = new Set(messages.map(m => m.id));

    // Remove deleted messages
    existingMsgMap.forEach((node, id) => {
        if (!newMsgSet.has(id)) {
            node.remove();
            existingMsgMap.delete(id);
        }
    });

    messages.forEach(m => {
        let msgNode = existingMsgMap.get(m.id);
        if (!msgNode) {
            msgNode = createMessageElement(m);
            messagesContainer.appendChild(msgNode);
        }
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    resetHideTimer();
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const content = chatInput.value.trim();
        if (content) {
            ipcRenderer.send('send-message', content);
            chatInput.value = '';
        }
    }
});

let currentVoiceSortOrder = 'friends';
let lastVoiceData = null;

ipcRenderer.on('set-voice-sort', (event, sortOrder) => {
    currentVoiceSortOrder = sortOrder || 'friends';
    if (lastVoiceData) {
        renderVoiceOverlay(lastVoiceData);
    }
});

let lastUserCount = -1;

// Voice Overlay rendering
ipcRenderer.on('voice-update', (event, data) => {
    lastVoiceData = data;
    renderVoiceOverlay(data);
    if (data && Array.isArray(data.users)) {
        const currentCount = data.users.length;
        if (currentCount !== lastUserCount) {
            lastUserCount = currentCount;
            ipcRenderer.send('voice-user-count', currentCount);
        }
    }
    resetHideTimer();
});

function sortVoiceUsers(users, sortMode) {
    if (!users || !Array.isArray(users)) return [];
    const sorted = [...users];

    sorted.sort((a, b) => {
        if (!a || !b) return 0;
        const nameA = a.username || '';
        const nameB = b.username || '';

        if (sortMode === 'speaking') {
            if (Boolean(a.isSpeaking) !== Boolean(b.isSpeaking)) return a.isSpeaking ? -1 : 1;
            if (Boolean(a.isFriend) !== Boolean(b.isFriend)) return a.isFriend ? -1 : 1;
        } else if (sortMode === 'staff') {
            if (Boolean(a.isStaff) !== Boolean(b.isStaff)) return a.isStaff ? -1 : 1;
            if (Boolean(a.isFriend) !== Boolean(b.isFriend)) return a.isFriend ? -1 : 1;
        } else if (sortMode === 'friends') {
            // Default: Friends first! Stable position when speaking.
            if (Boolean(a.isFriend) !== Boolean(b.isFriend)) return a.isFriend ? -1 : 1;
            if (Boolean(a.isStaff) !== Boolean(b.isStaff)) return a.isStaff ? -1 : 1;
        } else if (sortMode === 'alphabetical') {
            // Pure alphabetical order
        }
        
        return nameA.localeCompare(nameB);
    });

    return sorted;
}

function renderVoiceOverlay(data) {
    const voiceUsersContainer = document.getElementById('voice-users-container');
    const voiceNotifsContainer = document.getElementById('voice-notifs-container');
    if (!voiceUsersContainer || !voiceNotifsContainer) return;

    // Render Notifications
    const newNotifsHtml = (data.eventLogs || []).slice(0, 3).map(log => 
        `<div class="voice-notif-item ${log.type}">${escapeHtml(log.text)}</div>`
    ).join('');
    if (voiceNotifsContainer.innerHTML !== newNotifsHtml) {
        voiceNotifsContainer.innerHTML = newNotifsHtml;
    }

    // Render Connected Voice Users (Sorted)
    if (!data.users || data.users.length === 0) {
        const emptyText = data.voiceChannelName ? `No one in ${data.voiceChannelName}` : 'No voice channel connected';
        if (voiceUsersContainer.dataset.emptyText !== emptyText) {
            voiceUsersContainer.dataset.emptyText = emptyText;
            voiceUsersContainer.innerHTML = `<div style="color: rgba(255,255,255,0.4); font-size: 12px; font-style: italic;">${escapeHtml(emptyText)}</div>`;
        }
        return;
    }
    delete voiceUsersContainer.dataset.emptyText;

    const sortedUsers = sortVoiceUsers(data.users, currentVoiceSortOrder);

    // Map existing card elements by userId
    const existingCards = new Map();
    Array.from(voiceUsersContainer.children).forEach(child => {
        if (child.dataset && child.dataset.userId) {
            existingCards.set(child.dataset.userId, child);
        }
    });

    sortedUsers.forEach((user, index) => {
        const uId = String(user.userId || user.id || '');
        let card = uId ? existingCards.get(uId) : null;
        
        let badgesHtml = '';
        if (user.isWatchingYou) badgesHtml += '<span class="voice-badge watching" title="Watching your stream">👁</span>';
        if (user.isLive) badgesHtml += '<span class="voice-badge live">LIVE</span>';
        if (user.isForceDeafened) badgesHtml += '<span class="voice-badge force">Muted/Deafened</span>';
        else if (user.isDeafened) badgesHtml += '<span class="voice-badge">Deafened</span>';
        else if (user.isForceMuted) badgesHtml += '<span class="voice-badge force">Muted</span>';
        else if (user.isMuted) badgesHtml += '<span class="voice-badge">Muted</span>';

        if (card) {
            if (uId) existingCards.delete(uId);

            // In-place update speaking ring
            const avatarImg = card.querySelector('.voice-user-avatar');
            if (avatarImg) {
                const isSpk = Boolean(user.isSpeaking);
                if (avatarImg.classList.contains('speaking') !== isSpk) {
                    avatarImg.classList.toggle('speaking', isSpk);
                }
            }

            // In-place update badges
            const badgesDiv = card.querySelector('.voice-status-badges');
            if (badgesDiv && badgesDiv.innerHTML !== badgesHtml) {
                badgesDiv.innerHTML = badgesHtml;
            }

            // Reorder node if necessary
            if (voiceUsersContainer.children[index] !== card) {
                voiceUsersContainer.insertBefore(card, voiceUsersContainer.children[index] || null);
            }
        } else {
            // Create new card
            card = document.createElement('div');
            card.className = 'voice-user-card';
            if (uId) card.dataset.userId = uId;

            const avatarWrapper = document.createElement('div');
            avatarWrapper.className = 'voice-avatar-wrapper';

            const img = document.createElement('img');
            img.src = user.avatarUrl;
            img.className = `voice-user-avatar ${user.isSpeaking ? 'speaking' : ''}`;
            avatarWrapper.appendChild(img);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'voice-user-name';
            nameSpan.textContent = user.username;

            const badgesDiv = document.createElement('div');
            badgesDiv.className = 'voice-status-badges';
            badgesDiv.innerHTML = badgesHtml;

            card.appendChild(avatarWrapper);
            card.appendChild(nameSpan);
            card.appendChild(badgesDiv);

            if (voiceUsersContainer.children[index]) {
                voiceUsersContainer.insertBefore(card, voiceUsersContainer.children[index]);
            } else {
                voiceUsersContainer.appendChild(card);
            }
        }
    });

    // Remove any users who left
    existingCards.forEach(oldCard => oldCard.remove());
}

