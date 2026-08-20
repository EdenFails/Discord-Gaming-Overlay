import definePlugin from "@utils/types";
import { sendMessage } from "@utils/discord";
import { 
    React, 
    Menu, 
    showToast, 
    Toasts, 
    MessageStore, 
    FluxDispatcher, 
    ChannelStore, 
    GuildMemberStore,
    VoiceStateStore,
    SelectedChannelStore,
    UserStore,
    RelationshipStore,
    ApplicationStreamingStore,
    ChannelRTCStore,
    TypingStore
} from "@webpack/common";
import { findByProps, findStore } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";

let activeChannelId: string | null = null;
let activeVoiceChannelId: string | null = null;
let typingInterval: any = null;
let stoppedVoiceChannelId: string | null = null;
let autoMonitorVoiceSetting = true;
let ws: WebSocket | null = null;
let isConnecting = false;
let lastConnectAttempt = 0;

let previousVoiceStatesMap: Record<string, any> = {};
let speakingUsersSet = new Set<string>();
let eventLogList: Array<{ id: string; text: string; type: string; timestamp: number }> = [];

function ensureWebSocketConnected(onOpenCallback?: () => void) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (onOpenCallback) onOpenCallback();
        return;
    }

    if (isConnecting || (Date.now() - lastConnectAttempt < 3000)) {
        return;
    }

    isConnecting = true;
    lastConnectAttempt = Date.now();

    if (ws) {
        try { ws.close(); } catch(e) {}
        ws = null;
    }

    try {
        ws = new WebSocket("ws://127.0.0.1:6969");
        
        ws.onopen = () => {
            isConnecting = false;
            console.log("[GamingOverlay Bridge] Connected to Overlay App");
            if (onOpenCallback) onOpenCallback();
            sendMessagesToOverlay();
            sendVoiceToOverlay();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "SEND_MESSAGE" && data.content) {
                    const sStore = SelectedChannelStore || findStore("SelectedChannelStore") || findByProps("getChannelId", "getVoiceChannelId");
                    const targetChannelId = activeChannelId || 
                                            (sStore && typeof sStore.getChannelId === "function" ? sStore.getChannelId() : null) || 
                                            (sStore && typeof sStore.getVoiceChannelId === "function" ? sStore.getVoiceChannelId() : null);
                    
                    console.log("[GamingOverlay Bridge] Received SEND_MESSAGE request for target channel:", targetChannelId, "Content:", data.content);

                    if (targetChannelId) {
                        try {
                            sendMessage(targetChannelId, { content: data.content });
                            console.log("[GamingOverlay Bridge] Message sent successfully via Vencord sendMessage utility!");
                        } catch (err) {
                            console.error("[GamingOverlay Bridge] Failed to send message via Vencord sendMessage utility:", err);
                        }
                    } else {
                        console.error("[GamingOverlay Bridge] No targetChannelId available! Please select or monitor a channel first.");
                    }
                } else if (data.type === "CONFIG_UPDATE") {
                    if (typeof data.autoMonitorVoice === "boolean") {
                        autoMonitorVoiceSetting = data.autoMonitorVoice;
                        sendVoiceToOverlay();
                    }
                } else if (data.type === "TOGGLE_SOFT_MUTE") {
                    toggleSoftMute();
                } else if (data.type === "SET_SOFT_MUTE") {
                    setSoftMute(Boolean(data.state));
                } else if (data.type === "TOGGLE_SOFT_DEAFEN") {
                    toggleSoftDeafen();
                } else if (data.type === "SET_SOFT_DEAFEN") {
                    setSoftDeafen(Boolean(data.state));
                }
            } catch (e) {
                console.error("Overlay Bridge WS Error:", e);
            }
        };

        ws.onclose = () => {
            isConnecting = false;
            ws = null;
        };

        ws.onerror = () => {
            isConnecting = false;
            ws = null;
        };

        if (FluxDispatcher) {
            FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageEvent);
            FluxDispatcher.subscribe("MESSAGE_UPDATE", handleMessageEvent);
            FluxDispatcher.subscribe("MESSAGE_DELETE", handleMessageEvent);
            FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", handleVoiceEvent);
            FluxDispatcher.subscribe("RTC_CONNECTION_STATE", handleVoiceEvent);
            FluxDispatcher.subscribe("CHANNEL_SELECT", handleVoiceEvent);
            FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceEvent);
            FluxDispatcher.subscribe("SPEAKING", handleSpeakingEvent);
            FluxDispatcher.subscribe("STREAM_CREATE", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_UPDATE", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_DELETE", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_WATCH", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_CLOSE", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_USER_JOIN", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_USER_LEAVE", handleVoiceEvent);
            FluxDispatcher.subscribe("STREAM_UPDATE_SELF", handleVoiceEvent);
            FluxDispatcher.subscribe("MEDIA_ENGINE_PERMISSION", handleVoiceEvent);
        }

    } catch (e) {
        isConnecting = false;
        ws = null;
    }
}

