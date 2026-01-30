/**
 * OpenClaw Gateway 通信模块
 * 参考: https://github.com/AlexAnys/feishu-openclaw
 */

import WebSocket from 'ws';
import { randomUUID as uuidv4 } from 'node:crypto';
import { generateId, delay, backoffDelay } from './utils.mjs';
import * as logger from './logger.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 读取 Gateway Token
 */
function loadGatewayToken() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.gateway?.auth?.token || '';
  } catch (error) {
    logger.warn('无法读取 Gateway Token', error.message);
    return '';
  }
}

/**
 * Gateway 连接类
 */
class GatewayConnection {
  constructor(config) {
    this.url = config.url;
    this.channelName = config.channelName || 'wechat';
    this.version = config.version || '1.0.0';

    // 读取 Gateway Token
    this.gatewayToken = loadGatewayToken();

    this.ws = null;
    this.connected = false;
    this.authenticated = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 10;

    // 请求/响应映射
    this.pendingRequests = new Map();
    this.messageHandlers = [];

    // 事件回调
    this.onConnected = null;
    this.onDisconnected = null;
    this.onMessage = null;
    this.onError = null;
  }

  /**
   * 连接到 Gateway
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`连接到 OpenClaw Gateway: ${this.url}`);

        this.ws = new WebSocket(this.url, {
          handshakeTimeout: 10000,
        });

        this.ws.on('open', () => {
          logger.success('已连接到 OpenClaw Gateway');
          this.connected = true;
          this.reconnectAttempts = 0;

          // 发送连接帧
          this.sendConnect();
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            logger.error('解析 Gateway 消息失败', error.message);
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn(`Gateway 连接关闭: ${code} - ${reason || '无原因'}`);
          this.connected = false;
          this.authenticated = false;

          if (this.onDisconnected) {
            this.onDisconnected(code, reason);
          }

          // 自动重连
          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (error) => {
          logger.error('Gateway 连接错误', error.message);

          if (this.onError) {
            this.onError(error);
          }
        });

        // 超时处理
        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('连接 Gateway 超时'));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 发送连接帧
   */
  /**
   * 处理 connect.challenge 事件
   */
  handleChallenge(nonce) {
    const connectMsg = {
      type: 'req',
      id: 'connect',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gateway-client',
          version: '1.0.0',
          platform: process.platform,
          mode: 'backend',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth: { token: this.gatewayToken },
        locale: 'zh-CN',
        userAgent: 'openclaw-wechat-bridge',
      },
    };

