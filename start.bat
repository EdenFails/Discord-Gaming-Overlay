@echo off
title Gaming Overlay App
cd /d "%~dp0"

if not exist node_modules (
    echo First time setup: Installing dependencies...
    call npm install
)

echo Starting Gaming Overlay...
call npm start
