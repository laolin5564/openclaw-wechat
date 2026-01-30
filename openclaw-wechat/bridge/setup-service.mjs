/**
 * 系统服务配置脚本
 * 配置 launchd (macOS) 或 systemd (Linux) 服务
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { getPaths, ensureDirs } from './config.mjs';
import * as logger from './logger.mjs';
import { platform } from './utils.mjs';

const paths = getPaths();
const projectName = 'openclaw-wechat';
const serviceName = 'com.openclaw.wechat';

/**
 * 获取 Node.js 路径
 */
function getNodePath() {
  return process.execPath;
}

/**
 * 获取桥接器路径
 */
function getBridgePath() {
  return path.resolve(process.cwd(), 'bridge.mjs');
}

/**
 * 创建 launchd 配置 (macOS)
 */
function createLaunchdConfig() {
  const nodePath = getNodePath();
  const bridgePath = getBridgePath();
  const logOut = path.join(paths.logsDir, 'wechat-bridge.out.log');
  const logErr = path.join(paths.logsDir, 'wechat-bridge.err.log');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceName}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${bridgePath}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>WorkingDirectory</key>
  <string>${process.cwd()}</string>

  <key>StandardOutPath</key>
  <string>${logOut}</string>

  <key>StandardErrorPath</key>
  <string>${logErr}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;

  return plist;
}

/**
 * 安装 launchd 服务
 */
function installLaunchdService() {
  logger.title('配置 launchd 服务 (macOS)');
  logger.separator();

  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${serviceName}.plist`);
  const plist = createLaunchdConfig();

  try {
    // 写入 plist 文件
    fs.writeFileSync(plistPath, plist, 'utf-8');
    logger.success(`配置文件已创建: ${plistPath}`);

    // 加载服务
    try {
      execSync(`launchctl load ${plistPath}`, { stdio: 'inherit' });
      logger.success('服务已加载');
    } catch (error) {
      logger.warn('服务加载失败，请手动执行:');
      logger.info(`  launchctl load ${plistPath}`);
    }

    logger.separator();
    logger.info('服务命令:');
    logger.info(`  启动: launchctl start ${serviceName}`);
    logger.info(`  停止: launchctl stop ${serviceName}`);
    logger.info(`  卸载: launchctl unload ${plistPath}`);
    logger.separator();

  } catch (error) {
    logger.error('配置失败', error.message);
  }
}

/**
 * 创建 systemd 配置 (Linux)
 */
function createSystemdConfig() {
  const nodePath = getNodePath();
  const bridgePath = getBridgePath();
  const logOut = path.join(paths.logsDir, 'wechat-bridge.out.log');
  const logErr = path.join(paths.logsDir, 'wechat-bridge.err.log');

  const service = `[Unit]
Description=OpenClaw WeChat Bridge
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${bridgePath}
WorkingDirectory=${process.cwd()}
Restart=always
RestartSec=5
StandardOutput=append:${logOut}
StandardError=append:${logErr}
Environment=NODE_ENV=production
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;

  return service;
}

/**
 * 安装 systemd 服务
 */
function installSystemdService() {
  logger.title('配置 systemd 服务 (Linux)');
  logger.separator();

  const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', `${serviceName}.service`);
  const service = createSystemdConfig();

  try {
    // 确保目录存在
    const serviceDir = path.dirname(servicePath);
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }

    // 写入服务文件
    fs.writeFileSync(servicePath, service, 'utf-8');
    logger.success(`配置文件已创建: ${servicePath}`);

    // 重新加载 systemd
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
      logger.success('systemd 已重新加载');
    } catch (error) {
      logger.warn('systemd 重新加载失败');
    }

    // 启用服务
    try {
      execSync(`systemctl --user enable ${serviceName}`, { stdio: 'inherit' });
      logger.success('服务已启用');
    } catch (error) {
      logger.warn('服务启用失败，请手动执行:');
      logger.info(`  systemctl --user enable ${serviceName}`);
    }

    logger.separator();
    logger.info('服务命令:');
    logger.info(`  启动: systemctl --user start ${serviceName}`);
    logger.info(`  停止: systemctl --user stop ${serviceName}`);
    logger.info(`  状态: systemctl --user status ${serviceName}`);
    logger.separator();

  } catch (error) {
    logger.error('配置失败', error.message);
  }
}

/**
 * 创建 Windows 服务 (使用 NSSM)
 */
function installWindowsService() {
  logger.title('配置 Windows 服务');
  logger.separator();

  const nodePath = getNodePath();
  const bridgePath = getBridgePath();

  logger.warn('Windows 服务配置需要 NSSM (Non-Sucking Service Manager)');
  logger.info('1. 下载 NSSM: https://nssm.cc/download');
  logger.info('2. 安装后手动配置服务:');
  logger.info(`   nssm install ${serviceName} "${nodePath}" "${bridgePath}"`);
  logger.info(`   nssm start ${serviceName}`);
  logger.separator();
}

/**
 * 主入口
 */
async function main() {
  ensureDirs();

  logger.title('OpenClaw 微信桥接器 - 系统服务配置');
  logger.separator();
  logger.info('当前平台: ' + process.platform);
  logger.separator();

  if (platform.isMacOS) {
    installLaunchdService();
  } else if (platform.isLinux) {
    installSystemdService();
  } else if (platform.isWindows) {
    installWindowsService();
  } else {
    logger.error('不支持的平台');
    process.exit(1);
  }
}

// 启动
main();
