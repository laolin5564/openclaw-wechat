# OpenClaw 微信桥接器

> 让你通过微信与 OpenClaw AI 助手对话

## 简介

**openclaw-wechat** 是 OpenClaw 的微信渠道桥接器。无需翻墙，打开微信就能使用 AI 的所有功能。

### 特性

- ✅ 微信私聊对话
- ✅ 调用 OpenClaw 所有技能
- ✅ 扫码登录
- ✅ 自动重连
- ✅ 用户配对授权（防止陌生人使用）

---

## 系统要求

- **macOS** (Apple Silicon / Intel) 或 **Linux**
- **Docker Desktop** >= 4.0
- **Node.js** >= 18.0
- **OpenClaw Gateway** 运行中

---

## 目录结构

```
openclaw-wechat-v1.0.0/
├── wechat-service/          # 微信 iPad 协议服务
│   ├── docker-compose.yaml  # Docker 编排文件
│   ├── Dockerfile           # 应用镜像
│   ├── start.sh             # 启动脚本
│   ├── stop.sh              # 停止脚本
│   └── wechat-service-*     # 可执行文件
│
├── openclaw-wechat/         # 桥接器
│   ├── bridge/              # Node.js 桥接程序
│   ├── scripts/             # 启动/停止脚本
│   └── docs/                # 文档
│
└── README.md                # 本文件
```

---

## 快速开始

### 第一步：启动微信协议服务

```bash
cd wechat-service

# 首次运行，构建并启动 Docker 容器
./start.sh
```

启动后会创建三个 Docker 容器：
- `my-mysql` - MySQL 数据库
- `my-redis` - Redis 缓存
- `my-go-app` - 微信协议服务

服务地址：`http://localhost:8099`

### 第二步：安装桥接器依赖

```bash
cd openclaw-wechat/bridge
npm install
```

### 第三步：初始化桥接器

```bash
npm run setup
```

按提示操作：
1. 确认 OpenClaw Gateway 地址（默认 `ws://127.0.0.1:18789`）
2. 输入 Gateway Token（在 `~/.openclaw/openclaw.json` 中查看）
3. 确认微信服务地址（默认 `http://127.0.0.1:8099`）
4. **微信扫码登录**

### 第四步：启动桥接器

```bash
# macOS / Linux
./scripts/start.sh

# 或直接运行
cd bridge && node bridge.mjs
```

---

## 用户授权

首次使用时，陌生微信用户需要发送**配对码**才能与 AI 对话。

### 获取配对码

配对码存储在 `~/.openclaw/secrets/wechat_pairing_code`

```bash
cat ~/.openclaw/secrets/wechat_pairing_code
```

### 授权流程

1. 用户给微信机器人发送配对码（如 `ABC123`）
2. 系统自动将该用户添加到授权列表
3. 之后该用户可以直接对话

### 已授权用户列表

```bash
cat ~/.openclaw/secrets/wechat_allowed_users.json
```

---

## 配置文件

配置文件位于 `~/.openclaw/openclaw-wechat.json`：

```json
{
  "wechatService": {
    "host": "127.0.0.1",
    "port": 8099
  },
  "gateway": {
    "url": "ws://127.0.0.1:18789",
    "token": "your-gateway-token"
  },
  "behavior": {
    "thinkingDelay": 2500,
    "thinkingMessage": "⏳ AI 正在处理…"
  }
}
```

---

## 常用命令

### 启动服务

```bash
# 启动微信协议服务
cd wechat-service && ./start.sh

# 启动桥接器
cd openclaw-wechat/scripts && ./start.sh
```

### 停止服务

```bash
# 停止桥接器
cd openclaw-wechat/scripts && ./stop.sh

# 停止微信协议服务
cd wechat-service && ./stop.sh
```

### 查看日志

```bash
# 桥接器日志
tail -f ~/.openclaw/logs/wechat-bridge.out.log

# 微信服务日志
docker logs -f my-go-app
```

### 重新登录微信

```bash
cd openclaw-wechat/bridge
npm run setup
```

---

## 故障排除

### Q: 微信扫码后显示登录失败？

A: 
1. 确认微信协议服务正在运行：`docker ps | grep my-go-app`
2. 检查端口是否被占用：`lsof -i :8099`
3. 查看服务日志：`docker logs my-go-app`

### Q: 无法连接 OpenClaw Gateway？

A: 
1. 确认 Gateway 正在运行：`curl http://127.0.0.1:18789/health`
2. 检查配置文件中的 token 是否正确
3. 确认 Gateway 端口未被防火墙阻挡

### Q: 消息发送失败？

A:
1. 检查微信是否在线：访问 `http://localhost:8099/docs`
2. 查看桥接器日志：`tail -f ~/.openclaw/logs/wechat-bridge.out.log`

### Q: Docker 容器启动失败？

A:
1. 确保 Docker Desktop 正在运行
2. 检查端口冲突：3306 (MySQL), 6379 (Redis), 8099 (API)
3. 删除旧容器重试：`docker rm -f my-mysql my-redis my-go-app`

---

## 数据存储

| 路径 | 说明 |
|------|------|
| `~/.openclaw/openclaw-wechat.json` | 配置文件 |
| `~/.openclaw/secrets/wechat_auth_key` | 微信授权码 |
| `~/.openclaw/secrets/wechat_allowed_users.json` | 已授权用户 |
| `~/.openclaw/secrets/wechat_pairing_code` | 配对码 |
| `~/.openclaw/logs/` | 桥接器日志 |

---

## 安全说明

- 所有数据存储在本地，不经过第三方服务器
- 微信通信使用 MMTLS 加密
- 建议定期更换配对码
- 不要将 token 和密钥提交到公开仓库

---

## 支持的平台

| 平台 | 状态 |
|------|------|
| macOS (Apple Silicon) | ✅ 支持 |
| macOS (Intel) | ⚠️ 需要编译 |
| Linux (x64) | ⚠️ 需要编译 |
| Windows | ⚠️ 需要编译 |

其他平台需要自行编译 `wechat-service`。

---

## 许可证

MIT License

---

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) - AI 助手框架