function getConnectedVoiceChannelId(): string | null {
    try {
        const sStore = SelectedChannelStore || findStore("SelectedChannelStore") || findByProps("getVoiceChannelId");
        if (sStore && typeof sStore.getVoiceChannelId === "function") {
            const vId = sStore.getVoiceChannelId();
            if (vId) return vId;
        }

        const vStore = VoiceStateStore || findStore("VoiceStateStore") || findByProps("getVoiceStateForUser");
        const uStore = UserStore || findStore("UserStore") || findByProps("getCurrentUser");
        const myId = uStore?.getCurrentUser?.()?.id;
        if (myId && vStore && typeof vStore.getVoiceStateForUser === "function") {
            const myState = vStore.getVoiceStateForUser(myId);
            if (myState && myState.channelId) return myState.channelId;
        }

        const fallbackStore = findByProps("getVoiceChannelId", "getChannelId");
        if (fallbackStore && typeof fallbackStore.getVoiceChannelId === "function") {
            const vId = fallbackStore.getVoiceChannelId();
            if (vId) return vId;
        }
    } catch (e) {
        console.error("Error in getConnectedVoiceChannelId:", e);
    }
    return null;
}

function sendMessagesToOverlay() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;

    try {
        const store = MessageStore || findStore("MessageStore");
        if (!store) return;
        
        const msgs = store.getMessages(activeChannelId);
        let msgArray = [];
        if (Array.isArray(msgs)) msgArray = msgs;
        else if (msgs && typeof msgs.toArray === 'function') msgArray = msgs.toArray();
        else if (msgs && Array.isArray(msgs._array)) msgArray = msgs._array;

        const channel = ChannelStore ? ChannelStore.getChannel(activeChannelId) : null;
        const guildId = channel ? channel.guild_id : null;

        const uStore = UserStore || findStore("UserStore") || findByProps("getCurrentUser");
        let currentUser = null;
        try {
            if (uStore && typeof uStore.getCurrentUser === "function") {
                currentUser = uStore.getCurrentUser();
            }
        } catch (e) {}

        const myId = currentUser ? (currentUser.id || "") : "";
        const myUsername = currentUser ? (currentUser.username || "") : "";
        const myGlobalName = currentUser ? (currentUser.globalName || currentUser.username || "") : "";
        let myNickname = "";

        if (guildId && myId) {
            const gmStore = GuildMemberStore || findStore("GuildMemberStore") || findByProps("getMember");
            if (gmStore && typeof gmStore.getMember === "function") {
                const myMember = gmStore.getMember(guildId, myId);
                if (myMember && myMember.nick) {
                    myNickname = myMember.nick;
                }
            }
        }

        const myIdentifiers = {
            id: myId,
            username: myUsername,
            globalName: myGlobalName,
            nickname: myNickname
        };

        if (msgArray.length > 0) {
            const lastMsgs = msgArray.slice(-20)
                .filter((m: any) => m && (m.content || (m.attachments && m.attachments.length > 0) || (m.embeds && m.embeds.length > 0)))
                .map((m: any) => {
                    const author = m.author || {};
                    let memberColor = m.colorString;
                    
                    if (!memberColor && guildId && author.id && GuildMemberStore) {
                        const member = GuildMemberStore.getMember(guildId, author.id);
                        if (member && member.colorString) {
                            memberColor = member.colorString;
                        }
                    }

                    const isReply = Boolean(m.referenced_message || m.messageReference || m.type === 19);

                    return {
                        id: m.id,
                        content: m.content || "",
                        state: m.state,
                        isReply: isReply,
                        mentions: (m.mentions || []).map((user: any) => typeof user === 'string' ? user : (user.id || "")),
                        mention_everyone: Boolean(m.mention_everyone),
                        attachments: (m.attachments || []).map((a: any) => ({
                            url: a.url,
                            proxy_url: a.proxy_url,
                            content_type: a.content_type,
                            filename: a.filename,
                            width: a.width,
                            height: a.height
                        })),
                        embeds: (m.embeds || []).map((e: any) => {
                            let imgUrl = null;
                            if (e.image) imgUrl = e.image.proxyURL || e.image.url || (typeof e.image === 'string' ? e.image : null);
                            let thumbUrl = null;
                            if (e.thumbnail) thumbUrl = e.thumbnail.proxyURL || e.thumbnail.url || (typeof e.thumbnail === 'string' ? e.thumbnail : null);
                            let vidUrl = null;
                            if (e.video) vidUrl = e.video.proxyURL || e.video.url || (typeof e.video === 'string' ? e.video : null);

                            return {
                                type: e.type,
                                url: e.url,
                                image: imgUrl,
                                thumbnail: thumbUrl,
                                video: vidUrl
                            };
                        }),
                        author: {
                            id: author.id || "",
                            username: author.globalName || author.username || "System",
                            color: memberColor || '#ffffff'
                        }
                    };
                });

            ws.send(JSON.stringify({
                type: "MESSAGES_UPDATE",
                messages: lastMsgs,
                myIdentifiers: myIdentifiers
            }));
        }
    } catch (e: any) {
        console.error("Error parsing messages:", e);
    }
}

