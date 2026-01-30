/**
 * 日志模块
 */

import fs from 'fs';
import path from 'path';
import { getLogPaths, ensureDirs } from './config.mjs';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel = 1; // info
let logFile = null;
let consoleEnabled = true;

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * 格式化时间戳
 */
function timestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 格式化日志消息
 */
function formatMessage(level, message, data = null) {
  const levelStr = level.toUpperCase().padEnd(5);
  const msg = `${timestamp()} [${levelStr}] ${message}`;
  if (data) {
    return msg + ' ' + (typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  }
  return msg;
}

/**
 * 写入日志文件
 */
function writeToFile(message) {
  if (!logFile) {
    ensureDirs();
    const paths = getLogPaths();
    logFile = paths.out;
  }

  try {
    fs.appendFileSync(logFile, message + '\n', 'utf-8');
  } catch (error) {
    // 忽略写入错误
  }
}

/**
 * 输出到控制台
 */
function writeToConsole(level, color, message, data) {
  if (!consoleEnabled) return;

  const formatted = formatMessage(level, message, data);
  const colored = color + formatted + COLORS.reset;

  switch (level) {
    case 'error':
      console.error(colored);
      break;
    case 'warn':
      console.warn(colored);
      break;
    default:
      console.log(colored);
  }
}

/**
 * 设置日志级别
 */
function setLevel(level) {
  if (typeof level === 'string' && level in LOG_LEVELS) {
    currentLevel = LOG_LEVELS[level];
  }
}

/**
 * 启用/禁用控制台输出
 */
function setConsoleEnabled(enabled) {
  consoleEnabled = enabled;
}

/**
 * Debug 日志
 */
function debug(message, data) {
  if (currentLevel <= LOG_LEVELS.debug) {
    const formatted = formatMessage('debug', message, data);
    writeToFile(formatted);
    writeToConsole('debug', COLORS.dim, message, data);
  }
}

/**
 * Info 日志
 */
function info(message, data) {
  if (currentLevel <= LOG_LEVELS.info) {
    const formatted = formatMessage('info', message, data);
    writeToFile(formatted);
    writeToConsole('info', COLORS.green, message, data);
  }
}

/**
 * Warn 日志
 */
function warn(message, data) {
  if (currentLevel <= LOG_LEVELS.warn) {
    const formatted = formatMessage('warn', message, data);
    writeToFile(formatted);
    writeToConsole('warn', COLORS.yellow, message, data);
  }
}

/**
 * Error 日志
 */
function error(message, data) {
  if (currentLevel <= LOG_LEVELS.error) {
    const formatted = formatMessage('error', message, data);
    writeToFile(formatted);
    writeToConsole('error', COLORS.red, message, data);
  }
}

/**
 * 成功日志
 */
function success(message, data) {
  if (currentLevel <= LOG_LEVELS.info) {
    const formatted = formatMessage('info', message, data);
    writeToFile(formatted);
    writeToConsole('info', COLORS.cyan, message, data);
  }
}

/**
 * 分隔线
 */
function separator(char = '─', length = 50) {
  const line = char.repeat(length);
  writeToFile(line);
  if (consoleEnabled) {
    console.log(COLORS.dim + line + COLORS.reset);
  }
}

/**
 * 标题
 */
function title(text) {
  const padding = Math.max(0, 50 - text.length - 2);
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  const line = `█${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)}█`;
  writeToFile(line);
  if (consoleEnabled) {
    console.log(COLORS.cyan + line + COLORS.reset);
  }
}

export {
  setLevel,
  setConsoleEnabled,
  debug,
  info,
  warn,
  error,
  success,
  separator,
  title,
  LOG_LEVELS,
};
