# 微信 iPad 协议 API 使用指南

## 目录
1. [启动服务](#启动服务)
2. [生成授权码](#生成授权码)
3. [获取登录二维码](#获取登录二维码)
4. [检查登录状态](#检查登录状态)
5. [获取联系人列表](#获取联系人列表)
6. [获取联系人详情](#获取联系人详情)
7. [发送文本消息](#发送文本消息)
8. [接收消息](#接收消息)

---

## 启动服务

```bash
cd /Users/laolin/Downloads/部署
./start.sh
```

服务启动后访问：http://localhost:8099/docs

---

## 生成授权码

管理员密钥：`daidai`

### 请求

```bash
curl -X POST "http://localhost:8099/admin/GenAuthKey1?key=daidai" \
  -H "Content-Type: application/json" \
  -d '{"count": 1, "days": 365}'
```

### 响应

```json
{
  "Code": 200,
  "Data": ["HBe6xqD0LJIf"],
  "Text": "AuthKey生成成功"
}
```

**授权码：** `HBe6xqD0LJIf` （有效期 365 天）

---

## 获取登录二维码

### 请求

```bash
curl -X POST "http://localhost:8099/login/GetLoginQrCodeNew?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 响应

```json
{
  "Code": 200,
  "Data": {
    "Key": "HBe6xqD0LJIf",
    "QrCodeUrl": "https://api.2dcode.biz/v1/create-qr-code?data=http://weixin.qq.com/x/xxx",
    "Txt": "建议返回data=之后内容自定义生成二维码"
  }
}
```

### 扫码登录

1. 打开 `QrCodeUrl` 或扫描 `http://weixin.qq.com/x/xxx`
2. 用微信扫码确认登录

---

## 检查登录状态

### 请求

```bash
curl "http://localhost:8099/login/GetLoginStatus?key=HBe6xqD0LJIf"
```

### 响应

```json
{
  "Code": 200,
  "Data": {
    "loginState": 1,
    "loginErrMsg": "账号在线状态良好！",
    "loginTime": "2026-01-31 00:38:49",
    "onlineTime": "本次在线: 0天0时1分",
    "expiryTime": "2027-01-31"
  }
}
```

**loginState 值：**
- `1` = 在线
- `0` = 离线

---

## 获取联系人列表

### 请求

```bash
curl -X POST "http://localhost:8099/friend/GetContactList?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 响应

```json
{
  "Code": 200,
  "Data": {
    "ContactList": {
      "contactUsernameList": [
        "weixin",
        "wxid_vs8rvvmuz4gm12",
        "wxid_3ow0cp77wim822",
        ...
      ]
    }
  }
}
```

---

## 获取联系人详情

### 请求

```bash
curl -X POST "http://localhost:8099/friend/GetContactDetailsList?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{"UserNames": ["wxid_3ow0cp77wim822", "wxid_vs8rvvmuz4gm12"]}'
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| UserNames | array | wxid 数组 |

### 响应

```json
{
  "Code": 200,
  "Data": {
    "contactCount": 2,
    "contactList": [
      {
        "userName": {"str": "wxid_3ow0cp77wim822"},
        "nickName": {"str": "林杰"}
      },
      {
        "userName": {"str": "wxid_vs8rvvmuz4gm12"},
        "nickName": {"str": "小嘉ʚɞ²"}
      }
    ]
  }
}
```

### 完整示例（获取所有联系人昵称）

```bash
# 1. 先获取所有 wxid
WXIDS=$(curl -s -X POST "http://localhost:8099/friend/GetContactList?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.Data.ContactList.contactUsernameList[]' | jq -R -s -c 'split("\n")[:-1]')

# 2. 获取详情
curl -X POST "http://localhost:8099/friend/GetContactDetailsList?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d "{\"UserNames\": $WXIDS}"
```

---

## 发送文本消息

### 请求

```bash
curl -X POST "http://localhost:8099/message/SendTextMessage?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{
    "MsgItem": [
      {
        "ToUserName": "wxid_3ow0cp77wim822",
        "MsgType": 1,
        "TextContent": "1"
      }
    ]
  }'
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| MsgItem | array | 消息数组 |
| ToUserName | string | 接收者 wxid |
| MsgType | int | 1=文本, 2=图片 |
| TextContent | string | 消息内容 |

### 响应

```json
{
  "Code": 200,
  "Data": [
    {
      "isSendSuccess": true,
      "textContent": "1",
      "toUSerName": "wxid_3ow0cp77wim822"
    }
  ]
}
```

---

## 接收消息

### 方式一：HTTP 轮询

```bash
curl -X POST "http://localhost:8099/message/HttpSyncMsg?key=HBe6xqD0LJIf" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 方式二：WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8099/ws/GetSyncMsg?key=HBe6xqD0LJIf');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg);
};
```

---

## 常用 API 端点

| 功能 | 方法 | 路径 |
|------|------|------|
| 生成授权码 | POST | `/admin/GenAuthKey1?key={admin_key}` |
| 获取二维码 | POST | `/login/GetLoginQrCodeNew?key={auth_key}` |
| 登录状态 | GET | `/login/GetLoginStatus?key={auth_key}` |
| 联系人列表 | POST | `/friend/GetContactList?key={auth_key}` |
| 联系人详情 | POST | `/friend/GetContactDetailsList?key={auth_key}` |
| 发送文本 | POST | `/message/SendTextMessage?key={auth_key}` |
| 发送图片 | POST | `/message/SendImageMessage?key={auth_key}` |
| HTTP 轮询消息 | POST | `/message/HttpSyncMsg?key={auth_key}` |
| 群聊列表 | GET | `/friend/GroupList?key={auth_key}` |
| 创建群聊 | POST | `/group/CreateChatRoom?key={auth_key}` |

---

## 重要参数说明

| 参数 | 说明 | 示例 |
|------|------|------|
| key | 授权码（URL 参数） | `?key=HBe6xqD0LJIf` |
| admin_key | 管理员密钥 | `daidai` |
| wxid | 微信用户 ID | `wxid_3ow0cp77wim822` |
| ToUserName | 接收者 wxid | 同 wxid |
| MsgType | 消息类型 | 1=文本, 2=图片 |

---

## 故障排查

### 问题：初始化未完成

等待 10-30 秒后重试，或调用 `HttpSyncMsg` 触发同步。

### 问题：找不到联系人

1. 确保 wxid 正确
2. 使用 `GetContactDetailsList` 获取详细信息
3. 联系人可能不在最近聊天列表中

### 问题：消息发送失败

检查 `isSendSuccess` 字段，确认网络连接正常。

---

## 注意事项

1. **授权码** 由管理员通过 `/admin/GenAuthKey1` 生成
2. **所有请求** 都需要携带 `key` 参数（授权码）
3. **wxid** 是发送/接收消息的唯一标识
4. 文档地址：http://localhost:8099/docs
