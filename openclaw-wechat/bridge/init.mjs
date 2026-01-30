/**
 * 快速初始化脚本 - 非交互式
 */

import { saveConfig, saveAuthKey, ensureDirs } from './config.mjs';
import { createWechatService } from './wechat.mjs';
import * as logger from './logger.mjs';

async function quickInit() {
  logger.title('OpenClaw 微信桥接器 - 快速初始化');
  logger.separator();

  ensureDirs();

  // 默认配置
  const config = {
    wechatService: {
      host: '127.0.0.1',
      port: 8099,
      autoStart: true,
    },
    gateway: {
      url: 'ws://127.0.0.1:18789',
      token: '',
    },
    behavior: {
      thinkingDelay: 2500,
      thinkingMessage: '⏳ AI 正在处理…',
      autoReconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
    },
    logging: {
      level: 'info',
      maxFiles: 7,
      maxSize: '10M',
    },
    bridge: {
      name: 'wechat',
      version: '1.0.0',
    },
  };

  // 检查微信服务
  logger.info('检查微信服务 (127.0.0.1:8099)...');
  const wechat = createWechatService({
    ...config.wechatService,
    adminKey: 'daidai',
  });

  let authKey;
  try {
    logger.info('正在生成授权码...');
    authKey = await wechat.genAuthKey(1, 365);
    saveAuthKey(authKey);
    logger.success(`授权码已生成: ${authKey}`);
  } catch (error) {
    logger.error('生成授权码失败', error.message);

    // 使用默认授权码
    authKey = 'HBe6xqD0LJIf';
    saveAuthKey(authKey);
    logger.info(`使用默认授权码: ${authKey}`);
  }

  config.wechatService.authKey = authKey;

  // 保存配置
  saveConfig(config);

  logger.separator();
  logger.success('配置完成!');
  logger.info('');
  logger.info('启动服务: ./scripts/start.sh');
  logger.separator();
}

quickInit().catch(console.error);
