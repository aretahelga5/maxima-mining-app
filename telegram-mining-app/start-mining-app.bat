@echo off
title MAXIMA MINING APP Server (MAXIMA - 1000 Levels TON Jetton)
cd /d "%~dp0"
echo ========================================================================
echo   MAXIMA MINING APP (1,000 Levels - Proof of Holding on TON)
echo   Jetton Contract : EQBf0K3oICQZr-UPkiQiP7fMcGXQqq_aQB0jno6mbpssbr45
echo   Opening preview at http://localhost:3000 ...
echo ========================================================================
start "" "http://localhost:3000"
node --watch server.js
pause
