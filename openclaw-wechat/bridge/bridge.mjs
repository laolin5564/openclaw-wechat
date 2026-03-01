/**
 * @module bridge
 * @description OpenClaw 微信桥接器主模块
 * 连接微信 iPad 协议服务和 OpenClaw Gateway，实现双向消息转发
 */

import { loadConfig, saveConfig, getAuthKey, saveAuthKey, getAllowedUsers, addAllowedUser, isUserAllowed, getPairingCode, getPaths } from './config.mjs';
import * as logger from './logger.mjs';
import { delay, parseImageXml, WX_MSG_TYPE } from './utils.mjs';
import { randomBytes } from 'node:crypto';
import { GatewayConnection } from './gateway.mjs';
import { WechatService } from './wechat.mjs';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';

// ── 常量定义 ─────────────────────────────────────────────

/** 桥接器版本 */
const VERSION = '1.0.0';

/** 桥接器名称 */
const NAME = 'openclaw-wechat-bridge';

/** 心跳检查间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 授权码有效天数 */
const AUTH_KEY_VALID_DAYS = 365;

/** 图片文件扩展名 */
const IMAGE_EXTENSIONS = 'jpg|jpeg|png|gif|webp';

/** 文件扩展名（非图片） */
const FILE_EXTENSIONS = 'pdf|docx|doc|xlsx|xls|pptx|ppt|zip|rar|7z|tar|gz|txt|csv|mp3|mp4|mov|avi|mkv|wav|flac|aac';

/** 日志预览截断长度 */
const LOG_PREVIEW_LENGTH = 50;

/**
 * 桥接器主类
 * 负责协调微信服务和 Gateway 之间的消息转发
 */
class Bridge {
  constructor() {
    /** @type {object|null} */
    this.config = null;
    /** @type {GatewayConnection|null} */
    this.gateway = null;
    /** @type {WechatService|null} */
    this.wechat = null;
    /** @type {boolean} */
    this.running = false;
    /** @type {Map<string, object>} */
    this.pendingMessages = new Map();
    /** @type {Map<string, NodeJS.Timeout>} */
    this.thinkingTimeouts = new Map();
  }

  /**
   * 初始化桥接器：加载配置、检查授权码
   * @returns {Promise<void>}
   * @throws {Error} 首次运行未配置时退出
   */
  async init() {
    this.config = loadConfig();
    logger.setLevel(this.config.logging.level);

    logger.title('OpenClaw 微信桥接器');
    logger.info(`版本: ${VERSION}`);

    if (this.config._isFirstRun) {
      logger.warn('检测到首次运行，请先运行: npm run setup');
      logger.info('或者手动配置 ~/.openclaw/openclaw-wechat.json');
      process.exit(1);
    }

    let authKey = getAuthKey();
    if (!authKey) {
      logger.warn('未找到授权码，正在生成...');
      await this.genAndSaveAuthKey();
      authKey = getAuthKey();
    }

    this.config.wechatService.authKey = authKey;
    logger.info('配置加载成功');
  }

  /**
   * 生成并保存微信授权码
   * @returns {Promise<string>} 生成的授权码
   * @throws {Error} 生成失败
   */
  async genAndSaveAuthKey() {
    const wechat = new WechatService({
      ...this.config.wechatService,
      adminKey: 'daidai',
    });

    try {
      logger.info('正在生成授权码...');
      const authKey = await wechat.genAuthKey(1, AUTH_KEY_VALID_DAYS);
      saveAuthKey(authKey);
      logger.success(`授权码已生成: ${authKey}`);
      return authKey;
    } catch (error) {
      logger.error('生成授权码失败', error.message);
      throw error;
    }
  }

  /**
   * 启动桥接器：依次启动微信服务、检查登录、连接 Gateway、启动消息监听
   * @returns {Promise<void>}
   * @throws {Error} 启动失败
   */
  async start() {
    if (this.running) {
      logger.warn('桥接器已在运行中');
      return;
    }

    this.running = true;
    logger.separator();

    try {
      await this.checkAndStartWechatService();
      await this.checkLoginStatus();
      await this.connectGateway();
      this.startWechatListener();

      logger.separator();
      logger.success('🦞 微信助手已上线');
      logger.info('等待消息中...');
      logger.separator();

      this.keepAlive();
    } catch (error) {
      logger.error('启动失败', error.message);
      this.stop();
      throw error;
    }
  }