let isSoftMuted = false;
let isSoftDeafened = false;

function applySoftAudioState() {
    try {
        const meStore = MediaEngineStore || findStore("MediaEngineStore") || findByProps("getMediaEngine", "setSelfMute");
        const mediaEngine = meStore?.getMediaEngine?.() || meStore || findByProps("setSelfMute", "setSelfDeaf");
        
        if (mediaEngine) {
            if (typeof mediaEngine.setSelfMute === "function") mediaEngine.setSelfMute(isSoftMuted);
            if (typeof mediaEngine.setSelfDeafen === "function") mediaEngine.setSelfDeafen(isSoftDeafened);
            if (typeof mediaEngine.setMute === "function") mediaEngine.setMute(isSoftMuted);
            if (typeof mediaEngine.setDeaf === "function") mediaEngine.setDeaf(isSoftDeafened);

            const rawConns = mediaEngine.connections || meStore?.connections;
            let conns: any[] = [];
            if (rawConns instanceof Set) conns = Array.from(rawConns);
            else if (Array.isArray(rawConns)) conns = rawConns;
            else if (typeof mediaEngine.eachConnection === "function") {
                mediaEngine.eachConnection((c: any) => conns.push(c));
            }

            conns.forEach((conn: any) => {
                if (conn) {
                    if (typeof conn.setSelfMute === "function") conn.setSelfMute(isSoftMuted);
                    if (typeof conn.setSelfDeafen === "function") conn.setSelfDeafen(isSoftDeafened);
                    if (typeof conn.setMute === "function") conn.setMute(isSoftMuted);
                    if (typeof conn.setDeaf === "function") conn.setDeaf(isSoftDeafened);
                }
            });
        }

        const myId = UserStore?.getCurrentUser?.()?.id;
        if (myId && isSoftMuted) {
            speakingUsersSet.delete(myId);
        }
    } catch (e) {
        console.error("[GamingOverlay Bridge] Soft Mute/Deafen Error:", e);
    }
}

