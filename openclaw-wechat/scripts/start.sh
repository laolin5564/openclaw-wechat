#!/bin/bash

# OpenClaw 微信桥接器启动脚本

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BRIDGE_DIR="$PROJECT_DIR/bridge"

echo "🦞 OpenClaw 微信桥接器"
echo "===================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js >= 18.0.0"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "错误: Node.js 版本过低 (当前: $(node -v), 需要: >= 18.0.0)"
    exit 1
fi

# 检查是否首次运行
if [ ! -f "$HOME/.openclaw/openclaw-wechat.json" ]; then
    echo "检测到首次运行，正在运行初始化..."
    cd "$BRIDGE_DIR"
    npm run setup
    echo ""
fi

# 安装依赖
if [ ! -d "$BRIDGE_DIR/node_modules" ]; then
    echo "正在安装依赖..."
    cd "$BRIDGE_DIR"
    npm install
fi

# 启动桥接器
echo "正在启动桥接器..."
cd "$BRIDGE_DIR"
node bridge.mjs
