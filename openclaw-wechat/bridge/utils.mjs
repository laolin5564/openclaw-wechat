/**
 * 工具函数模块
 */

import { randomUUID } from 'node:crypto';

/**
 * 生成唯一 ID
 */
function generateId() {
  return randomUUID();
}

/**
 * 延迟执行
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步函数
 */
async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = 2,
    onRetry = null,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        const waitTime = delayMs * Math.pow(backoff, attempt - 1);

        if (onRetry) {
          onRetry(attempt, maxAttempts, error, waitTime);
        }

        await delay(waitTime);
      }
    }
  }

  throw lastError;
}

/**
 * 指数退避重连延迟
 */
async function backoffDelay(attempt, baseDelay = 1000, maxDelay = 30000) {
  const waitTime = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  await delay(waitTime);
  return waitTime;
}

/**
 * 清理微信 ID (移除 @chatroom 后缀等)
 */
function cleanWxId(wxid) {
  if (!wxid) return '';
  return wxid.replace(/@chatroom$/, '');
}

/**
 * 判断是否为群聊 ID
 */
function isChatRoom(wxid) {
  return wxid && wxid.endsWith('@chatroom');
}

/**
 * 解析微信消息内容
 */
function parseMessageContent(msg) {
  if (!msg) return null;

  const result = {
    type: 'text',
    content: '',
  };

  if (typeof msg === 'string') {
    result.content = msg;
    return result;
  }

  if (msg.content) {
    result.content = msg.content;
  }

  if (msg.msgType) {
    switch (msg.msgType) {
      case 1:
        result.type = 'text';
        break;
      case 3:
        result.type = 'image';
        break;
      case 34:
        result.type = 'voice';
        break;
      case 47:
        result.type = 'emoji';
        break;
      case 49:
        result.type = 'app';
        break;
      default:
        result.type = 'unknown';
    }
  }

  return result;
}

/**
 * 格式化持续时间
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天${hours % 24}时${minutes % 60}分`;
  }
  if (hours > 0) {
    return `${hours}时${minutes % 60}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds % 60}秒`;
  }
  return `${seconds}秒`;
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 检查是否为有效 JSON
 */
function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全地解析 JSON
 */
function safeJSONParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * URL 编码中文
 */
function encodeChinese(str) {
  return str.replace(/[\u4e00-\u9fa5]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * 截断文本
 */
function truncate(text, maxLength = 50, suffix = '...') {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 获取启动命令
 */
function getStartupCommand() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    return 'start.bat';
  }
  return './start.sh';
}

/**
 * 获取停止命令
 */
function getStopCommand() {
  const isWin = process.platform === 'win32';

  if (isWin) {
    return 'stop.bat';
  }
  return './stop.sh';
}

/**
 * 检查端口是否被占用
 */
async function isPortInUse(port, host = '127.0.0.1') {
  const net = await import('net');
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host);
  });
}

/**
 * 获取本机 IP 地址
 */
function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * 平台检测
 */
const platform = {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isProduction: process.env.NODE_ENV === 'production',
};

export {
  generateId,
  delay,
  retry,
  backoffDelay,
  cleanWxId,
  isChatRoom,
  parseMessageContent,
  formatDuration,
  formatTimestamp,
  isValidJSON,
  safeJSONParse,
  encodeChinese,
  truncate,
  getStartupCommand,
  getStopCommand,
  isPortInUse,
  getLocalIP,
  platform,
};
