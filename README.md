# Discord Gaming Overlay

A lightweight, customizable in-game overlay for Discord text chat and voice channels. Supports Windows fully. Linux and macOS are supported, but we are unable to confirm full functionality of all features.

## AI Attribution and Disclaimer

99% of this codebase, architecture, Vencord bridge, and feature implementation was generated through Gemini AI by Google DeepMind.

## Overview

Discord Gaming Overlay is a standalone Electron desktop application that connects to a custom Vencord plugin via local WebSocket. It displays a borderless, click-through overlay on top of borderless-fullscreen games so you can monitor text chat messages and voice channel participants without alt-tabbing.

## Key Features

- **Auto-Monitor Voice Channels (Default ON)**: Automatically tracks and displays voice call members as soon as you join any voice channel in Discord.
- **Text Chat Overlay**: Displays live messages, custom emojis, fake nitro emojis, image attachments, and looping GIF/MP4 previews while hiding cluttered raw URLs.
- **Voice Chat Overlay**: Shows active voice members, avatar icons, glowing green speaking rings, live streams (`LIVE` badge), and spectators watching your stream (`👁` eye icon).
- **Auto-Expand Voice Section**: Automatically resizes the voice overlay frame to fit all connected call members down to the bottom of your screen without cutoffs.
- **Custom Height Controls**: Manually set pixel max heights for text chat and voice chat sections in Settings.
- **Friends First Sorting**: Prioritizes your Discord friends at the top of the voice list in large calls so they are never cut off.
- **Modular Panels**: Toggle text chat or voice chat on or off independently.
- **Mouse Passthrough and Custom Hotkeys**: Click straight through the overlay into your games without losing focus. Hotkeys can be customized in Settings (`Ctrl+Shift+H` for visibility, `Ctrl+Shift+Enter` for interactive typing mode).
- **System Tray Controls**: Click or double-click the purple controller icon in your System Tray to open Settings or exit.
- **Platform Support**: Supports Windows fully. Linux and macOS are supported, but we are unable to confirm full functionality of all features.

## Accessing Settings

To open the Overlay Settings window:
1. Look at your **System Tray** (bottom-right near your clock on Windows, or top/bottom bar on Linux/macOS).
2. Click or double-click the purple **Discord Gaming Overlay** controller icon (`icon.png`).
3. The Settings window will open, allowing you to configure opacity, auto-hide delay, max heights, auto-expansion, hotkeys, and display positions in real time!

---

## Installation Guide

### 1. Setting Up Custom Vencord (Building from Source)

Because the official Vencord installer does not support third-party custom plugins, you need to build Vencord from source once to use custom plugins.

#### Step A: Prerequisites
- Install [Node.js](https://nodejs.org/) (v18 or higher recommended).
- Install pnpm by running `npm install -g pnpm` in your terminal.

#### Step B: Clone Vencord
Open terminal / command prompt and clone the official Vencord repository:
```bash
git clone https://github.com/Vendicated/Vencord.git
cd Vencord
pnpm install
```

#### Step C: Copy the Gaming Overlay Plugin
Copy the `vencord-plugin/GamingOverlay` directory from this repository into Vencord's `src/userplugins/` folder:
```text
Vencord/
 └── src/
      └── userplugins/
           └── GamingOverlay/
                └── index.tsx
```

#### Step D: Build and Inject
Build Vencord and patch your Discord client:
```bash
pnpm build
pnpm inject
```
Follow the terminal prompt to choose your installed Discord version (Discord, Discord PTB, Discord Canary, or Vesktop).

#### Step E: Enable Plugin in Discord
1. Open Discord Settings -> Plugins.
2. Search for `Gaming Overlay`.
3. Toggle it ON.

---

### 2. Launching the Overlay Application

Once Vencord is patched and Discord is running:

- **Windows**: Double-click `start.bat`
- **Linux**: Open terminal and run `./start.sh` (or double-click `start.sh`)

Both `start.bat` and `start.sh` automatically pull the latest changes from GitHub on launch before opening the overlay.

#### Linux Wayland & Hyprland Overlay Rendering Note
If you are running Wayland (Hyprland, KDE Plasma 6, Sway, or CachyOS) and your game is covering the overlay in borderless mode:
- The application uses `tooltip` window type and `pop-up-menu` level priority to float above games.
- **Hyprland users**: Add these lines to your `hyprland.conf`:
  ```ini
  windowrulev2 = pin, title:(Discord Gaming Overlay)
  windowrulev2 = float, title:(Discord Gaming Overlay)
  ```
- **KDE Plasma 6 users**: Create a Window Rule for title `Discord Gaming Overlay` -> Keep above -> Force -> Yes.

---

## Updating

Whenever new updates are pushed:
1. Simply double-click `start.bat` or `start.sh` (auto-pulls latest changes).
2. If the Vencord plugin file (`vencord-plugin/GamingOverlay/index.tsx`) was modified, copy it to your Vencord `src/userplugins/GamingOverlay/index.tsx`, run `pnpm build` in your Vencord directory, and restart Discord.

