@echo off
chcp 65001 > nul

REM OpenClaw 微信桥接器启动脚本 (Windows)

setlocal

echo 🦞 OpenClaw 微信桥接器
echo ====================

REM 获取脚本目录
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "BRIDGE_DIR=%PROJECT_DIR%\bridge"

REM 检查 Node.js
where node > nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Node.js，请先安装 Node.js ^>= 18.0.0
    pause
    exit /b 1
)

REM 检查是否首次运行
if not exist "%USERPROFILE%\.openclaw\openclaw-wechat.json" (
    echo 检测到首次运行，正在运行初始化...
    cd /d "%BRIDGE_DIR%"
    call npm run setup
    echo.
)

REM 安装依赖
if not exist "%BRIDGE_DIR%\node_modules" (
    echo 正在安装依赖...
    cd /d "%BRIDGE_DIR%"
    call npm install
)

REM 启动桥接器
echo 正在启动桥接器...
cd /d "%BRIDGE_DIR%"
node bridge.mjs

pause
