@echo off
rem 크레페 미니미 마스코트 프로토타입 실행 (VS Code 터미널에서는 ELECTRON_RUN_AS_NODE가 켜져 있을 수 있어 해제)
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
node_modules\electron\dist\electron.exe . %*
