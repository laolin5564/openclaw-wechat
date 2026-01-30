@echo off
chcp 65001 > nul

REM OpenClaw 微信桥接器停止脚本 (Windows)

echo 🦞 停止 OpenClaw 微信桥接器
echo ==========================

REM 查找并停止桥接器进程
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo list ^| findstr /i "bridge.mjs"') do (
    set "PID=%%i"
)

if not defined PID (
    echo 未找到运行中的桥接器进程
    pause
    exit /b 0
)

echo 正在停止进程: %PID%
taskkill /pid %PID% /f > nul 2>&1

timeout /t 2 /nobreak > nul

echo 桥接器已停止
pause