  /**
   * 检查并连接微信 iPad 协议服务
   * @returns {Promise<void>}
   * @throws {Error} 微信服务未运行
   */
  async checkAndStartWechatService() {
    logger.info('检查微信服务状态...');

    this.wechat = new WechatService({
      ...this.config.wechatService,
      authKey: this.config.wechatService.authKey || getAuthKey(),
    });

    try {
      await this.wechat.getLoginStatus();
      logger.success('微信服务正在运行');
    } catch (error) {
      logger.warn('微信服务未运行，请先启动微信服务');
      logger.info('运行: ./scripts/start.sh (Windows: start.bat)');
      throw new Error('微信服务未运行');
    }
  }

  /**
   * 检查微信登录状态，未登录时尝试唤醒或扫码
   * @returns {Promise<void>}
   * @throws {Error} 登录超时
   */
  async checkLoginStatus() {
    logger.info('检查微信登录状态...');

    const status = await this.wechat.getLoginStatus();

    if (status.loginState === 1) {
      logger.success('微信已登录');
      logger.info(`登录时间: ${status.loginTime}`);
      logger.info(`在线时长: ${status.onlineTime}`);
      return;
    }

    // 尝试唤醒登录（免扫码）
    logger.warn('微信未登录，尝试唤醒登录...');
    const wakeUpSuccess = await this.wechat.wakeUpLogin();

    if (wakeUpSuccess) {
      await this.wechat.waitForLogin();
      return;
    }

    // 唤醒失败，显示二维码
    logger.warn('唤醒登录失败，正在获取二维码...');

    this.wechat.on('qrcode', (qrcodeUrl) => {
      logger.separator();
      logger.info('请使用微信扫描以下二维码登录:');
      qrcode.generate(qrcodeUrl, { small: true });
      console.log(`\n链接: ${qrcodeUrl}\n`);
      logger.separator();
    });

    try {
      await this.wechat.getLoginQrCode();
      await this.wechat.waitForLogin();
    } catch (error) {
      logger.error('登录超时或失败', error.message);
      throw error;
    }
  }

  /**
   * 连接 OpenClaw Gateway WebSocket 服务
   * @returns {Promise<void>}
   * @throws {Error} 连接失败
   */
  async connectGateway() {
    logger.info(`连接 OpenClaw Gateway: ${this.config.gateway.url}`);

    this.gateway = new GatewayConnection({
      url: this.config.gateway.url,
      token: this.config.gateway.token,
      channelName: 'wechat',
      version: VERSION,
      maxReconnectAttempts: this.config.behavior.maxReconnectAttempts,
    });

    this.gateway.onConnected = () => {
      logger.success('Gateway 已连接并认证');
    };

    this.gateway.onDisconnected = (code, reason) => {
      logger.warn(`Gateway 连接断开: ${code} - ${reason || '无原因'}`);
    };

    this.gateway.onError = (error) => {
      logger.error('Gateway 错误', error.message);
    };

    this.gateway.onMessage = (payload) => {
      this.handleGatewayMessage(payload);
    };

    try {
      await this.gateway.connect();
    } catch (error) {
      logger.error('连接 Gateway 失败', error.message);
      logger.info('请确认 OpenClaw Gateway 正在运行');
      throw error;
    }
  }

  /**
   * 启动微信消息监听（WebSocket）
   */
  startWechatListener() {
    logger.info('启动微信消息监听...');

    this.wechat.on('message', (message) => {
      this.handleWechatMessage(message);
    });

    this.wechat.on('loginExpired', () => {
      logger.warn('微信登录已失效，请重新扫码登录');
    });

    this.wechat.on('error', (error) => {
      logger.error('微信服务错误', error.message);
    });

    this.wechat.connectWebSocket();
  }

