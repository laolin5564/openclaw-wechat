#!/bin/bash

# OpenClaw 微信桥接器停止脚本

echo "🦞 停止 OpenClaw 微信桥接器"
echo "=========================="

# 查找并停止桥接器进程
PIDS=$(pgrep -f "node.*bridge.mjs" || true)

if [ -z "$PIDS" ]; then
    echo "未找到运行中的桥接器进程"
    exit 0
fi

echo "正在停止进程: $PIDS"
echo "$PIDS" | xargs kill 2>/dev/null || true

# 等待进程结束
for i in {1..10}; do
    sleep 1
    if ! pgrep -f "node.*bridge.mjs" > /dev/null; then
        echo "桥接器已停止"
        exit 0
    fi
done

# 强制结束
echo "强制停止进程..."
echo "$PIDS" | xargs kill -9 2>/dev/null || true
echo "桥接器已停止"
