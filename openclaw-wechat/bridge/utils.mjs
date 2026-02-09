/**
 * @module utils
 * @description 通用工具函数模块
 */

import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';

// ── 常量定义 ─────────────────────────────────────────────

/** 默认重试次数 */
const DEFAULT_MAX_ATTEMPTS = 3;

/** 默认重试延迟（毫秒） */
const DEFAULT_RETRY_DELAY_MS = 1000;

/** 默认退避因子 */
const DEFAULT_BACKOFF_FACTOR = 2;

/** 默认退避基础延迟（毫秒） */
const DEFAULT_BACKOFF_BASE_DELAY_MS = 1000;

/** 最大退避延迟（毫秒） */
const DEFAULT_BACKOFF_MAX_DELAY_MS = 30000;

/** 默认截断长度 */
const DEFAULT_TRUNCATE_LENGTH = 50;

/** 默认截断后缀 */
const DEFAULT_TRUNCATE_SUFFIX = '...';

/** 时间单位（毫秒） */
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * 微信消息类型枚举
 * @enum {number}
 */
const WX_MSG_TYPE = {
  TEXT: 1,
  IMAGE: 3,
  VOICE: 34,
  EMOJI: 47,
  APP: 49,
};

/**
 * App 消息子类型枚举（msgType=49 时 XML 内的 <type>）
 * @enum {string}
 */
const WX_APP_SUB_TYPE = {
  FILE: '6',
};

// ── 通用工具 ─────────────────────────────────────────────

/**
 * 生成唯一 ID（UUID v4）
 * @returns {string} UUID 字符串
 */
function generateId() {
  return randomUUID();
}

/**
 * 延迟指定毫秒数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的异步函数执行器
 * @param {() => Promise<*>} fn - 需要重试的异步函数
 * @param {object} [options] - 重试选项
 * @param {number} [options.maxAttempts=3] - 最大尝试次数
 * @param {number} [options.delayMs=1000] - 初始延迟毫秒数
 * @param {number} [options.backoff=2] - 退避因子
 * @param {((attempt: number, maxAttempts: number, error: Error, waitTime: number) => void)|null} [options.onRetry=null] - 重试回调
 * @returns {Promise<*>} 函数执行结果
 * @throws {Error} 超过最大重试次数后抛出最后一次错误
 */