  /**
   * 处理微信收到的消息（用户 → AI）
   * 包括授权检查、配对码验证、文件/图片下载、转发到 Gateway
   * @param {object} message - 解析后的微信消息对象
   * @param {string} message.from - 发送者微信 ID
   * @param {string} message.to - 接收者微信 ID
   * @param {string} message.content - 消息内容
   * @param {string} message.type - 消息类型
   * @param {number} [message.msgType] - 微信消息类型码
   * @param {number} [message.msgId] - 消息 ID
   * @returns {Promise<void>}
   */
  async handleWechatMessage(message) {
    logger.info(`收到消息 from=${message.from} type=${message.type}`);
    logger.debug('消息内容', message.content);

    const wxid = message.from;
    const content = message.content?.trim() || '';

    // 授权检查
    if (!isUserAllowed(wxid)) {
      const pairingCode = getPairingCode();

      if (content.toUpperCase() === pairingCode) {
        addAllowedUser(wxid, '');
        logger.success(`用户 ${wxid} 配对成功`);
        await this.wechat.sendTextMessage(wxid, '✅ 配对成功！现在可以开始对话了。');
        return;
      }

      logger.info(`未授权用户 ${wxid} 消息已忽略`);
      return;
    }

    try {
      let messageToSend = message.content;
      let attachments = [];

      // 处理文件消息 (msgType 49 / App 消息)
      if (message.type === 'file' || message.type === 'app' || message.msgType === WX_MSG_TYPE.APP) {
        logger.info('检测到文件消息，尝试下载...');

        const filePath = await this.downloadAndSaveFile(message);
        if (filePath) {
          attachments.push({ type: 'file', path: filePath });
          const fileName = path.basename(filePath);
          messageToSend = `[用户发送了一个文件: ${fileName}]`;
          logger.success(`文件已保存: ${filePath}`);
        } else {
          messageToSend = '[用户发送了一个文件，但下载失败]';
          logger.warn('文件下载失败');
        }
      }

      // 处理图片消息
      if (message.type === 'image' && message.msgId) {
        logger.info('检测到图片消息，尝试下载...');

        const imageInfo = parseImageXml(message.content);
        if (imageInfo && imageInfo.length > 0) {
          const imagePath = await this.downloadAndSaveImage({
            msgId: message.msgId,
            totalLen: imageInfo.hdlength || imageInfo.length,
            fromUser: message.from,
            toUser: message.to,
          });

          if (imagePath) {
            attachments.push({ type: 'image', path: imagePath });
            messageToSend = '[用户发送了一张图片]';
            logger.success(`图片已保存: ${imagePath}`);
          } else {
            messageToSend = '[用户发送了一张图片，但下载失败]';
            logger.warn('图片下载失败');
          }
        }
      }

      // 发送到 Gateway
      const agentParams = {
        message: messageToSend,
        agentId: 'main',
        sessionKey: `agent:main:wechat:${message.from}`,
        deliver: false,
      };

      if (attachments.length > 0) {
        agentParams.attachments = attachments;
      }

      const response = await this.gateway.callAgent(agentParams);

      // 处理 AI 回复
      if (response && response.text) {
        const replyText = response.text.trim();
        logger.info(`AI 回复: ${replyText.substring(0, LOG_PREVIEW_LENGTH)}...`);

        const imagePaths = this.extractImagePaths(replyText);
        const filePaths = this.extractFilePaths(replyText);

        if (filePaths.length > 0) {
          await this.sendReplyWithFiles(message.from, replyText, filePaths, '[文件]');
        } else if (imagePaths.length > 0) {
          await this.sendReplyWithImages(message.from, replyText, imagePaths);
        } else {
          await this.wechat.sendTextMessage(message.from, replyText);
        }
      }
    } catch (error) {
      logger.error('处理消息失败', error);
      logger.error('错误堆栈', error.stack);

      try {
        await this.wechat.sendTextMessage(
          message.from,
          '抱歉，处理消息时出错，请稍后重试。'
        );
      } catch (e) {
        logger.error('发送错误提示失败', e.message);
      }
    }
  }