function setSoftMute(state: boolean) {
    if (isSoftMuted === state) return;
    isSoftMuted = state;
    if (!isSoftMuted && isSoftDeafened) {
        isSoftDeafened = false;
    }
    applySoftAudioState();
    addVoiceLog(isSoftMuted ? "🎙 Soft Muted (Local)" : "🎙 Soft Unmuted (Local)", isSoftMuted ? "force_mute" : "mute");
    sendVoiceToOverlay();
}

function setSoftDeafen(state: boolean) {
    if (isSoftDeafened === state) return;
    isSoftDeafened = state;
    if (isSoftDeafened) {
        isSoftMuted = true;
    }
    applySoftAudioState();
    addVoiceLog(isSoftDeafened ? "🎧 Soft Deafened (Local)" : "🎧 Soft Undeafened (Local)", isSoftDeafened ? "force_deafen" : "deafen");
    sendVoiceToOverlay();
}

function toggleSoftMute() {
    isSoftMuted = !isSoftMuted;
    if (!isSoftMuted && isSoftDeafened) {
        isSoftDeafened = false;
    }
    applySoftAudioState();
    addVoiceLog(isSoftMuted ? "🎙 Soft Muted (Local)" : "🎙 Soft Unmuted (Local)", isSoftMuted ? "force_mute" : "mute");
    sendVoiceToOverlay();
}

function toggleSoftDeafen() {
    isSoftDeafened = !isSoftDeafened;
    if (isSoftDeafened) {
        isSoftMuted = true;
    }
    applySoftAudioState();
    addVoiceLog(isSoftDeafened ? "🎧 Soft Deafened (Local)" : "🎧 Soft Undeafened (Local)", isSoftDeafened ? "force_deafen" : "deafen");
    sendVoiceToOverlay();
}

function addVoiceLog(text: string, type: string) {
    const logItem = {
        id: Math.random().toString(36).substring(2, 9),
        text,
        type,
        timestamp: Date.now()
    };
    eventLogList.unshift(logItem);
    if (eventLogList.length > 10) {
        eventLogList.pop();
    }
}