    this.send(connectMsg);
  }

  sendConnect() {
    // connect.challenge 会在 handleMessage 中处理
    // 这里不需要主动发送
  }

  /**
   * 处理收到的消息
   */
  handleMessage(message) {
    logger.info('收到 Gateway 消息 type=' + message.type + ' event=' + (message.event || 'N/A') + ' id=' + (message.id || 'N/A'));

    // 处理 connect.challenge 事件
    if (message.type === 'event' && message.event === 'connect.challenge') {
      logger.info('收到 Gateway 挑战，发送认证...');
      this.handleChallenge(message.payload.nonce);
      return;
    }

    // 处理 agent 事件流
    if (message.type === 'event' && message.event === 'agent') {
      const runId = message.payload?.runId;
      // 用 runId 精确匹配 pending 请求
      const pending = runId ? this.pendingRequests.get(runId) : null;
      if (pending && pending.eventHandler) {
        pending.eventHandler(message);
      } else if (this.onMessage) {
        this.onMessage(message.payload);
      }
      return;
    }

    // 响应消息
    if (message.type === 'res') {
      // 处理 connect 响应
      if (message.id === 'connect') {
        if (message.ok) {
          this.authenticated = true;
          logger.success('Gateway 认证成功');
          if (this.onConnected) {
            this.onConnected();
          }
        } else {
          logger.error('Gateway 认证失败', message.error);
        }
        return;
      }

      // 处理其他待处理请求
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        // 对于 agent 请求，"accepted" 状态不要删除 pending，等待后续流式响应
        if (message.id?.startsWith('agent-') && message.payload?.status === 'accepted') {
          logger.info('Agent 请求已接受，等待流式响应...');
          return;
        }

        this.pendingRequests.delete(message.id);

        if (message.ok) {
          pending.resolve(message.payload || {});
        } else {
          const errorMsg = typeof message.error === 'object'
            ? JSON.stringify(message.error)
            : (message.error || '请求失败');
          pending.reject(new Error(errorMsg));
        }
      }
      return;
    }

    // 事件消息
    if (message.type === 'event') {
      if (message.event === 'connected') {
        this.authenticated = true;
        logger.success('Gateway 认证成功');
        if (this.onConnected) {
          this.onConnected();
        }
      } else if (message.event === 'message') {
        if (this.onMessage) {
          this.onMessage(message.payload);
        }
      }
      return;
    }

    // 请求消息 (Gateway 主动发起)
    if (message.type === 'req') {
      if (this.onMessage) {
        this.onMessage(message);
      }
    }
  }

  /**
   * 发送消息到 Gateway
   */
  send(data) {
    if (!this.connected || !this.ws) {
      logger.warn('Gateway 未连接，无法发送消息');
      return null;
    }

    try {
      const message = JSON.stringify(data);
      this.ws.send(message);
      return data.id;
    } catch (error) {
      logger.error('发送消息到 Gateway 失败', error.message);
      return null;
    }
  }

  /**
   * 发送请求（等待响应）
   */
  /**
   * 调用 AI Agent (处理流式响应)
   */
  async callAgent(params) {
    if (!this.connected) {
      throw new Error('Gateway 未连接');
    }

    const id = 'agent-' + uuidv4();
    let buffer = '';

    logger.info(`调用 Agent: ${params.agentId} message="${params.message.substring(0, 30)}..."`);

    return new Promise((resolve, reject) => {
      // 设置超时 (2分钟)
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Agent 响应超时'));
      }, 120000);

      // 注册待处理请求
      this.pendingRequests.set(id, {
        id,
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        // 用于流式响应
        eventHandler: (msg) => {
          logger.debug('Agent 事件', msg);

          if (msg.type === 'event' && msg.event === 'agent') {
            const p = msg.payload;
            if (!p) return;

            // 流式文本
            if (p.stream === 'assistant') {
              const d = p.data || {};
              if (typeof d.text === 'string') {
                buffer = d.text;
                logger.debug(`Agent 文本: ${buffer.substring(0, 30)}...`);
              } else if (typeof d.delta === 'string') {
                buffer += d.delta;
              }
            }

            // 生命周期事件
            if (p.stream === 'lifecycle') {
              if (p.data?.phase === 'end') {
                logger.info(`Agent 完成: ${buffer.substring(0, 30)}...`);
                clearTimeout(timeout);
                this.pendingRequests.delete(id);
                resolve({ text: buffer.trim() });
              } else if (p.data?.phase === 'error') {
                clearTimeout(timeout);
                this.pendingRequests.delete(id);
                reject(new Error(p.data?.message || 'Agent 错误'));
              }
            }
          }
        },
      });

      // 发送请求
      this.send({
        type: 'req',
        id,
        method: 'agent',
        params: {
          ...params,
          idempotencyKey: id,
        },
      });
    });
  }

  /**
   * 普通请求 (非流式)
   */
  async request(method, params = {}) {
    if (!this.connected) {
      throw new Error('Gateway 未连接');
    }

    const id = uuidv4();

    return new Promise((resolve, reject) => {
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('请求超时'));
      }, 30000);

      // 注册待处理请求
      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      // 发送请求
      this.send({
        type: 'req',
        id,
        method,
        params,
      });
    });
  }

  /**
   * 发送用户消息到 Gateway
   */
  async sendMessage(fromUser, content, messageType = 'text') {
    return this.request('send', {
      channel: this.channelName,
      message: {
        from: fromUser,
        content,
        type: messageType,
      },
    });
  }

  /**
   * 安排重连
   */
  async scheduleReconnect() {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`重连失败次数过多 (${this.reconnectAttempts})，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    const delay = await backoffDelay(this.reconnectAttempts, 2000, 30000);

    logger.info(`准备重连 Gateway... (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts})，等待 ${Math.round(delay / 1000)} 秒`);

    setTimeout(() => {
      this.connect().catch((error) => {
        logger.error('重连 Gateway 失败', error.message);
      });
    }, delay);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.shouldReconnect = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.authenticated = false;
    logger.info('已断开 Gateway 连接');
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      connected: this.connected,
      authenticated: this.authenticated,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

/**
 * 创建 Gateway 连接
 */
function createGateway(config) {
  return new GatewayConnection(config);
}

export {
  GatewayConnection,
  createGateway,
};
