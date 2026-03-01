/**
 * @module config
 * @description 配置管理模块，负责配置文件、授权码、用户白名单和配对码的读写
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── 路径常量 ─────────────────────────────────────────────

/** OpenClaw 配置根目录 */
const CONFIG_DIR = path.join(os.homedir(), '.openclaw');

/** 微信桥接器配置文件路径 */
const CONFIG_FILE = path.join(CONFIG_DIR, 'openclaw-wechat.json');

/** 密钥目录 */
const SECRETS_DIR = path.join(CONFIG_DIR, 'secrets');

/** 微信授权码文件路径 */
const AUTH_KEY_FILE = path.join(SECRETS_DIR, 'wechat_auth_key');

/** 授权用户列表文件路径 */
const ALLOWED_USERS_FILE = path.join(SECRETS_DIR, 'wechat_allowed_users.json');

/** 配对码文件路径 */
const PAIRING_CODE_FILE = path.join(SECRETS_DIR, 'wechat_pairing_code');

/** 数据目录 */
const DATA_DIR = path.join(CONFIG_DIR, 'data');

/** 日志目录 */
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

/** 配对码长度 */
const PAIRING_CODE_LENGTH = 6;

/** 配对码截取起始位 */
const PAIRING_CODE_SLICE_START = 2;

/** 配对码截取结束位 */
const PAIRING_CODE_SLICE_END = 8;

/**
 * 默认配置
 * @type {object}
 */
const DEFAULT_CONFIG = {
  wechatService: {
    host: '127.0.0.1',
    port: 8099,
    autoStart: true,
    dataDir: DATA_DIR,
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

/**
 * 确保所有必需目录存在
 */
function ensureDirs() {
  for (const dir of [CONFIG_DIR, SECRETS_DIR, DATA_DIR, LOGS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 加载配置文件，不存在时返回默认配置
 * @returns {object} 配置对象，首次运行时包含 `_isFirstRun: true`
 */
function loadConfig() {
  ensureDirs();

  if (!fs.existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG, _isFirstRun: true };
  }

  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);
    return { ...DEFAULT_CONFIG, ...config, _isFirstRun: false };
  } catch {
    return { ...DEFAULT_CONFIG, _isFirstRun: true };
  }
}

/**
 * 保存配置到文件
 * @param {object} config - 配置对象（会自动移除 `_isFirstRun` 字段）
 */
function saveConfig(config) {
  ensureDirs();

  const { _isFirstRun, ...configToSave } = config;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf-8');
}

/**
 * 获取微信授权码
 * @returns {string|null} 授权码，文件不存在返回 null
 */
function getAuthKey() {
  if (fs.existsSync(AUTH_KEY_FILE)) {
    return fs.readFileSync(AUTH_KEY_FILE, 'utf-8').trim();
  }
  return null;
}

/**
 * 保存微信授权码
 * @param {string} authKey - 授权码
 */
function saveAuthKey(authKey) {
  ensureDirs();
  fs.writeFileSync(AUTH_KEY_FILE, authKey, 'utf-8');
}

/**
 * 获取日志文件路径
 * @returns {{ out: string, err: string, service: string }}
 */
function getLogPaths() {
  return {
    out: path.join(LOGS_DIR, 'wechat-bridge.out.log'),
    err: path.join(LOGS_DIR, 'wechat-bridge.err.log'),
    service: path.join(LOGS_DIR, 'wechat-service.log'),
  };
}

/**
 * 获取所有配置相关路径
 * @returns {{ configDir: string, configFile: string, secretsDir: string, authKeyFile: string, dataDir: string, logsDir: string }}
 */
function getPaths() {
  return {
    configDir: CONFIG_DIR,
    configFile: CONFIG_FILE,
    secretsDir: SECRETS_DIR,
    authKeyFile: AUTH_KEY_FILE,
    dataDir: DATA_DIR,
    logsDir: LOGS_DIR,
  };
}

/**
 * 获取已授权用户列表
 * @returns {Array<{ wxid: string, nickname: string, addedAt: string }>}
 */
function getAllowedUsers() {
  ensureDirs();
  if (fs.existsSync(ALLOWED_USERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ALLOWED_USERS_FILE, 'utf-8'));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 添加授权用户（已存在则跳过）
 * @param {string} wxid - 微信 ID
 * @param {string} [nickname=''] - 用户昵称
 * @returns {Array<{ wxid: string, nickname: string, addedAt: string }>} 更新后的用户列表
 */
function addAllowedUser(wxid, nickname = '') {
  ensureDirs();
  const users = getAllowedUsers();
  if (!users.find(u => u.wxid === wxid)) {
    users.push({ wxid, nickname, addedAt: new Date().toISOString() });
    fs.writeFileSync(ALLOWED_USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  }
  return users;
}

/**
 * 检查用户是否在白名单中
 * @param {string} wxid - 微信 ID
 * @returns {boolean}
 */
function isUserAllowed(wxid) {
  const users = getAllowedUsers();
  return users.some(u => u.wxid === wxid);
}

/**
 * 获取配对码（不存在时自动生成 6 位随机码）
 * @returns {string} 大写字母和数字组成的配对码
 */
function getPairingCode() {
  ensureDirs();
  if (fs.existsSync(PAIRING_CODE_FILE)) {
    return fs.readFileSync(PAIRING_CODE_FILE, 'utf-8').trim();
  }
  const code = Math.random().toString(36).substring(PAIRING_CODE_SLICE_START, PAIRING_CODE_SLICE_END).toUpperCase();
  fs.writeFileSync(PAIRING_CODE_FILE, code, 'utf-8');
  return code;
}

/**
 * 重新生成配对码
 * @returns {string} 新的配对码
 */
function regeneratePairingCode() {
  ensureDirs();
  const code = Math.random().toString(36).substring(PAIRING_CODE_SLICE_START, PAIRING_CODE_SLICE_END).toUpperCase();
  fs.writeFileSync(PAIRING_CODE_FILE, code, 'utf-8');
  return code;
}

export {
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  getAuthKey,
  saveAuthKey,
  getLogPaths,
  getPaths,
  ensureDirs,
  getAllowedUsers,
  addAllowedUser,
  isUserAllowed,
  getPairingCode,
  regeneratePairingCode,
};
