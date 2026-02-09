/**
 * @module logger
 * @description 日志模块，支持分级输出到控制台和文件
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLogPaths, ensureDirs } from './config.mjs';

// ── 常量定义 ─────────────────────────────────────────────

/**
 * 日志级别映射
 * @enum {number}
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 默认分隔线字符 */
const DEFAULT_SEPARATOR_CHAR = '─';

/** 默认分隔线长度 */
const DEFAULT_SEPARATOR_LENGTH = 50;

/** 级别字符串对齐宽度 */
const LEVEL_PAD_WIDTH = 5;

/** ANSI 颜色代码 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// ── 模块状态 ─────────────────────────────────────────────

/** @type {number} 当前日志级别 */
let currentLevel = LOG_LEVELS.info;

/** @type {string|null} 日志文件路径 */
let logFile = null;

/** @type {boolean} 是否启用控制台输出 */
let consoleEnabled = true;

// ── 内部函数 ─────────────────────────────────────────────

/**
 * 获取当前时间的 ISO 格式字符串（精确到秒）
 * @returns {string} 格式如 "2024-01-01 12:00:00"
 */
function timestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 格式化日志消息
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {*} [data=null] - 附加数据
 * @returns {string} 格式化后的消息
 */
function formatMessage(level, message, data = null) {
  const levelStr = level.toUpperCase().padEnd(LEVEL_PAD_WIDTH);
  const msg = `${timestamp()} [${levelStr}] ${message}`;
  if (data) {
    return msg + ' ' + (typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  }
  return msg;
}

/**
 * 写入日志文件（自动初始化文件路径）
 * @param {string} message - 格式化后的日志消息
 */
function writeToFile(message) {
  if (!logFile) {
    ensureDirs();
    const paths = getLogPaths();
    logFile = paths.out;
  }

  try {
    fs.appendFileSync(logFile, message + '\n', 'utf-8');
  } catch {
    // 忽略写入错误
  }
}

/**
 * 输出到控制台（带颜色）
 * @param {string} level - 日志级别
 * @param {string} color - ANSI 颜色代码
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
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

// ── 公共 API ─────────────────────────────────────────────

/**
 * 设置日志级别
 * @param {string} level - 级别名称：'debug' | 'info' | 'warn' | 'error'
 */
function setLevel(level) {
  if (typeof level === 'string' && level in LOG_LEVELS) {
    currentLevel = LOG_LEVELS[level];
  }
}

/**
 * 启用或禁用控制台输出
 * @param {boolean} enabled - 是否启用
 */
function setConsoleEnabled(enabled) {
  consoleEnabled = enabled;
}

/**
 * 输出 Debug 级别日志
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
 */
function debug(message, data) {
  if (currentLevel <= LOG_LEVELS.debug) {
    const formatted = formatMessage('debug', message, data);
    writeToFile(formatted);
    writeToConsole('debug', COLORS.dim, message, data);
  }
}

/**
 * 输出 Info 级别日志
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
 */
function info(message, data) {
  if (currentLevel <= LOG_LEVELS.info) {
    const formatted = formatMessage('info', message, data);
    writeToFile(formatted);
    writeToConsole('info', COLORS.green, message, data);
  }
}

/**
 * 输出 Warn 级别日志
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
 */
function warn(message, data) {
  if (currentLevel <= LOG_LEVELS.warn) {
    const formatted = formatMessage('warn', message, data);
    writeToFile(formatted);
    writeToConsole('warn', COLORS.yellow, message, data);
  }
}

/**
 * 输出 Error 级别日志
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
 */
function error(message, data) {
  if (currentLevel <= LOG_LEVELS.error) {
    const formatted = formatMessage('error', message, data);
    writeToFile(formatted);
    writeToConsole('error', COLORS.red, message, data);
  }
}

/**
 * 输出成功日志（Info 级别，青色高亮）
 * @param {string} message - 日志消息
 * @param {*} [data] - 附加数据
 */
function success(message, data) {
  if (currentLevel <= LOG_LEVELS.info) {
    const formatted = formatMessage('info', message, data);
    writeToFile(formatted);
    writeToConsole('info', COLORS.cyan, message, data);
  }
}

/**
 * 输出分隔线
 * @param {string} [char='─'] - 分隔字符
 * @param {number} [length=50] - 分隔线长度
 */
function separator(char = DEFAULT_SEPARATOR_CHAR, length = DEFAULT_SEPARATOR_LENGTH) {
  const line = char.repeat(length);
  writeToFile(line);
  if (consoleEnabled) {
    console.log(COLORS.dim + line + COLORS.reset);
  }
}

/**
 * 输出居中标题
 * @param {string} text - 标题文本
 */
function title(text) {
  const padding = Math.max(0, DEFAULT_SEPARATOR_LENGTH - text.length - 2);
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
