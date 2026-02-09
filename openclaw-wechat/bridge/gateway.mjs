/**
 * OpenClaw Gateway 通信模块
 * 强化版：含连接重试、响应校验、完善日志
 */

import WebSocket from 'ws';
import { randomUUID as uuidv4 } from 'node:crypto';
import { generateId, delay, backoffDelay } from './utils.mjs';
import * as logger from './logger.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 读取 Gateway Token（带容错）
 */
function loadGatewayToken() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

  try {
    if (!fs.existsSync(configPath)) {
      logger.warn(`Gateway 配置文件不存在: ${configPath}`);
      return '';
    }
    fs.accessSync(configPath, fs.constants.R_OK);
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const token = config.gateway?.auth?.token || '';
    if (!token) {
      logger.warn('Gateway 配置中未找到 token');
    }
    return token;
  } catch (error) {
    if (error.code === 'EACCES') {
      logger.error(`Gateway 配置文件权限不足: ${configPath}`);
    } else if (error instanceof SyntaxError) {
      logger.error(`Gateway 配置文件 JSON 格式错误: ${configPath}`);
    } else {
      logger.warn(`无法读取 Gateway Token: ${error.message}`);
    }
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
   * 连接到 Gateway（带超时）
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const connectTimeout = 15000;

      try {
        logger.info(`连接到 OpenClaw Gateway: ${this.url}`);

        this.ws = new WebSocket(this.url, {
          handshakeTimeout: 10000,
        });

        const timer = setTimeout(() => {
          if (!this.connected) {
            logger.error(`连接 Gateway 超时 (${connectTimeout}ms)`);
            try { this.ws.close(); } catch {}
            reject(new Error('连接 Gateway 超时'));
          }
        }, connectTimeout);

        this.ws.on('open', () => {
          logger.success('已连接到 OpenClaw Gateway');
          this.connected = true;
          this.reconnectAttempts = 0;
          clearTimeout(timer);
          this.sendConnect();
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const raw = data.toString();
            if (!raw || raw.trim() === '') {
              logger.debug('收到空 Gateway 消息，忽略');
              return;
            }
            const message = JSON.parse(raw);
            this.handleMessage(message);
          } catch (error) {
            logger.error(`解析 Gateway 消息失败: ${error.message} raw=${String(data).substring(0, 100)}`);
          }
        });

        this.ws.on('close', (code, reason) => {
          logger.warn(`Gateway 连接关闭: code=${code} reason=${reason || '无'}`);
          this.connected = false;
          this.authenticated = false;
          clearTimeout(timer);

          if (this.onDisconnected) {
            this.onDisconnected(code, reason);
          }

          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (error) => {
          logger.error(`Gateway 连接错误: ${error.message}`);
          clearTimeout(timer);
          if (this.onError) {
            this.onError(error);
          }
        });
      } catch (error) {
        logger.error(`创建 Gateway WebSocket 失败: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * 处理 connect.challenge 事件
   */
  handleChallenge(nonce) {
    logger.info('处理 Gateway 认证挑战...');
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
  }

  /**
   * 处理收到的消息（带容错）
   */
  handleMessage(message) {
    try {
      if (!message || typeof message !== 'object') {
        logger.warn('收到无效的 Gateway 消息格式');
        return;
      }

      logger.debug(`Gateway 消息 type=${message.type} event=${message.event || 'N/A'} id=${message.id || 'N/A'}`);

      // 处理 connect.challenge 事件
      if (message.type === 'event' && message.event === 'connect.challenge') {
        logger.info('收到 Gateway 挑战，发送认证...');
        this.handleChallenge(message.payload?.nonce);
        return;
      }

      // 处理 agent 事件流
      if (message.type === 'event' && message.event === 'agent') {
        const runId = message.payload?.runId;
        const pending = runId ? this.pendingRequests.get(runId) : null;
        if (pending?.eventHandler) {
          pending.eventHandler(message);
        } else if (this.onMessage) {
          this.onMessage(message.payload);
        }
        return;
      }

      // 响应消息
      if (message.type === 'res') {
        if (message.id === 'connect') {
          if (message.ok) {
            this.authenticated = true;
            logger.success('Gateway 认证成功');
            if (this.onConnected) this.onConnected();
          } else {
            logger.error('Gateway 认证失败', typeof message.error === 'object' ? JSON.stringify(message.error) : message.error);
          }
          return;
        }

        const pending = this.pendingRequests.get(message.id);
        if (pending) {
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
          logger.success('Gateway 认证成功 (connected event)');
          if (this.onConnected) this.onConnected();
        } else if (message.event === 'message') {
          if (this.onMessage) this.onMessage(message.payload);
        }
        return;
      }

      // 请求消息 (Gateway 主动发起)
      if (message.type === 'req') {
        if (this.onMessage) this.onMessage(message);
      }
    } catch (error) {
      logger.error(`处理 Gateway 消息异常: ${error.message}`, error.stack);
    }
  }

  /**
   * 发送消息到 Gateway（带状态检查）
   */
  send(data) {
    if (!this.connected || !this.ws) {
      logger.warn(`Gateway 未连接，无法发送消息 method=${data?.method || 'unknown'}`);
      return null;
    }

    try {
      const message = JSON.stringify(data);
      this.ws.send(message);
      return data.id;
    } catch (error) {
      logger.error(`发送消息到 Gateway 失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 调用 AI Agent (处理流式响应，带超时)
   */
  async callAgent(params) {
    if (!this.connected) {
      throw new Error('Gateway 未连接');
    }
    if (!this.authenticated) {
      throw new Error('Gateway 未认证');
    }

    const id = 'agent-' + uuidv4();
    let buffer = '';

    const msgPreview = (params.message || '').substring(0, 30);
    logger.info(`调用 Agent: agentId=${params.agentId} session=${params.sessionKey} message="${msgPreview}..."`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        logger.error(`Agent 响应超时 id=${id} agentId=${params.agentId}`);
        reject(new Error('Agent 响应超时'));
      }, 120000);

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
        eventHandler: (msg) => {
          try {
            if (msg.type === 'event' && msg.event === 'agent') {
              const p = msg.payload;
              if (!p) return;

              if (p.stream === 'assistant') {
                const d = p.data || {};
                if (typeof d.text === 'string') {
                  buffer = d.text;
                } else if (typeof d.delta === 'string') {
                  buffer += d.delta;
                }
              }

              if (p.stream === 'lifecycle') {
                if (p.data?.phase === 'end') {
                  logger.info(`Agent 完成 id=${id} responseLen=${buffer.length}`);
                  clearTimeout(timeout);
                  this.pendingRequests.delete(id);
                  resolve({ text: buffer.trim() });
                } else if (p.data?.phase === 'error') {
                  const errMsg = p.data?.message || 'Agent 错误';
                  logger.error(`Agent 返回错误 id=${id}: ${errMsg}`);
                  clearTimeout(timeout);
                  this.pendingRequests.delete(id);
                  reject(new Error(errMsg));
                }
              }
            }
          } catch (error) {
            logger.error(`处理 Agent 事件异常 id=${id}: ${error.message}`);
          }
        },
      });

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
   * 普通请求 (非流式，带超时)
   */
  async request(method, params = {}) {
    if (!this.connected) {
      throw new Error('Gateway 未连接');
    }

    const id = uuidv4();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        logger.error(`Gateway 请求超时 method=${method} id=${id}`);
        reject(new Error(`请求超时: ${method}`));
      }, 30000);

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
    try {
      return await this.request('send', {
        channel: this.channelName,
        message: { from: fromUser, content, type: messageType },
      });
    } catch (error) {
      logger.error(`发送消息到 Gateway 失败 from=${fromUser}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 安排重连（带上限和日志）
   */
  async scheduleReconnect() {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Gateway 重连失败次数过多 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，停止重连`);
      return;
    }

    this.reconnectAttempts++;
    const waitTime = await backoffDelay(this.reconnectAttempts, 2000, 30000);

    logger.info(`准备重连 Gateway (尝试 ${this.reconnectAttempts}/${this.maxReconnectAttempts})，等待 ${Math.round(waitTime / 1000)} 秒`);

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch((error) => {
          logger.error(`重连 Gateway 失败: ${error.message}`);
        });
      }
    }, waitTime);
  }

  /**
   * 断开连接（清理 pending requests）
   */
  disconnect() {
    this.shouldReconnect = false;

    // 清理所有 pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Gateway 连接已主动关闭'));
    }
    this.pendingRequests.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        logger.debug(`关闭 Gateway WebSocket 异常（可忽略）: ${e.message}`);
      }
      this.ws = null;
    }

    this.connected = false;
    this.authenticated = false;
    logger.info('已断开 Gateway 连接');
  }

  getStatus() {
    return {
      connected: this.connected,
      authenticated: this.authenticated,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
    };
  }
}

function createGateway(config) {
  return new GatewayConnection(config);
}

export {
  GatewayConnection,
  createGateway,
};