function sendVoiceToOverlay() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        ensureWebSocketConnected();
        return;
    }

    try {
        const vStore = VoiceStateStore || findStore("VoiceStateStore");
        const sStore = SelectedChannelStore || findStore("SelectedChannelStore");
        const uStore = UserStore || findStore("UserStore");
        const cStore = ChannelStore || findStore("ChannelStore");
        const rStore = RelationshipStore || findStore("RelationshipStore");
        const gmStore = GuildMemberStore || findStore("GuildMemberStore");

        const connectedVoiceVcId = getConnectedVoiceChannelId();
        const vcId = stoppedVoiceChannelId 
            ? null 
            : (activeVoiceChannelId || (autoMonitorVoiceSetting ? connectedVoiceVcId : null));
        if (!vcId || !vStore) {
            ws.send(JSON.stringify({
                type: "VOICE_UPDATE",
                voiceChannelName: null,
                users: [],
                eventLogs: eventLogList
            }));
            previousVoiceStatesMap = {};
            return;
        }

        ws.send(JSON.stringify({ type: "ENABLE_SECTION", section: "voice" }));

        const channel = cStore ? cStore.getChannel(vcId) : null;
        const guildId = channel ? channel.guild_id : null;
        const channelName = channel ? channel.name : "Voice Channel";

        const rawVoiceStates = vStore.getVoiceStatesForChannel(vcId) || {};
        const currentStatesMap: Record<string, any> = {};

        const currentUids = Object.keys(rawVoiceStates);
        const prevUids = Object.keys(previousVoiceStatesMap);

        currentUids.forEach(uid => {
            const curState = rawVoiceStates[uid];
            currentStatesMap[uid] = curState;

            const userObj = uStore ? uStore.getUser(uid) : null;
            const uname = userObj ? (userObj.globalName || userObj.username) : "Someone";

            if (!previousVoiceStatesMap[uid]) {
                addVoiceLog(`${uname} joined voice`, "join");
            } else {
                const prevState = previousVoiceStatesMap[uid];
                if (!prevState.mute && curState.mute) {
                    addVoiceLog(`${uname} force muted`, "force_mute");
                } else if (prevState.mute && !curState.mute) {
                    addVoiceLog(`${uname} un-force muted`, "mute");
                } else if (!prevState.selfMute && curState.selfMute) {
                    addVoiceLog(`${uname} muted`, "mute");
                } else if (prevState.selfMute && !curState.selfMute) {
                    addVoiceLog(`${uname} unmuted`, "mute");
                }

                if (!prevState.deaf && curState.deaf) {
                    addVoiceLog(`${uname} force deafened`, "force_deafen");
                } else if (prevState.deaf && !curState.deaf) {
                    addVoiceLog(`${uname} un-force deafened`, "deafen");
                } else if (!prevState.selfDeaf && curState.selfDeaf) {
                    addVoiceLog(`${uname} deafened`, "deafen");
                } else if (prevState.selfDeaf && !curState.selfDeaf) {
                    addVoiceLog(`${uname} undeafened`, "deafen");
                }
            }
        });

        prevUids.forEach(uid => {
            if (!rawVoiceStates[uid]) {
                const userObj = uStore ? uStore.getUser(uid) : null;
                const uname = userObj ? (userObj.globalName || userObj.username) : "Someone";
                addVoiceLog(`${uname} left voice`, "leave");
            }
        });

        previousVoiceStatesMap = currentStatesMap;

        const userList = currentUids.map(uid => {
            const vs = rawVoiceStates[uid];
            const uObj = uStore ? uStore.getUser(uid) : null;
            const uname = uObj ? (uObj.globalName || uObj.username) : "User";
            const avatar = uObj?.avatar 
                ? `https://cdn.discordapp.com/avatars/${uid}/${uObj.avatar}.png?size=64`
                : `https://cdn.discordapp.com/embed/avatars/${(uObj?.discriminator || 0) % 5}.png`;

            let isFriend = false;
            try {
                const rStore = RelationshipStore || findStore("RelationshipStore");
                if (rStore) {
                    if (typeof rStore.isFriend === "function") {
                        isFriend = Boolean(rStore.isFriend(uid));
                    } else if (typeof rStore.getRelationshipType === "function") {
                        isFriend = rStore.getRelationshipType(uid) === 1;
                    }
                }
            } catch (e) {}

            let isStaff = false;
            try {
                const gmStore = GuildMemberStore || findStore("GuildMemberStore");
                if (guildId && gmStore && typeof gmStore.getMember === "function") {
                    const member = gmStore.getMember(guildId, uid);
                    if (member) {
                        isStaff = Boolean(member.highestRoleId || (member.roles && member.roles.length > 1));
                    }
                }
            } catch (e) {}

            const appStreamStore = ApplicationStreamingStore || findStore("ApplicationStreamingStore");
            const rtcStore = ChannelRTCStore || findStore("ChannelRTCStore");

            let isLive = Boolean(vs.selfStream || vs.selfVideo || vs.stream);
            try {
                if (!isLive && appStreamStore) {
                    const anyStream = appStreamStore.getAnyStreamForUser?.(uid) || appStreamStore.getActiveStreamForUser?.(uid);
                    if (anyStream) {
                        isLive = true;
                    } else if (vcId && typeof appStreamStore.getAllActiveStreamsForChannel === "function") {
                        const channelStreams = appStreamStore.getAllActiveStreamsForChannel(vcId) || [];
                        if (channelStreams.some((s: any) => s && (s.ownerId === uid || s.userId === uid))) {
                            isLive = true;
                        }
                    }
                }
                if (!isLive && vcId && rtcStore && typeof rtcStore.getStreamParticipants === "function") {
                    const streamParts = rtcStore.getStreamParticipants(vcId) || [];
                    if (streamParts.some((p: any) => p && (p.id === uid || (p.user && p.user.id === uid)))) {
                        isLive = true;
                    }
                }
            } catch (e) {}

            let isWatchingYou = false;
            try {
                const myId = uStore ? uStore.getCurrentUser?.()?.id : null;
                if (myId && uid !== myId && appStreamStore) {
                    let myStream = appStreamStore.getCurrentUserActiveStream?.() || 
                                   appStreamStore.getAnyStreamForUser?.(myId) || 
                                   appStreamStore.getActiveStreamForUser?.(myId);
                    
                    if (!myStream) {
                        const allAppStreams = appStreamStore.getAllApplicationStreams?.() || appStreamStore.getAllActiveStreams?.() || [];
                        myStream = allAppStreams.find((s: any) => s && (s.ownerId === myId || s.userId === myId));
                    }

                    let viewers: any[] = [];

                    if (myStream && typeof appStreamStore.getViewerIds === "function") {
                        const vRes = appStreamStore.getViewerIds(myStream);
                        if (Array.isArray(vRes)) viewers = vRes;
                    }

                    const state = typeof appStreamStore.getState === "function" ? appStreamStore.getState() : appStreamStore;
                    const rtcStreams = state?.rtcStreams || appStreamStore?.rtcStreams || {};
                    Object.keys(rtcStreams).forEach(key => {
                        if (key.includes(String(myId))) {
                            const rStream = rtcStreams[key];
                            if (rStream && Array.isArray(rStream.viewerIds)) {
                                viewers.push(...rStream.viewerIds);
                            }
                        }
                    });

                    if (viewers.some(v => String(v) === String(uid))) {
                        isWatchingYou = true;
                    }
                }
            } catch (e) {}

            const myId = uStore ? uStore.getCurrentUser?.()?.id : null;
            const isMe = String(uid) === String(myId);

            return {
                userId: uid,
                username: uname,
                avatarUrl: avatar,
                isSpeaking: speakingUsersSet.has(uid),
                isMuted: Boolean(vs.mute || vs.selfMute),
                isDeafened: Boolean(vs.deaf || vs.selfDeaf),
                isForceMuted: Boolean(vs.mute),
                isForceDeafened: Boolean(vs.deaf),
                isSoftMuted: isMe ? isSoftMuted : false,
                isSoftDeafened: isMe ? isSoftDeafened : false,
                isFriend: isFriend,
                isStaff: isStaff,
                isLive: isLive,
                isWatchingYou: isWatchingYou
            };
        });

        ws.send(JSON.stringify({
            type: "VOICE_UPDATE",
            voiceChannelName: channelName,
            users: userList,
            eventLogs: eventLogList
        }));

    } catch (e) {
        console.error("Error in sendVoiceToOverlay:", e);
    }
}

