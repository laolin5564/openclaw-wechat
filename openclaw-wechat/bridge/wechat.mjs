/**
 * 微信服务通信模块
 */

import axios from 'axios';
import WebSocket from 'ws';
import { randomUUID as uuidv4 } from 'node:crypto';
import { delay, backoffDelay, isChatRoom, parseMessageContent } from './utils.mjs';
import * as logger from './logger.mjs';

/**
 * 微信服务 API 客户端
 */
class WechatService {
  constructor(config) {
    this.host = config.host || '127.0.0.1';
    this.port = config.port || 8099;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.authKey = config.authKey || '';
    this.adminKey = config.adminKey || 'daidai';

    this.ws = null;
    this.wsConnected = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    // 消息处理
    this.onMessage = null;
    this.onQrCode = null;
    this.onLoginSuccess = null;
    this.onLoginExpired = null;
    this.onError = null;

    // 状态
    this.loginState = 0;
    this.currentUser = null;

    // HTTP 客户端
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * 设置授权码
   */
  setAuthKey(authKey) {
    this.authKey = authKey;
  }

  /**
   * 获取 URL 参数
   */
  getUrlParams() {
    return { key: this.authKey };
  }

  /**
   * 生成授权码
   */
  async genAuthKey(count = 1, days = 365) {
    try {
      const response = await this.http.post('/admin/GenAuthKey1', {
        count,
        days,
      }, {
        params: { key: this.adminKey },
      });

      if (response.data.Code === 200) {
        return response.data.Data[0];
      }

      throw new Error(response.data.Text || '生成授权码失败');
    } catch (error) {
      logger.error('生成授权码失败', error.message);
      throw error;
    }
  }

  /**
   * 唤醒登录（免扫码）
   */
  async wakeUpLogin() {
    try {
      logger.info('尝试唤醒登录...');
      const response = await this.http.post('/login/WakeUpLogin', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        logger.success('唤醒登录成功');
        return true;
      }

      logger.warn('唤醒登录失败:', response.data.Text || '未知原因');
      return false;
    } catch (error) {
      logger.warn('唤醒登录失败', error.message);
      return false;
    }
  }

  /**
   * 获取登录二维码
   */
  async getLoginQrCode() {
    try {
      const response = await this.http.post('/login/GetLoginQrCodeNew', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        const data = response.data.Data;
        let qrcodeUrl = data.QrCodeUrl || '';

        // 如果是二维码生成服务的URL，提取实际的微信链接
        if (qrcodeUrl.includes('data=')) {
          try {
            const url = new URL(qrcodeUrl);
            const actualUrl = url.searchParams.get('data');
            if (actualUrl) {
              qrcodeUrl = actualUrl;
            }
          } catch (e) {
            // URL解析失败，使用原始值
          }
        }

        if (this.onQrCode && qrcodeUrl) {
          this.onQrCode(qrcodeUrl);
        }
        return data;
      }

      throw new Error(response.data.Text || '获取二维码失败');
    } catch (error) {
      logger.error('获取登录二维码失败', error.message);
      throw error;
    }
  }

  /**
   * 检查登录状态
   */
  async getLoginStatus() {
    try {
      const response = await this.http.get('/login/GetLoginStatus', {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        const data = response.data.Data;
        this.loginState = data.loginState || 0;

        if (this.loginState === 1 && !this.currentUser) {
          this.currentUser = { loginTime: data.loginTime };
          if (this.onLoginSuccess) {
            this.onLoginSuccess(data);
          }
        }

        return data;
      }

      return { loginState: 0 };
    } catch (error) {
      logger.error('检查登录状态失败', error.message);
      return { loginState: 0 };
    }
  }

  /**
   * 等待登录完成
   */
  async waitForLogin(interval = 2000, timeout = 120000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getLoginStatus();

      if (status.loginState === 1) {
        logger.success('微信登录成功');
        return true;
      }

      await delay(interval);
    }

    throw new Error('等待登录超时');
  }

  /**
   * 获取联系人列表
   */
  async getContactList() {
    try {
      const response = await this.http.post('/friend/GetContactList', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        const list = response.data.Data?.ContactList?.contactUsernameList || [];
        return list;
      }

      throw new Error(response.data.Text || '获取联系人列表失败');
    } catch (error) {
      logger.error('获取联系人列表失败', error.message);
      throw error;
    }
  }

  /**
   * 获取联系人详情
   */
  async getContactDetails(userNames) {
    try {
      const response = await this.http.post('/friend/GetContactDetailsList', {
        UserNames: userNames,
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        return response.data.Data?.contactList || [];
      }

      throw new Error(response.data.Text || '获取联系人详情失败');
    } catch (error) {
      logger.error('获取联系人详情失败', error.message);
      throw error;
    }
  }

  /**
   * 搜索联系人
   */
  async searchContact(keyword) {
    try {
      const response = await this.http.post('/friend/SearchContact', {
        keyword,
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        return response.data.Data || [];
      }

      return [];
    } catch (error) {
      logger.error('搜索联系人失败', error.message);
      return [];
    }
  }

  /**
   * 发送文本消息
   */
  async sendTextMessage(toUser, content) {
    try {
      const response = await this.http.post('/message/SendTextMessage', {
        MsgItem: [
          {
            ToUserName: toUser,
            MsgType: 1,
            Content: content,
            TextContent: content,
          },
        ],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        const results = response.data.Data || [];
        return results[0]?.isSendSuccess || false;
      }

      return false;
    } catch (error) {
      logger.error('发送文本消息失败', error.message);
      return false;
    }
  }

  /**
   * 发送图片消息
   */
  async sendImageMessage(toUser, imagePath) {
    try {
      const response = await this.http.post('/message/SendImageMessage', {
        ToUserName: toUser,
        ImagePath: imagePath,
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === 200) {
        return response.data.Data?.isSendSuccess || false;
      }

      return false;
    } catch (error) {
      logger.error('发送图片消息失败', error.message);
      return false;
    }
  }

  /**
   * 撤回消息
   */
  async revokeMessage(msgId, toUser) {
    try {
      const response = await this.http.post('/message/RevokeMsg', {
        MsgId: msgId,
        ToUserName: toUser,
      }, {
        params: this.getUrlParams(),
      });

      return response.data.Code === 200;
    } catch (error) {
      logger.error('撤回消息失败', error.message);
      return false;
    }
  }

  /**
   * 连接 WebSocket 接收消息
   */
  connectWebSocket() {
    const wsUrl = `ws://${this.host}:${this.port}/ws/GetSyncMsg?key=${this.authKey}`;

    logger.info(`连接微信服务 WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl, {
      handshakeTimeout: 10000,
    });

    this.ws.on('open', () => {
      logger.success('微信服务 WebSocket 已连接');
      this.wsConnected = true;
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWsMessage(message);
      } catch (error) {
        logger.error('解析微信消息失败', error.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`微信服务 WebSocket 连接关闭: ${code}`);
      this.wsConnected = false;

      // 自动重连
      if (this.shouldReconnect) {
        this.scheduleWsReconnect();
      }
    });

    this.ws.on('error', (error) => {
      logger.error('微信服务 WebSocket 错误', error.message);

      if (this.onError) {
        this.onError(error);
      }
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  handleWsMessage(message) {
    logger.info('收到微信消息 from=' + (message.from_user_name?.str || 'unknown') + ' content=' + (message.content?.str || ''));

    // 微信 WebSocket 直接发送消息对象，没有 type 包装
    // 只处理私聊消息（不过滤群聊，让用户可以决定）
    if (message && message.from_user_name && message.to_user_name) {
      const fromUser = message.from_user_name.str || '';
      const toUser = message.to_user_name.str || '';
      const content = message.content?.str || '';

      // 过滤自己发送的消息（检查 to_user_name 是否是当前用户）
      // 这里暂时不过滤，因为消息是发给我们的

      const parsed = parseMessageContent({
        content: content,
        msgType: message.msg_type,
      });

      if (this.onMessage && content) {
        this.onMessage({
          from: fromUser,
          to: toUser,
          content: parsed.content,
          type: parsed.type,
          msgType: message.msg_type,
          timestamp: message.create_time || Date.now(),
          msgId: message.msg_id,
        });
      }
    }
  }

  /**
   * 安排 WebSocket 重连
   */
  async scheduleWsReconnect() {
    if (!this.shouldReconnect) return;

    this.reconnectAttempts++;
    const delayTime = await backoffDelay(this.reconnectAttempts, 2000, 30000);

    logger.info(`准备重连微信服务... (尝试 ${this.reconnectAttempts})，等待 ${Math.round(delayTime / 1000)} 秒`);

    setTimeout(() => {
      this.connectWebSocket();
    }, delayTime);
  }

  /**
   * 断开 WebSocket
   */
  disconnectWebSocket() {
    this.shouldReconnect = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.wsConnected = false;
  }

  /**
   * 设置消息回调
   */
  on(event, callback) {
    switch (event) {
      case 'message':
        this.onMessage = callback;
        break;
      case 'qrcode':
        this.onQrCode = callback;
        break;
      case 'loginSuccess':
        this.onLoginSuccess = callback;
        break;
      case 'loginExpired':
        this.onLoginExpired = callback;
        break;
      case 'error':
        this.onError = callback;
        break;
    }
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      loginState: this.loginState,
      wsConnected: this.wsConnected,
      hasAuthKey: !!this.authKey,
    };
  }
}

/**
 * 创建微信服务实例
 */
function createWechatService(config) {
  return new WechatService(config);
}

export {
  WechatService,
  createWechatService,
};