async function retry(fn, options = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    delayMs = DEFAULT_RETRY_DELAY_MS,
    backoff = DEFAULT_BACKOFF_FACTOR,
    onRetry = null,
    shouldRetry = null, // 可选：(error) => boolean，返回 false 则不重试直接抛出
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 如果提供了 shouldRetry 且判定不应重试，直接抛出
      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

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
 * @param {number} attempt - 当前重试次数
 * @param {number} [baseDelay=1000] - 基础延迟毫秒数
 * @param {number} [maxDelay=30000] - 最大延迟毫秒数
 * @returns {Promise<number>} 实际等待的毫秒数
 */
async function backoffDelay(attempt, baseDelay = DEFAULT_BACKOFF_BASE_DELAY_MS, maxDelay = DEFAULT_BACKOFF_MAX_DELAY_MS) {
  const waitTime = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  await delay(waitTime);
  return waitTime;
}

// ── 微信相关工具 ─────────────────────────────────────────

/**
 * 清理微信 ID（移除 @chatroom 后缀等）
 * @param {string} wxid - 微信 ID
 * @returns {string} 清理后的 ID
 */
function cleanWxId(wxid) {
  if (!wxid) return '';
  return wxid.replace(/@chatroom$/, '');
}

/**
 * 判断是否为群聊 ID
 * @param {string} wxid - 微信 ID
 * @returns {boolean}
 */
function isChatRoom(wxid) {
  return wxid && wxid.endsWith('@chatroom');
}

/**
 * 判断消息是否为文件类型（App 消息中 type=6）
 * @param {object} message - 消息对象
 * @param {number} [message.msgType] - 微信消息类型
 * @param {string} [message.content] - 消息内容（XML）
 * @returns {boolean}
 */
function isFileMessage(message) {
  if (!message) return false;
  if (message.msgType !== WX_MSG_TYPE.APP) return false;
  const content = message.content || message.rawContent || '';
  const typeMatch = content.match(/<type>(\d+)<\/type>/);
  return typeMatch !== null && typeMatch[1] === WX_APP_SUB_TYPE.FILE;
}

/**
 * 判断消息是否为图片类型
 * @param {object} message - 消息对象
 * @param {number} [message.msgType] - 微信消息类型
 * @returns {boolean}
 */
function isImageMessage(message) {
  return message && message.msgType === WX_MSG_TYPE.IMAGE;
}

/**
 * 判断消息是否为语音类型
 * @param {object} message - 消息对象
 * @param {number} [message.msgType] - 微信消息类型
 * @returns {boolean}
 */
function isVoiceMessage(message) {
  return message && message.msgType === WX_MSG_TYPE.VOICE;
}

/**
 * 解析微信消息内容，提取类型和内容
 * @param {object|string} msg - 原始消息对象或字符串
 * @param {string} [msg.content] - 消息文本内容
 * @param {number} [msg.msgType] - 消息类型码
 * @returns {{ type: string, content: string, imageInfo: object|null } | null}
 */
function parseMessageContent(msg) {
  if (!msg) return null;

  const result = {
    type: 'text',
    content: '',
    imageInfo: null,
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
      case WX_MSG_TYPE.TEXT:
        result.type = 'text';
        break;
      case WX_MSG_TYPE.IMAGE:
        result.type = 'image';
        result.imageInfo = parseImageXml(msg.content);
        break;
      case WX_MSG_TYPE.VOICE:
        result.type = 'voice';
        break;
      case WX_MSG_TYPE.EMOJI:
        result.type = 'emoji';
        break;
      case WX_MSG_TYPE.APP:
        result.type = 'app';
        break;
      default:
        result.type = 'unknown';
    }
  }

  return result;
}

/**
 * 解析图片消息 XML，提取 CDN 地址和元数据
 * @param {string} xmlContent - 图片消息的 XML 内容
 * @returns {{ aeskey: string|null, cdnthumburl: string|null, cdnthumblength: number, cdnmidimgurl: string|null, cdnbigimgurl: string|null, length: number, hdlength: number, md5: string|null } | null}
 */
function parseImageXml(xmlContent) {
  if (!xmlContent || typeof xmlContent !== 'string') return null;

  try {
    const imgMatch = xmlContent.match(/<img([^>]+)>/);
    if (!imgMatch) return null;

    const attrs = imgMatch[1];

    /**
     * 从属性字符串中提取指定属性值
     * @param {string} name - 属性名
     * @returns {string|null}
     */
    const getAttr = (name) => {
      const match = attrs.match(new RegExp(`${name}="([^"]+)"`));
      return match ? match[1] : null;
    };

    return {
      aeskey: getAttr('aeskey'),
      cdnthumburl: getAttr('cdnthumburl'),
      cdnthumblength: parseInt(getAttr('cdnthumblength') || '0', 10),
      cdnmidimgurl: getAttr('cdnmidimgurl'),
      cdnbigimgurl: getAttr('cdnbigimgurl'),
      length: parseInt(getAttr('length') || '0', 10),
      hdlength: parseInt(getAttr('hdlength') || '0', 10),
      md5: getAttr('md5'),
    };
  } catch {
    return null;
  }
}

/**
 * 从 App 消息 XML 中提取文件名（<title> 标签）
 * @param {string} xmlContent - App 消息的 XML 内容
 * @returns {string|null} 文件名，提取失败返回 null
 */
function extractFileNameFromXml(xmlContent) {
  if (!xmlContent || typeof xmlContent !== 'string') return null;
  const match =
    xmlContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
    xmlContent.match(/<title>(.*?)<\/title>/);
  return match ? match[1] : null;
}