function handleMessageEvent() {
    setTimeout(() => {
        sendMessagesToOverlay();
        sendTypingToOverlay();
    }, 200);
}

function sendTypingToOverlay() {
    if (!activeChannelId || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    const typingObj = TypingStore ? TypingStore.getTypingUsers(activeChannelId) : {};
    const typingIds = Object.keys(typingObj || {});
    
    const myId = UserStore?.getCurrentUser?.()?.id;
    
    const typingUsers = [];
    for (const uid of typingIds) {
        if (uid === myId) continue;
        const u = UserStore ? UserStore.getUser(uid) : null;
        if (u) {
            typingUsers.push({ id: uid, username: u.globalName || u.username });
        }
    }
    
    ws.send(JSON.stringify({
        type: "TYPING_UPDATE",
        typingUsers
    }));
}

function handleVoiceEvent(data?: any) {
    if (data && data.type === "VOICE_CHANNEL_SELECT" && data.channelId) {
        if (data.channelId !== stoppedVoiceChannelId) {
            stoppedVoiceChannelId = null;
        }
    }
    ensureWebSocketConnected(() => {
        setTimeout(() => {
            sendVoiceToOverlay();
        }, 100);
    });
}

function handleSpeakingEvent(data: any) {
    if (!data || !data.userId) return;
    if (data.speakingFlags && data.speakingFlags > 0) {
        speakingUsersSet.add(data.userId);
    } else {
        speakingUsersSet.delete(data.userId);
    }
    sendVoiceToOverlay();
}

function startTextBridge(channelId: string) {
    activeChannelId = channelId;
    if (typingInterval) clearInterval(typingInterval);
    typingInterval = setInterval(() => {
        sendTypingToOverlay();
    }, 1000);
    ensureWebSocketConnected(() => {
        sendMessagesToOverlay();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ENABLE_SECTION", section: "text" }));
        }
    });
}