  /**
   * 发送带文件附件的回复（文字 + 文件分开发送）
   * @param {string} toUser - 接收者微信 ID
   * @param {string} replyText - 原始回复文本
   * @param {string[]} filePaths - 文件路径列表
   * @param {string} [placeholder='[文件]'] - 路径替换占位符
   * @returns {Promise<void>}
   */
  async sendReplyWithFiles(toUser, replyText, filePaths, placeholder = '[文件]') {
    let textOnly = replyText;
    for (const fPath of filePaths) {
      textOnly = textOnly.replace(fPath, placeholder);
    }
    textOnly = textOnly.replace(new RegExp(`\`\\${placeholder}\``, 'g'), placeholder).trim();

    if (textOnly && textOnly !== placeholder) {
      await this.wechat.sendTextMessage(toUser, textOnly);
    }

    for (const fPath of filePaths) {
      logger.info(`发送文件: ${fPath}`);
      const success = await this.wechat.sendFileMessage(toUser, fPath);
      if (success) {
        logger.success(`文件发送成功: ${fPath}`);
      } else {
        logger.warn(`文件发送失败: ${fPath}`);
        await this.wechat.sendTextMessage(toUser, `文件发送失败，路径: ${fPath}`);
      }
    }
  }

  /**
   * 发送带图片附件的回复（文字 + 图片分开发送）
   * @param {string} toUser - 接收者微信 ID
   * @param {string} replyText - 原始回复文本
   * @param {string[]} imagePaths - 图片路径列表
   * @returns {Promise<void>}
   */
  async sendReplyWithImages(toUser, replyText, imagePaths) {
    let textOnly = replyText;
    for (const imgPath of imagePaths) {
      textOnly = textOnly.replace(imgPath, '[图片]');
    }
    textOnly = textOnly.replace(/`\[图片\]`/g, '[图片]').trim();

    if (textOnly && textOnly !== '[图片]') {
      await this.wechat.sendTextMessage(toUser, textOnly);
    }

    for (const imgPath of imagePaths) {
      logger.info(`发送图片: ${imgPath}`);
      const success = await this.wechat.sendImageMessage(toUser, imgPath);
      if (success) {
        logger.success(`图片发送成功: ${imgPath}`);
      } else {
        logger.warn(`图片发送失败: ${imgPath}`);
        await this.wechat.sendTextMessage(toUser, `图片发送失败，路径: ${imgPath}`);
      }
    }
  }

