# OpenClaw 微信桥接器 API 文档

本文档描述了微信桥接器与 OpenClaw Gateway 之间的通信协议。

---

## 目录

- [Gateway 协议](#gateway-协议)
- [消息格式](#消息格式)
- [WebSocket 事件](#websocket-事件)
- [错误处理](#错误处理)

---

## Gateway 协议

桥接器通过 WebSocket 连接到 OpenClaw Gateway：

```
ws://127.0.0.1:18789
```

### 连接帧

桥接器连接后发送连接帧：

```json
{
  "type": "req",
  "method": "connect",
  "params": {
    "role": "channel",
    "name": "wechat",
    "version": "1.0.0",
    "capabilities": {
      "sendMessage": true,
      "receiveMessage": true
    }
  }
}
```

### 连接响应

```json
{
  "type": "event",
  "event": "connected"
}
```

---

## 消息格式

### 发送消息（用户 → AI）

当用户在微信发送消息时，桥接器向 Gateway 发送：

```json
{
  "type": "req",
  "id": "unique-id",
  "method": "send",
  "params": {
    "channel": "wechat",
    "message": {
      "from": "wxid_xxx",
      "content": "用户的消息内容",
      "type": "text"
    }
  }
}
```

**参数说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| from | string | 微信用户 ID (wxid) |
| content | string | 消息内容 |
| type | string | 消息类型: `text`, `image`, `voice`, `emoji` |

### 响应消息（AI → 用户）

Gateway 返回 AI 响应：

```json
{
  "type": "res",
  "id": "unique-id",
  "ok": true,
  "payload": {
    "message": "AI 的回复内容"
  }
}
```

### 主动推送（Gateway → 桥接器）

Gateway 主动推送消息到用户：

```json
{
  "type": "event",
  "event": "message",
  "payload": {
    "channel": "wechat",
    "from": "wxid_xxx",
    "content": "消息内容"
  }
}
```

---

## WebSocket 事件

### 微信服务事件

桥接器监听微信服务的 WebSocket (`ws://127.0.0.1:8099/ws/GetSyncMsg`)：

#### 消息事件

```json
{
  "type": "AddMsg",
  "data": {
    "MsgId": "消息ID",
    "FromUserName": "wxid_xxx",
    "ToUserName": "wxid_yyy",
    "MsgType": 1,
    "Content": "消息内容",
    "CreateTime": 1234567890
  }
}
```

**MsgType 值**:

| 值 | 类型 |
|----|------|
| 1 | 文本消息 |
| 3 | 图片消息 |
| 34 | 语音消息 |
| 47 | 表情消息 |
| 49 | APP 消息 (链接等) |

#### 登录状态事件

```json
{
  "type": "LoginStatus",
  "loginState": 1,
  "loginErrMsg": "账号在线状态良好！"
}
```

**loginState 值**:

| 值 | 状态 |
|----|------|
| 1 | 在线 |
| 0 | 离线 |

---

## 错误处理

### 错误响应格式

```json
{
  "type": "res",
  "id": "unique-id",
  "ok": false,
  "error": "错误描述"
}
```

### 常见错误

| 错误 | 说明 | 处理 |
|------|------|------|
| `Gateway 未连接` | 无法连接到 OpenClaw Gateway | 检查 Gateway 是否运行 |
| `授权码无效` | 微信授权码过期或无效 | 重新生成授权码 |
| `微信未登录` | 微信登录失效 | 重新扫码登录 |
| `发送消息失败` | 消息发送到微信失败 | 检查网络和登录状态 |

### 重连机制

桥接器内置指数退避重连：

```
重连延迟 = min(2000 * 2^attempt, 30000)
```

- 最大重连次数: 10 次
- 最大重连延迟: 30 秒
- 连接成功后重置计数器

---

## 微信 API 参考

桥接器通过 HTTP 调用微信服务 API：

### 基础 URL

```
http://127.0.0.1:8099
```

### 认证

所有请求需要携带授权码参数：

```
?key={auth_key}
```

### 常用端点

#### 获取登录状态

```
GET /login/GetLoginStatus?key={auth_key}
```

#### 发送文本消息

```
POST /message/SendTextMessage?key={auth_key}
Content-Type: application/json

{
  "MsgItem": [
    {
      "ToUserName": "wxid_xxx",
      "MsgType": 1,
      "Content": "消息内容",
      "TextContent": "消息内容"
    }
  ]
}
```

#### 获取联系人列表

```
POST /friend/GetContactList?key={auth_key}
Content-Type: application/json

{}
```

#### 获取联系人详情

```
POST /friend/GetContactDetailsList?key={auth_key}
Content-Type: application/json

{
  "UserNames": ["wxid_xxx", "wxid_yyy"]
}
```

更多 API 请参考 [微信服务 API 文档](../API使用指南.md)。

---

## 配置 API

### 桥接器状态端点

桥接器提供 HTTP API 用于状态查询：

```
GET /status
```

响应：

```json
{
  "status": "running",
  "gateway": {
    "connected": true,
    "authenticated": true
  },
  "wechat": {
    "loginState": 1,
    "wsConnected": true
  },
  "version": "1.0.0"
}
```

---

## 数据类型

### 消息对象

```typescript
interface Message {
  from: string;      // 发送者 wxid
  to?: string;       // 接收者 wxid
  content: string;   // 消息内容
  type: MessageType; // 消息类型
  timestamp: number; // 时间戳
  msgId?: string;    // 消息 ID
}

type MessageType = 'text' | 'image' | 'voice' | 'emoji' | 'app';
```

### 用户对象

```typescript
interface User {
  userName: string;
  nickName: string;
  remark?: string;
  avatar?: string;
}
```

---

**最后更新**: 2026-01-31