function stopTextBridge() {
    activeChannelId = null;
    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "MESSAGES_UPDATE",
            messages: []
        }));
    }
}

function startVoiceBridge(channelId: string) {
    stoppedVoiceChannelId = null;
    activeVoiceChannelId = channelId;
    ensureWebSocketConnected(() => {
        sendVoiceToOverlay();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ENABLE_SECTION", section: "voice" }));
        }
    });
}

function stopVoiceBridge(channelId?: string) {
    activeVoiceChannelId = null;
    stoppedVoiceChannelId = channelId || getConnectedVoiceChannelId();
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "VOICE_UPDATE",
            voiceChannelName: null,
            users: [],
            eventLogs: eventLogList
        }));
    }
}

function stopOverlayBridge() {
    if (ws) {
        ws.close();
        ws = null;
    }
    activeChannelId = null;
    activeVoiceChannelId = null;
    stoppedVoiceChannelId = null;
    
    if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
    }
    
    if (FluxDispatcher) {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", handleMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", handleMessageEvent);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceEvent);
        FluxDispatcher.unsubscribe("SPEAKING", handleSpeakingEvent);
    }
}

function patchChannelContextMenu(children: any[], props: any) {
    if (!props || !props.channel) return;
    const channel = props.channel;
    
    // Text Chat Monitoring (supported on ALL channels: Server Text, Voice Chat Text, DMs, Group DMs, Threads)
    const isMonitoringText = (activeChannelId === channel.id);
    children.push(
        <Menu.MenuGroup key="gaming-overlay-group-text">
            <Menu.MenuItem 
                id="gaming-overlay-popout-text" 
                label={isMonitoringText ? "Stop Monitoring Chat in Overlay" : "Monitor Chat in Overlay"} 
                action={() => {
                    if (isMonitoringText) {
                        stopTextBridge();
                        try { showToast("Stopped Monitoring Chat", Toasts.Type.SUCCESS); } catch(e) {}
                    } else {
                        startTextBridge(channel.id);
                        try { showToast("Monitoring Chat in Overlay", Toasts.Type.SUCCESS); } catch(e) {}
                    }
                }} 
            />
        </Menu.MenuGroup>
    );

    // Voice Chat Monitoring (supported on Voice channels, Stage channels, Group DM calls)
    if (channel.type === 2 || channel.type === 13 || channel.type === 3) {
        const connectedVoiceVcId = getConnectedVoiceChannelId();
        const currentEffectiveVoiceId = stoppedVoiceChannelId 
            ? null 
            : (activeVoiceChannelId || (autoMonitorVoiceSetting ? connectedVoiceVcId : null));

        const isMonitoringVoice = (currentEffectiveVoiceId === channel.id);

        children.push(
            <Menu.MenuGroup key="gaming-overlay-group-voice">
                <Menu.MenuItem 
                    id="gaming-overlay-popout-voice" 
                    label={isMonitoringVoice ? "Stop Monitoring Voice in Overlay" : "Monitor Voice in Overlay"} 
                    action={() => {
                        if (isMonitoringVoice) {
                            stopVoiceBridge(channel.id);
                            try { showToast("Stopped Monitoring Voice", Toasts.Type.SUCCESS); } catch(e) {}
                        } else {
                            startVoiceBridge(channel.id);
                            try { showToast("Monitoring Voice in Overlay", Toasts.Type.SUCCESS); } catch(e) {}
                        }
                    }} 
                />
            </Menu.MenuGroup>
        );
    }
}

