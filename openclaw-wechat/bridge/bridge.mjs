/**
 * OpenClaw 微信桥接器
 * 连接微信 iPad 协议服务和 OpenClaw Gateway
 */

import { loadConfig, saveConfig, getAuthKey, saveAuthKey, getAllowedUsers, addAllowedUser, isUserAllowed, getPairingCode } from './config.mjs';
import * as logger from './logger.mjs';
import { delay } from './utils.mjs';
import { randomBytes } from 'node:crypto';
import { GatewayConnection } from './gateway.mjs';
import { WechatService } from './wechat.mjs';
import qrcode from 'qrcode-terminal';

// 版本信息
const VERSION = '1.0.0';
const NAME = 'openclaw-wechat-bridge';

/**
 * 桥接器主类
 */
class Bridge {
  constructor() {
    this.config = null;
    this.gateway = null;
    this.wechat = null;
    this.running = false;
    this.pendingMessages = new Map();
    this.thinkingTimeouts = new Map();
  }

  /**
   * 初始化
   */
  async init() {
    // 加载配置
    this.config = loadConfig();

    // 设置日志级别
    logger.setLevel(this.config.logging.level);

    logger.title('OpenClaw 微信桥接器');
    logger.info(`版本: ${VERSION}`);

    // 首次运行检查
    if (this.config._isFirstRun) {
      logger.warn('检测到首次运行，请先运行: npm run setup');
      logger.info('或者手动配置 ~/.openclaw/openclaw-wechat.json');
      process.exit(1);
    }

    // 检查授权码
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
   * 生成并保存授权码
   */
  async genAndSaveAuthKey() {
    const wechat = new WechatService({
      ...this.config.wechatService,
      adminKey: 'daidai',
    });

    try {
      logger.info('正在生成授权码...');
      const authKey = await wechat.genAuthKey(1, 365);
      saveAuthKey(authKey);
      logger.success(`授权码已生成: ${authKey}`);
      return authKey;
    } catch (error) {
      logger.error('生成授权码失败', error.message);
      throw error;
    }
  }

  /**
   * 启动
   */
  async start() {
    if (this.running) {
      logger.warn('桥接器已在运行中');
      return;
    }

    this.running = true;
    logger.separator();

    try {
      // 1. 检查并启动微信服务
      await this.checkAndStartWechatService();

      // 2. 检查登录状态
      await this.checkLoginStatus();

      // 3. 连接 OpenClaw Gateway
      await this.connectGateway();

      // 4. 启动微信消息监听
      this.startWechatListener();

      // 5. 准备就绪
      logger.separator();
      logger.success('🦞 微信助手已上线');
      logger.info('等待消息中...');
      logger.separator();

      // 保持运行
      this.keepAlive();

    } catch (error) {
      logger.error('启动失败', error.message);
      this.stop();
      throw error;
    }
  }

  /**
   * 检查并启动微信服务
   */
  async checkAndStartWechatService() {
    logger.info('检查微信服务状态...');

    this.wechat = new WechatService({
      ...this.config.wechatService,
      authKey: this.config.wechatService.authKey || getAuthKey(),
    });

    // 检查服务是否运行
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
   * 检查登录状态
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

    // 未登录，先尝试唤醒登录（免扫码）
    logger.warn('微信未登录，尝试唤醒登录...');
    const wakeUpSuccess = await this.wechat.wakeUpLogin();

    if (wakeUpSuccess) {
      // 唤醒登录成功，等待登录完成
      await this.wechat.waitForLogin();
      return;
    }

    // 唤醒登录失败，显示二维码
    logger.warn('唤醒登录失败，正在获取二维码...');

    this.wechat.on('qrcode', (qrcodeUrl) => {
      logger.separator();
      logger.info('请使用微信扫描以下二维码登录:');
      // 在终端显示二维码
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
   * 连接 OpenClaw Gateway
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

    // 设置事件处理
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
   * 启动微信消息监听
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
   * 处理微信消息（用户 → AI）
   */
  async handleWechatMessage(message) {
    logger.info(`收到消息 from=${message.from} type=${message.type}`);
    logger.debug('消息内容', message.content);

    const wxid = message.from;
    const content = message.content?.trim() || '';

    // 检查用户是否已授权
    if (!isUserAllowed(wxid)) {
      const pairingCode = getPairingCode();
      
      // 检查是否是配对码
      if (content.toUpperCase() === pairingCode) {
        // 配对成功
        addAllowedUser(wxid, '');
        logger.success(`用户 ${wxid} 配对成功`);
        await this.wechat.sendTextMessage(wxid, '✅ 配对成功！现在可以开始对话了。');
        return;
      }
      
      // 未授权且不是配对码，静默忽略
      logger.info(`未授权用户 ${wxid} 消息已忽略`);
      return;
    }

    try {
      // 发送到 Gateway (使用 agent 方法)
      // 使用 main agent，sessionKey 格式包含 agent id
      const response = await this.gateway.callAgent({
        message: message.content,
        agentId: 'main',
        sessionKey: `agent:main:wechat:${message.from}`,
        deliver: false,
      });

      // 发送 AI 回复
      if (response && response.text) {
        const replyText = response.text.trim();
        logger.info(`AI 回复: ${replyText.substring(0, 50)}...`);
        await this.wechat.sendTextMessage(message.from, replyText);
      }

    } catch (error) {
      logger.error('处理消息失败', error);
      logger.error('错误堆栈', error.stack);

      // 发送错误提示
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
   * 处理 Gateway 消息（AI → 用户）
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
   * 保持运行
   */
  keepAlive() {
    const heartbeatInterval = 30000; // 30秒

    const heartbeat = async () => {
      if (!this.running) return;

      try {
        // 检查 Gateway 状态
        const gatewayStatus = this.gateway.getStatus();
        if (!gatewayStatus.connected) {
          logger.warn('Gateway 未连接，等待重连...');
        }

        // 检查微信服务状态
        const wechatStatus = this.wechat.getStatus();
        if (wechatStatus.loginState !== 1) {
          logger.warn('微信未登录');
        }

      } catch (error) {
        logger.error('心跳检查失败', error.message);
      }
    };

    // 定时心跳
    const interval = setInterval(heartbeat, heartbeatInterval);

    // 优雅退出
    process.on('SIGINT', () => this.shutdown(interval));
    process.on('SIGTERM', () => this.shutdown(interval));

    // 未捕获异常处理
    process.on('uncaughtException', (error) => {
      logger.error('未捕获异常', error);
      this.shutdown(interval);
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('未处理的 Promise 拒绝', reason);
    });
  }

  /**
   * 停止
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
   * 优雅退出
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
 * 主入口
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
