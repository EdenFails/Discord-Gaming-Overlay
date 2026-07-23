#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
    echo "First time setup: Installing dependencies..."
    npm install
fi

# Fix executable permissions stripped by zip extraction on Linux
chmod -R +x node_modules/.bin/ 2>/dev/null
if [ -d "node_modules/electron/dist" ]; then
    chmod +x node_modules/electron/dist/electron 2>/dev/null
fi

echo "Starting Gaming Overlay..."
npm start