// ── 格式化工具 ───────────────────────────────────────────

/**
 * 格式化持续时间为中文可读字符串
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的字符串，如 "1天2时3分4秒"
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);

  if (days > 0) {
    return `${days}天${hours % HOURS_PER_DAY}时${minutes % MINUTES_PER_HOUR}分`;
  }
  if (hours > 0) {
    return `${hours}时${minutes % MINUTES_PER_HOUR}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds % SECONDS_PER_MINUTE}秒`;
  }
  return `${seconds}秒`;
}

/**
 * 格式化 Unix 时间戳为中文日期时间字符串
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string} 格式化后的字符串
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp * MS_PER_SECOND);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── JSON 工具 ────────────────────────────────────────────

/**
 * 检查字符串是否为有效 JSON
 * @param {string} str - 待检查的字符串
 * @returns {boolean}
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
 * 安全地解析 JSON，失败时返回默认值
 * @param {string} str - 待解析的 JSON 字符串
 * @param {*} [defaultValue=null] - 解析失败时的默认值
 * @returns {*} 解析结果或默认值
 */
function safeJSONParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

// ── 字符串工具 ───────────────────────────────────────────

/**
 * URL 编码中文字符
 * @param {string} str - 包含中文的字符串
 * @returns {string} 编码后的字符串
 */
function encodeChinese(str) {
  return str.replace(/[\u4e00-\u9fa5]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * 截断文本到指定长度
 * @param {string} text - 待截断的文本
 * @param {number} [maxLength=50] - 最大长度
 * @param {string} [suffix='...'] - 截断后缀
 * @returns {string} 截断后的文本
 */
function truncate(text, maxLength = DEFAULT_TRUNCATE_LENGTH, suffix = DEFAULT_TRUNCATE_SUFFIX) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

// ── 平台与系统工具 ───────────────────────────────────────

/**
 * 获取启动命令（根据平台）
 * @returns {string} 启动命令
 */
function getStartupCommand() {
  if (process.platform === 'win32') {
    return 'start.bat';
  }
  return './start.sh';
}

/**
 * 获取停止命令（根据平台）
 * @returns {string} 停止命令
 */
function getStopCommand() {
  if (process.platform === 'win32') {
    return 'stop.bat';
  }
  return './stop.sh';
}

/**
 * 检查端口是否被占用
 * @param {number} port - 端口号
 * @param {string} [host='127.0.0.1'] - 主机地址
 * @returns {Promise<boolean>} 端口被占用返回 true
 */
async function isPortInUse(port, host = '127.0.0.1') {
  const net = await import('node:net');
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
 * 获取本机局域网 IP 地址
 * @returns {string} IPv4 地址，获取失败返回 '127.0.0.1'
 */
function getLocalIP() {
  const nets = networkInterfaces();
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
 * 平台检测标志
 * @type {{ isWindows: boolean, isMacOS: boolean, isLinux: boolean, isProduction: boolean }}
 */
const platform = {
  isWindows: process.platform === 'win32',
  isMacOS: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  isProduction: process.env.NODE_ENV === 'production',
};

export {
  // 常量
  WX_MSG_TYPE,
  WX_APP_SUB_TYPE,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_MAX_DELAY_MS,
  MS_PER_SECOND,
  // 通用工具
  generateId,
  delay,
  retry,
  backoffDelay,
  // 微信工具
  cleanWxId,
  isChatRoom,
  isFileMessage,
  isImageMessage,
  isVoiceMessage,
  parseMessageContent,
  parseImageXml,
  extractFileNameFromXml,
  // 格式化
  formatDuration,
  formatTimestamp,
  // JSON
  isValidJSON,
  safeJSONParse,
  // 字符串
  encodeChinese,
  truncate,
  // 平台
  getStartupCommand,
  getStopCommand,
  isPortInUse,
  getLocalIP,
  platform,
};
