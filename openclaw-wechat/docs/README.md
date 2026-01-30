# OpenClaw 微信桥接器

让用户通过微信私聊与 OpenClaw AI 助手对话。

## 目录

- [快速开始](#快速开始)
- [安装](#安装)
- [配置](#配置)
- [使用](#使用)
- [常见问题](#常见问题)

---

## 快速开始

### 前置条件

1. **已安装并运行 OpenClaw Gateway** (`ws://127.0.0.1:18789`)
2. **Node.js >= 18.0.0**
3. **微信 iPad 协议服务正在运行** (端口 8099)

### 一键启动

#### macOS / Linux

```bash
cd openclaw-wechat
./scripts/start.sh
```

#### Windows

```bash
cd openclaw-wechat
scripts\start.bat
```

### 首次运行

首次运行时会自动进入初始化向导：

1. 配置 OpenClaw Gateway 地址
2. 配置微信服务地址
3. 生成微信授权码
4. 扫码登录微信

---

## 安装

### 下载

从 [GitHub Releases](https://github.com/openclaw/openclaw-wechat/releases) 下载最新版本。

### 目录结构

```
openclaw-wechat/
├── bin/              # 微信服务可执行文件
├── bridge/           # Node.js 桥接器
├── scripts/          # 启动/停止脚本
└── docs/             # 文档
```

### 依赖安装

```bash
cd bridge
npm install
```

---

## 配置

### 配置文件

配置文件位于 `~/.openclaw/openclaw-wechat.json`：

```json
{
  "wechatService": {
    "host": "127.0.0.1",
    "port": 8099,
    "autoStart": true
  },
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": ""
  },
  "behavior": {
    "thinkingDelay": 2500,
    "thinkingMessage": "⏳ AI 正在处理…",
    "autoReconnect": true
  },
  "logging": {
    "level": "info"
  }
}
```

### 重新配置

```bash
cd bridge
npm run setup
```

---

## 使用

### 启动服务

```bash
./scripts/start.sh      # macOS/Linux
scripts\start.bat       # Windows
```

### 停止服务

```bash
./scripts/stop.sh       # macOS/Linux
scripts\stop.bat        # Windows
```

### 配置系统服务

#### macOS (launchd)

```bash
cd bridge
npm run setup-service
```

#### Linux (systemd)

```bash
cd bridge
npm run setup-service
systemctl --user start com.openclaw.wechat
```

### 与 AI 对话

1. 确保服务正在运行
2. 打开微信，找到自己（文件传输助手或任意私聊）
3. 发送消息，AI 会自动回复

### 执行技能

发送特定格式的消息可以调用 Moltbot 技能：

```
帮我搜索今天的天气
帮我翻译这段文字
帮我执行某个命令
```

---

## 常见问题

### 微信登录失败

1. 确认微信服务正在运行 (`http://127.0.0.1:8099`)
2. 检查授权码是否有效
3. 重新扫码登录

### 无法连接 OpenClaw Gateway

1. 确认 Gateway 正在运行 (`ws://127.0.0.1:18789`)
2. 检查配置文件中的地址是否正确
3. 查看 Gateway 日志

### 消息发送失败

1. 检查网络连接
2. 确认微信登录状态
3. 查看日志文件 `~/.openclaw/logs/wechat-bridge.out.log`

### 服务自动重启

桥接器内置了自动重连机制：
- OpenClaw Gateway 断开：自动重连
- 微信服务断开：自动重连
- 微信登录失效：提示重新扫码

---

## 日志

日志文件位于 `~/.openclaw/logs/`：

- `wechat-bridge.out.log` - 桥接器日志
- `wechat-bridge.err.log` - 错误日志
- `wechat-service.log` - 微信服务日志

查看实时日志：

```bash
tail -f ~/.openclaw/logs/wechat-bridge.out.log
```

---

## 数据目录

所有数据存储在 `~/.openclaw/`：

```
~/.openclaw/
├── openclaw-wechat.json    # 配置文件
├── secrets/
│   └── wechat_auth_key     # 微信授权码
├── data/
│   └── wechat.db           # 微信数据
└── logs/                   # 日志文件
```

---

## 卸载

### 停止服务

```bash
./scripts/stop.sh
```

### 卸载系统服务

```bash
# macOS
launchctl unload ~/Library/LaunchAgents/com.openclaw.wechat.plist

# Linux
systemctl --user disable com.openclaw.wechat
systemctl --user stop com.openclaw.wechat
```

### 删除数据

```bash
rm -rf ~/.openclaw
```

---

## 支持

- GitHub Issues: [https://github.com/openclaw/openclaw-wechat/issues](https://github.com/openclaw/openclaw-wechat/issues)
- OpenClaw 文档: [https://docs.openclaw.ai](https://docs.openclaw.ai)

---

**许可证**: MIT
**版本**: 1.0.0
