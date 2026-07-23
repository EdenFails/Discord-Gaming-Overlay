# Discord Gaming Overlay

A lightweight, customizable in-game overlay for Discord text chat and voice channels. Supports Windows, Linux, and macOS.

## AI Attribution and Disclaimer

99% of this codebase, architecture, Vencord bridge, and feature implementation was generated through Gemini AI by Google DeepMind.

## Overview

Discord Gaming Overlay is a standalone Electron desktop application that connects to a custom Vencord plugin via local WebSocket. It displays a borderless, click-through overlay on top of borderless-fullscreen games so you can monitor text chat messages and voice channel participants without alt-tabbing.

## Key Features

- Text Chat Overlay: Displays live messages, custom emojis, fake nitro emojis, and image attachments.
- Voice Chat Overlay: Shows active voice members, avatar icons, glowing green speaking rings, live streams, and spectators watching your stream.
- Friends First Sorting: Prioritizes your Discord friends at the top of the voice list in large calls so they are never cut off.
- Modular Panels: Toggle text chat or voice chat on or off independently.
- Mouse Passthrough and Custom Hotkeys: Click straight through the overlay into your games without losing focus.
- Cross Platform: Runs on Windows, Linux, and macOS.

## Quick Start Guide

### 1. Install the Vencord Plugin
1. Copy the vencord-plugin/GamingOverlay folder into your custom Vencord src/userplugins directory.
2. Run pnpm build in your Vencord terminal and restart Discord.

### 2. Launch the Overlay App
- Windows: Double click start.bat
- Linux: Double click start.sh

## Updating
Whenever new updates are pushed to GitHub, run:

git pull

And copy vencord-plugin/GamingOverlay into your Vencord src/userplugins directory if the plugin changed, re-run pnpm build, and relaunch start.bat or start.sh.