function patchUserContextMenu(children: any[], props: any) {
    if (!props || !props.user) return;
    const cStore = ChannelStore || findStore("ChannelStore");
    const dmChannelId = cStore?.getDMFromUserId?.(props.user.id);
    if (!dmChannelId) return;

    const isMonitoringText = (activeChannelId === dmChannelId);
    children.push(
        <Menu.MenuGroup key="gaming-overlay-group-user-dm">
            <Menu.MenuItem 
                id="gaming-overlay-popout-user-dm" 
                label={isMonitoringText ? "Stop Monitoring DM Chat in Overlay" : "Monitor DM Chat in Overlay"} 
                action={() => {
                    if (isMonitoringText) {
                        stopTextBridge();
                        try { showToast("Stopped Monitoring DM Chat", Toasts.Type.SUCCESS); } catch(e) {}
                    } else {
                        startTextBridge(dmChannelId);
                        try { showToast("Monitoring DM Chat in Overlay", Toasts.Type.SUCCESS); } catch(e) {}
                    }
                }} 
            />
        </Menu.MenuGroup>
    );
}

let currentPinnedMessageId: string | null = null;

function patchMessageContextMenu(children: any[], props: any) {
    if (!props || !props.message) return;
    const msg = props.message;

    const isPinned = (currentPinnedMessageId === msg.id);

    children.push(
        <Menu.MenuGroup key="gaming-overlay-group-message-pin">
            <Menu.MenuItem 
                id="gaming-overlay-pin-message" 
                label={isPinned ? "Unpin Message from Overlay" : "Pin Message to Overlay"} 
                action={() => {
                    ensureWebSocketConnected();
                    if (!ws || ws.readyState !== WebSocket.OPEN) {
                        try { showToast("Overlay app is not running", Toasts.Type.FAILURE); } catch(e) {}
                        return;
                    }

                    if (isPinned) {
                        currentPinnedMessageId = null;
                        ws.send(JSON.stringify({ type: "PIN_MESSAGE", pinnedMessage: null }));
                        try { showToast("Message Unpinned from Overlay", Toasts.Type.SUCCESS); } catch(e) {}
                    } else {
                        currentPinnedMessageId = msg.id;

                        const author = msg.author || {};
                        let imgUrl = null;
                        if (msg.attachments && msg.attachments.length > 0) {
                            imgUrl = msg.attachments[0].proxy_url || msg.attachments[0].url;
                        } else if (msg.embeds && msg.embeds.length > 0) {
                            const e = msg.embeds[0];
                            if (e.image) imgUrl = e.image.proxyURL || e.image.url;
                            else if (e.thumbnail) imgUrl = e.thumbnail.proxyURL || e.thumbnail.url;
                        }

                        let embedDesc = null;
                        if (msg.embeds && msg.embeds.length > 0) {
                            const e0 = msg.embeds[0];
                            embedDesc = e0.description || e0.title || null;
                        }

                        const pinnedPayload = {
                            id: msg.id,
                            content: msg.content || "",
                            embedDescription: embedDesc,
                            authorName: author.globalName || author.username || "User",
                            authorColor: msg.colorString || "#5865F2",
                            imageUrl: imgUrl,
                            timestamp: Date.now()
                        };

                        ws.send(JSON.stringify({ type: "PIN_MESSAGE", pinnedMessage: pinnedPayload }));
                        try { showToast("Message Pinned to Overlay", Toasts.Type.SUCCESS); } catch(e) {}
                    }
                }} 
            />
        </Menu.MenuGroup>
    );
}

export default definePlugin({
    name: "GamingOverlay",
    description: "Acts as a data bridge to the standalone Gaming Overlay external app.",
    authors: [{ name: "Principal Software Engineer", id: 1n }],
    start() {
        ensureWebSocketConnected();
        addContextMenuPatch("channel-context", patchChannelContextMenu);
        addContextMenuPatch("gdm-context", patchChannelContextMenu);
        addContextMenuPatch("user-context", patchUserContextMenu);
        addContextMenuPatch("message", patchMessageContextMenu);
    },
    stop() {
        removeContextMenuPatch("channel-context");
        removeContextMenuPatch("gdm-context");
        removeContextMenuPatch("user-context");
        removeContextMenuPatch("message");
        stopOverlayBridge();
    }
});
