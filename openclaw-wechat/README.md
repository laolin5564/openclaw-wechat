# openclaw-wechat

> OpenClaw AI 助手的微信渠道桥接器

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)](https://github.com/openclaw/openclaw-wechat)

---

## 简介

**openclaw-wechat** 是 OpenClaw 的微信渠道桥接器，让你通过微信私聊与 OpenClaw AI 助手对话。

无需翻墙，无需安装额外应用，打开微信就能使用 AI 的所有功能。

### 核心特性

- ✅ **微信私聊对话** - 一对一私聊，天然安全
- ✅ **执行 AI 技能** - 调用 OpenClaw 所有技能
- ✅ **文件收发** - 支持收发文件、图片、视频、语音
- ✅ **配对码认证** - 新用户发送配对码即可授权
- ✅ **扫码登录** - 微信扫码即可登录，支持免扫码唤醒
- ✅ **自动重连** - 断线自动重连（指数退避），无需手动干预
- ✅ **进程保活** - 支持系统服务，崩溃自动重启
- ✅ **跨平台** - 支持 macOS、Linux、Windows

---

## 快速开始

### 前置条件

1. [已安装 OpenClaw Gateway](https://github.com/openclaw/openclaw) 并运行在 `ws://127.0.0.1:18789`
2. [Node.js](https://nodejs.org) >= 18.0.0
3. [微信 iPad 协议服务](https://github.com/your-repo/wechat-service) 运行在端口 8099

### 安装

```bash
# 克隆仓库
git clone https://github.com/openclaw/openclaw-wechat.git
cd openclaw-wechat

# 安装依赖
cd bridge
npm install
```

### 初始化

```bash
npm run setup
```

按提示完成：
1. 确认 OpenClaw Gateway 地址
2. 确认微信服务地址
3. 微信扫码登录

### 启动

```bash
# macOS / Linux
./scripts/start.sh

# Windows
scripts\start.bat
```

启动成功后，发送微信消息即可与 AI 对话。

---

## 目录结构

```
openclaw-wechat/
├── bin/              # 微信服务可执行文件
│   ├── windows/      # Windows 可执行文件
│   ├── darwin/       # macOS 可执行文件
│   └── linux/        # Linux 可执行文件
├── bridge/                  # Node.js 桥接器
│   ├── bridge.mjs           # 核心桥接逻辑（消息转发、文件/图片收发）
│   ├── gateway.mjs          # OpenClaw Gateway WebSocket 通信模块
│   ├── wechat.mjs           # 微信 iPad 协议服务通信模块（HTTP + WebSocket）
│   ├── config.mjs           # 配置管理（配置文件、授权码、用户白名单、配对码）
│   ├── logger.mjs           # 分级日志模块（控制台 + 文件）
│   ├── utils.mjs            # 工具函数（消息解析、格式化、平台检测）
│   ├── init.mjs             # 交互式初始化向导
│   ├── setup.mjs            # 快速非交互式初始化
│   ├── setup-service.mjs    # 系统服务配置（launchd / systemd）
│   ├── test-file-feature.mjs # 文件发送功能单元测试
│   └── package.json
├── scripts/          # 启动/停止脚本
│   ├── start.sh      # macOS/Linux 启动
│   ├── start.bat     # Windows 启动
│   ├── stop.sh       # macOS/Linux 停止
│   └── stop.bat      # Windows 停止
├── docs/             # 文档
│   ├── README.md     # 用户文档
│   ├── API.md        # API 文档
│   └── ARCHITECTURE.md  # 架构文档
└── README.md         # 本文件
```

---

## 系统服务

配置为系统服务后，桥接器会在系统启动时自动运行，崩溃后自动重启。

### macOS (launchd)

```bash
cd bridge
npm run setup-service
```

### Linux (systemd)

```bash
cd bridge
npm run setup-service
systemctl --user start com.openclaw.wechat
```

---

## 配置

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

---

## 使用示例

### 与 AI 对话

```
用户: 你好
AI: 你好！我是 OpenClaw AI 助手，有什么可以帮你的吗？

用户: 帮我搜索今天的天气
AI: [正在执行搜索天气技能...]

用户: 帮我翻译这段话
AI: [正在执行翻译技能...]
```

### 执行技能

任何 Moltbot 技能都可以通过微信调用：

- 搜索信息
- 翻译文本
- 执行命令
- 生成图片
- 分析代码

---

## 文档

- [用户文档](docs/README.md) - 详细使用说明
- [API 文档](docs/API.md) - API 协议参考
- [架构文档](docs/ARCHITECTURE.md) - 系统架构设计

---

## 常见问题

### Q: 微信登录失败？

A: 检查微信服务是否运行，端口是否正确，网络是否正常。

### Q: 无法连接 OpenClaw Gateway？

A: 确认 Gateway 正在运行 (`ws://127.0.0.1:18789`)，检查配置文件中的地址。

### Q: 支持群聊吗？

A: 第一版仅支持私聊，群聊支持计划在后续版本中添加。

### Q: 支持多账号吗？

A: 当前版本仅支持单账号，多账号支持计划在后续版本中添加。

---

## 开发

### 运行开发版本

```bash
cd bridge
node bridge.mjs
```

### 运行测试

```bash
npm test
```

### 代码格式

使用 ES Module (`.mjs`) 和 ES2022+ 语法。

---

## 安全

- 所有数据存储在本地，不经过第三方服务器
- 微信通信使用 MMTLS 加密
- 配置文件和授权码存储在用户目录

---

## 许可证

[MIT License](https://opensource.org/licenses/MIT)

---

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
- [feishu-openclaw](https://github.com/AlexAnys/feishu-openclaw) - 飞书桥接器参考

---

## 支持

- [GitHub Issues](https://github.com/openclaw/openclaw-wechat/issues)
- [OpenClaw 文档](https://docs.openclaw.ai)

---

<div align="center">

**🦞 OpenClaw 微信桥接器**

Made with ❤️ by the OpenClaw community

</div>
