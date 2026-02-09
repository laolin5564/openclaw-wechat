/**
 * 初始化配置脚本
 * 首次运行时设置配置
 */

import * as logger from './logger.mjs';
import { loadConfig, saveConfig, saveAuthKey, getPaths, ensureDirs } from './config.mjs';
import { createWechatService } from './wechat.mjs';
import { delay } from './utils.mjs';
import readline from 'node:readline';
import qrcode from 'qrcode-terminal';

/**
 * 创建命令行输入接口
 */
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 询问问题
 */
function question(rl, query) {
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * 确认问题
 */
async function confirm(rl, query, defaultValue = true) {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  const answer = await question(rl, query + suffix);

  if (answer === '') return defaultValue;
  return ['y', 'yes', 'Y', 'YES'].includes(answer.toLowerCase());
}

/**
 * 检查 OpenClaw Gateway
 */
async function checkGateway(url) {
  logger.info('检查 OpenClaw Gateway...');

  try {
    const { default: WebSocket } = await import('ws');

    return new Promise((resolve) => {
      const ws = new WebSocket(url, {
        handshakeTimeout: 5000,
      });

      ws.on('open', () => {
        logger.success('OpenClaw Gateway 连接成功');
        ws.close();
        resolve(true);
      });

      ws.on('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000);
    });
  } catch (error) {
    return false;
  }
}

/**
 * 检查微信服务
 */
async function checkWechatService(host, port) {
  logger.info('检查微信服务...');

  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(`http://${host}:${port}/login/GetLoginStatus`, {
      params: { key: 'test' },
      timeout: 5000,
    });

    logger.success('微信服务正在运行');
    return true;
  } catch (error) {
    logger.warn('微信服务未运行或无法连接');
    return false;
  }
}

/**
 * 初始化配置
 */
async function initConfig() {
  logger.title('OpenClaw 微信桥接器 - 初始化向导');
  logger.separator();

  const rl = createInterface();
  const config = loadConfig();

  // 1. 配置 OpenClaw Gateway
  logger.info('\n【步骤 1/4】配置 OpenClaw Gateway');
  logger.separator();

  const gatewayUrl = await question(rl, `Gateway 地址 [${config.gateway.url}]: `);
  if (gatewayUrl) {
    config.gateway.url = gatewayUrl;
  }

  const gatewayOk = await checkGateway(config.gateway.url);
  if (!gatewayOk) {
    logger.warn('无法连接到 OpenClaw Gateway');
    const continueAnyway = await confirm(rl, '是否继续？', false);
    if (!continueAnyway) {
      rl.close();
      logger.info('初始化已取消');
      process.exit(0);
    }
  }

  // 2. 配置微信服务
  logger.info('\n【步骤 2/4】配置微信服务');
  logger.separator();

  const wechatHost = await question(rl, `微信服务主机 [${config.wechatService.host}]: `);
  if (wechatHost) {
    config.wechatService.host = wechatHost;
  }

  const wechatPort = await question(rl, `微信服务端口 [${config.wechatService.port}]: `);
  if (wechatPort) {
    config.wechatService.port = parseInt(wechatPort, 10);
  }

  const wechatOk = await checkWechatService(config.wechatService.host, config.wechatService.port);
  if (!wechatOk) {
    logger.warn('微信服务未运行');
    logger.info('请先启动微信服务，然后重新运行初始化');
    rl.close();
    process.exit(1);
  }

  // 3. 生成授权码
  logger.info('\n【步骤 3/4】生成微信授权码');
  logger.separator();

  const wechatService = createWechatService({
    ...config.wechatService,
    adminKey: process.env.WECHAT_ADMIN_KEY || 'daidai',
  });

  try {
    logger.info('正在生成授权码 (有效期 365 天)...');
    const authKey = await wechatService.genAuthKey(1, 365);
    saveAuthKey(authKey);
    config.wechatService.authKey = authKey;
    logger.success('授权码已生成并保存');
  } catch (error) {
    logger.error('生成授权码失败', error.message);
    rl.close();
    process.exit(1);
  }

  // 4. 微信登录
  logger.info('\n【步骤 4/4】微信登录');
  logger.separator();

  logger.info('请使用微信扫描以下二维码登录:\n');

  wechatService.on('qrcode', (qrcodeUrl) => {
    // 从 URL 中提取实际的微信二维码链接
    const match = qrcodeUrl.match(/data=([^&]+)/);
    const wechatUrl = match ? decodeURIComponent(match[1]) : qrcodeUrl;

    // 在终端直接显示二维码
    qrcode.generate(wechatUrl, { small: true }, (qr) => {
      console.log(qr);
    });
    console.log(`\n链接: ${wechatUrl}\n`);
  });

  try {
    await wechatService.getLoginQrCode();

    logger.info('等待扫码登录...');
    await wechatService.waitForLogin();
    logger.success('微信登录成功');
  } catch (error) {
    logger.warn('登录超时，可以稍后启动时重新登录');
  }

  // 保存配置
  delete config._isFirstRun;
  saveConfig(config);

  // 显示配置摘要
  logger.separator();
  logger.title('配置完成');
  logger.separator();

  const paths = getPaths();
  logger.info(`配置文件: ${paths.configFile}`);
  logger.info(`授权码: *** (已保存)`);
  logger.info(`Gateway: ${config.gateway.url}`);
  logger.info(`微信服务: ${config.wechatService.host}:${config.wechatService.port}`);

  logger.separator();
  logger.info('启动服务:');
  logger.info('  npm run start');
  logger.info('  或');
  logger.info('  ./start.sh (Windows: start.bat)');
  logger.separator();

  rl.close();
}

/**
 * 主入口
 */
async function main() {
  try {
    ensureDirs();
    await initConfig();
  } catch (error) {
    logger.error('初始化失败', error.message);
    process.exit(1);
  }
}

// 启动
main();
