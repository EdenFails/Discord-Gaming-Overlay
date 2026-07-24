import definePlugin from "@utils/types";
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
    ChannelRTCStore
} from "@webpack/common";
import { findByProps, findStore } from "@webpack";
import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu";

let activeChannelId: string | null = null;
let activeVoiceChannelId: string | null = null;
let autoMonitorVoiceSetting = true;
let ws: WebSocket | null = null;

let previousVoiceStatesMap: Record<string, any> = {};
let speakingUsersSet = new Set<string>();
let eventLogList: Array<{ id: string; text: string; type: string; timestamp: number }> = [];

function ensureWebSocketConnected(onOpenCallback?: () => void) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (onOpenCallback) onOpenCallback();
        return;
    }

    if (ws) {
        ws.close();
    }

    try {
        ws = new WebSocket("ws://127.0.0.1:6969");
        
        ws.onopen = () => {
            showToast("Connected to Gaming Overlay App!", Toasts.Type.SUCCESS);
            if (onOpenCallback) onOpenCallback();
            sendMessagesToOverlay();
            sendVoiceToOverlay();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const MessageActions = findByProps("sendMessage");
                if (data.type === "SEND_MESSAGE" && data.content && activeChannelId && MessageActions) {
                    MessageActions.sendMessage(activeChannelId, { content: data.content });
                } else if (data.type === "CONFIG_UPDATE") {
                    if (typeof data.autoMonitorVoice === "boolean") {
                        autoMonitorVoiceSetting = data.autoMonitorVoice;
                        sendVoiceToOverlay();
                    }
                }
            } catch (e) {
                console.error("Overlay Bridge WS Error:", e);
            }
        };

        ws.onclose = () => {
            showToast("Disconnected from Gaming Overlay App", Toasts.Type.FAILURE);
            ws = null;
        };

        ws.onerror = () => {
            showToast("Failed to connect to Gaming Overlay App. Is it running?", Toasts.Type.FAILURE);
            ws = null;
        };

        if (FluxDispatcher) {
            FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageEvent);
            FluxDispatcher.subscribe("MESSAGE_UPDATE", handleMessageEvent);
            FluxDispatcher.subscribe("MESSAGE_DELETE", handleMessageEvent);
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
        showToast("Error connecting to Overlay App", Toasts.Type.FAILURE);
    }
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

                    return {
                        id: m.id,
                        content: m.content || "",
                        state: m.state,
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
                            username: author.globalName || author.username || "System",
                            color: memberColor || '#ffffff'
                        }
                    };
                });

            ws.send(JSON.stringify({
                type: "MESSAGES_UPDATE",
                messages: lastMsgs
            }));
        }
    } catch (e: any) {
        console.error("Error parsing messages:", e);
    }
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
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
        const vStore = VoiceStateStore || findStore("VoiceStateStore");
        const sStore = SelectedChannelStore || findStore("SelectedChannelStore");
        const uStore = UserStore || findStore("UserStore");
        const cStore = ChannelStore || findStore("ChannelStore");
        const rStore = RelationshipStore || findStore("RelationshipStore");
        const gmStore = GuildMemberStore || findStore("GuildMemberStore");

        const connectedVoiceVcId = sStore ? sStore.getVoiceChannelId() : null;
        const vcId = (autoMonitorVoiceSetting && connectedVoiceVcId) ? connectedVoiceVcId : (activeVoiceChannelId || connectedVoiceVcId);
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

            return {
                userId: uid,
                username: uname,
                avatarUrl: avatar,
                isSpeaking: speakingUsersSet.has(uid),
                isMuted: Boolean(vs.mute || vs.selfMute),
                isDeafened: Boolean(vs.deaf || vs.selfDeaf),
                isForceMuted: Boolean(vs.mute),
                isForceDeafened: Boolean(vs.deaf),
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
    }, 200);
}

function handleVoiceEvent() {
    setTimeout(() => {
        sendVoiceToOverlay();
    }, 100);
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
    ensureWebSocketConnected(() => {
        sendMessagesToOverlay();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ENABLE_SECTION", section: "text" }));
        }
    });
}

function startVoiceBridge(channelId: string) {
    activeVoiceChannelId = channelId;
    ensureWebSocketConnected(() => {
        sendVoiceToOverlay();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ENABLE_SECTION", section: "voice" }));
        }
    });
}

function stopOverlayBridge() {
    if (ws) {
        ws.close();
        ws = null;
    }
    activeChannelId = null;
    activeVoiceChannelId = null;
    
    if (FluxDispatcher) {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", handleMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", handleMessageEvent);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceEvent);
        FluxDispatcher.unsubscribe("SPEAKING", handleSpeakingEvent);
    }
}

export default definePlugin({
    name: "GamingOverlay",
    description: "Acts as a data bridge to the standalone Gaming Overlay external app.",
    authors: [{ name: "Principal Software Engineer", id: 1n }],
    start() {
        addContextMenuPatch("channel-context", (children, props) => {
            if (!props || !props.channel) return;
            
            if (props.channel.type === 0 || props.channel.type === 5) {
                children.push(
                    <Menu.MenuGroup key="gaming-overlay-group-text">
                        <Menu.MenuItem 
                            id="gaming-overlay-popout-text" 
                            label="Monitor Chat in Overlay" 
                            action={() => startTextBridge(props.channel.id)} 
                        />
                    </Menu.MenuGroup>
                );
            }
            
            if (props.channel.type === 2 || props.channel.type === 13) {
                children.push(
                    <Menu.MenuGroup key="gaming-overlay-group-voice">
                        <Menu.MenuItem 
                            id="gaming-overlay-popout-voice" 
                            label="Monitor Voice in Overlay" 
                            action={() => startVoiceBridge(props.channel.id)} 
                        />
                    </Menu.MenuGroup>
                );
            }
        });
    },
    stop() {
        removeContextMenuPatch("channel-context");
        stopOverlayBridge();
    }
});
