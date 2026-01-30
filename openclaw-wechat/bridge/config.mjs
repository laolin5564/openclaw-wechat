/**
 * 配置管理模块
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'openclaw-wechat.json');
const SECRETS_DIR = path.join(CONFIG_DIR, 'secrets');
const AUTH_KEY_FILE = path.join(SECRETS_DIR, 'wechat_auth_key');
const ALLOWED_USERS_FILE = path.join(SECRETS_DIR, 'wechat_allowed_users.json');
const PAIRING_CODE_FILE = path.join(SECRETS_DIR, 'wechat_pairing_code');
const DATA_DIR = path.join(CONFIG_DIR, 'data');
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 微信服务配置
  wechatService: {
    host: '127.0.0.1',
    port: 8099,
    autoStart: true,
    dataDir: DATA_DIR,
  },

  // OpenClaw Gateway 配置
  gateway: {
    url: 'ws://127.0.0.1:18789',
    token: '',
  },

  // 行为配置
  behavior: {
    thinkingDelay: 2500,
    thinkingMessage: '⏳ AI 正在处理…',
    autoReconnect: true,
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
  },

  // 日志配置
  logging: {
    level: 'info',
    maxFiles: 7,
    maxSize: '10M',
  },

  // 桥接器配置
  bridge: {
    name: 'wechat',
    version: '1.0.0',
  },
};

/**
 * 确保目录存在
 */
function ensureDirs() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * 加载配置
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
  } catch (error) {
    return { ...DEFAULT_CONFIG, _isFirstRun: true };
  }
}

/**
 * 保存配置
 */
function saveConfig(config) {
  ensureDirs();

  const { _isFirstRun, ...configToSave } = config;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf-8');
}

/**
 * 获取授权码
 */
function getAuthKey() {
  if (fs.existsSync(AUTH_KEY_FILE)) {
    return fs.readFileSync(AUTH_KEY_FILE, 'utf-8').trim();
  }
  return null;
}

/**
 * 保存授权码
 */
function saveAuthKey(authKey) {
  ensureDirs();
  fs.writeFileSync(AUTH_KEY_FILE, authKey, 'utf-8');
}

/**
 * 获取日志路径
 */
function getLogPaths() {
  return {
    out: path.join(LOGS_DIR, 'wechat-bridge.out.log'),
    err: path.join(LOGS_DIR, 'wechat-bridge.err.log'),
    service: path.join(LOGS_DIR, 'wechat-service.log'),
  };
}

/**
 * 获取配置文件路径
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
 */
function getAllowedUsers() {
  ensureDirs();
  if (fs.existsSync(ALLOWED_USERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ALLOWED_USERS_FILE, 'utf-8'));
    } catch (e) {
      return [];
    }
  }
  return [];
}

/**
 * 添加授权用户
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
 * 检查用户是否已授权
 */
function isUserAllowed(wxid) {
  const users = getAllowedUsers();
  return users.some(u => u.wxid === wxid);
}

/**
 * 获取配对码（如果不存在则生成）
 */
function getPairingCode() {
  ensureDirs();
  if (fs.existsSync(PAIRING_CODE_FILE)) {
    return fs.readFileSync(PAIRING_CODE_FILE, 'utf-8').trim();
  }
  // 生成6位随机配对码
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  fs.writeFileSync(PAIRING_CODE_FILE, code, 'utf-8');
  return code;
}

/**
 * 重新生成配对码
 */
function regeneratePairingCode() {
  ensureDirs();
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
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