  /**
   * 从回复文本中提取图片文件路径
   * @param {string} text - 回复文本
   * @returns {string[]} 去重后的图片路径列表（仅包含实际存在的文件）
   */
  extractImagePaths(text) {
    const paths = [];

    const patterns = [
      new RegExp(`/Users/[^\\s\`'"\\n]+\\.(?:${IMAGE_EXTENSIONS})`, 'gi'),
      new RegExp(`/tmp/[^\\s\`'"\\n]+\\.(?:${IMAGE_EXTENSIONS})`, 'gi'),
      new RegExp(`~/[^\\s\`'"\\n]+\\.(?:${IMAGE_EXTENSIONS})`, 'gi'),
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          let cleanPath = match.replace(/`/g, '').trim();
          if (cleanPath.startsWith('~/')) {
            cleanPath = cleanPath.replace('~', process.env.HOME || '/Users/laolin');
          }
          if (fs.existsSync(cleanPath)) {
            paths.push(cleanPath);
          }
        }
      }
    }

    return [...new Set(paths)];
  }

  /**
   * 从回复文本中提取非图片文件路径
   * @param {string} text - 回复文本
   * @returns {string[]} 去重后的文件路径列表（仅包含实际存在的文件）
   */
  extractFilePaths(text) {
    const paths = [];

    const patterns = [
      new RegExp(`/Users/[^\\s\`'"\\n]+\\.(?:${FILE_EXTENSIONS})`, 'gi'),
      new RegExp(`/tmp/[^\\s\`'"\\n]+\\.(?:${FILE_EXTENSIONS})`, 'gi'),
      new RegExp(`~/[^\\s\`'"\\n]+\\.(?:${FILE_EXTENSIONS})`, 'gi'),
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          let cleanPath = match.replace(/`/g, '').trim();
          if (cleanPath.startsWith('~/')) {
            cleanPath = cleanPath.replace('~', process.env.HOME || '/Users/laolin');
          }
          if (fs.existsSync(cleanPath)) {
            paths.push(cleanPath);
          }
        }
      }
    }

    return [...new Set(paths)];
  }

  /**
   * 下载微信文件消息并保存到本地
   * @param {object} message - 微信消息对象
   * @returns {Promise<string|null>} 保存的文件路径，失败返回 null
   */
  async downloadAndSaveFile(message) {
    try {
      const result = await this.wechat.downloadFile(message);
      if (!result || !result.buffer) return null;

      const paths = getPaths();
      const fileDir = path.join(paths.configDir, 'media', 'wechat', 'files');

      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }

      const fileName = result.fileName || message.fileName || message.filename || `${Date.now()}_${message.msgId || 'file'}`;
      const filePath = path.join(fileDir, fileName);

      fs.writeFileSync(filePath, result.buffer);
      return filePath;
    } catch (error) {
      logger.error('保存文件失败', error.message);
      return null;
    }
  }

  /**
   * 下载微信图片消息并保存到本地
   * @param {object} params - 下载参数
   * @param {number} params.msgId - 消息 ID
   * @param {number} params.totalLen - 图片总大小
   * @param {string} params.fromUser - 发送者
   * @param {string} params.toUser - 接收者
   * @returns {Promise<string|null>} 保存的图片路径，失败返回 null
   */
  async downloadAndSaveImage(params) {
    try {
      const imageBuffer = await this.wechat.downloadImage(params);
      if (!imageBuffer) return null;

      const paths = getPaths();
      const mediaDir = path.join(paths.configDir, 'media', 'wechat');

      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const filename = `${Date.now()}_${params.msgId}.jpg`;
      const filePath = path.join(mediaDir, filename);

      fs.writeFileSync(filePath, imageBuffer);
      return filePath;
    } catch (error) {
      logger.error('保存图片失败', error.message);
      return null;
    }
  }

  /**
   * 处理 Gateway 推送的消息（AI → 用户）
   * @param {object} payload - Gateway 消息负载
   * @param {string} [payload.from] - 目标用户微信 ID
   * @param {string} [payload.content] - 消息内容
   * @param {string} [payload.message] - 消息内容（备选字段）
   * @returns {Promise<void>}
   */
  async handleGatewayMessage(payload) {
    if (!payload || !payload.from) {
      return;
    }

    const from = payload.from;
    const content = payload.content || payload.message;

    if (!content) {
      return;
    }

    logger.info(`发送 AI 回复 to=${from}`);

    try {
      await this.wechat.sendTextMessage(from, content);
    } catch (error) {
      logger.error('发送消息失败', error.message);
    }
  }

  /**
   * 启动心跳检查和进程保活
   */
  keepAlive() {
    const heartbeat = async () => {
      if (!this.running) return;

      try {
        const gatewayStatus = this.gateway.getStatus();
        if (!gatewayStatus.connected) {
          logger.warn('Gateway 未连接，等待重连...');
        }

        const wechatStatus = this.wechat.getStatus();
        if (wechatStatus.loginState !== 1) {
          logger.warn('微信未登录');
        }
      } catch (error) {
        logger.error('心跳检查失败', error.message);
      }
    };

    const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

    // 优雅退出
    process.on('SIGINT', () => this.shutdown(interval));
    process.on('SIGTERM', () => this.shutdown(interval));

    process.on('uncaughtException', (error) => {
      logger.error('未捕获异常', error);
      this.shutdown(interval);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('未处理的 Promise 拒绝', reason);
    });
  }

  /**
   * 停止桥接器，断开所有连接
   */
  stop() {
    this.running = false;

    if (this.gateway) {
      this.gateway.disconnect();
    }

    if (this.wechat) {
      this.wechat.disconnectWebSocket();
    }

    logger.info('桥接器已停止');
  }

  /**
   * 优雅关闭桥接器并退出进程
   * @param {NodeJS.Timeout} interval - 心跳定时器
   */
  shutdown(interval) {
    logger.separator();
    logger.info('正在关闭...');
    clearInterval(interval);
    this.stop();
    process.exit(0);
  }
}

/**
 * 主入口函数
 * @returns {Promise<void>}
 */
async function main() {
  const bridge = new Bridge();

  try {
    await bridge.init();
    await bridge.start();
  } catch (error) {
    logger.error('启动失败', error.message);
    process.exit(1);
  }
}

// 启动
if (process.argv[1].endsWith('bridge.mjs')) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { Bridge };
