/**
 * @module wechat
 * @description 微信 iPad 协议服务通信模块，封装 HTTP API 和 WebSocket 消息接收
 */

import axios from 'axios';
import WebSocket from 'ws';
import { randomUUID as uuidv4 } from 'node:crypto';
import { delay, backoffDelay, isChatRoom, isFileMessage, parseMessageContent, WX_MSG_TYPE, WX_APP_SUB_TYPE } from './utils.mjs';
import * as logger from './logger.mjs';

// ── 常量定义 ─────────────────────────────────────────────

/** HTTP 请求默认超时（毫秒） */
const HTTP_TIMEOUT_MS = 30000;

/** 文件下载超时（毫秒） */
const FILE_DOWNLOAD_TIMEOUT_MS = 60000;

/** WebSocket 握手超时（毫秒） */
const WS_HANDSHAKE_TIMEOUT_MS = 10000;

/** 默认轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** 默认登录等待超时（毫秒） */
const DEFAULT_LOGIN_TIMEOUT_MS = 120000;

/** 图片分片下载大小（字节） */
const IMAGE_CHUNK_SIZE = 65536;

/** 视频文件大小警告阈值（字节，20MB） */
const VIDEO_SIZE_WARNING_BYTES = 20 * 1024 * 1024;

/** 微信 API 成功状态码 */
const WX_API_SUCCESS_CODE = 200;

/** 微信 API 响应成功 ret 值 */
const WX_API_RET_SUCCESS = 0;

/** 默认微信服务端口 */
const DEFAULT_WX_PORT = 8099;

/** 默认管理密钥 */
const DEFAULT_ADMIN_KEY = 'daidai';

/** 重连基础延迟（毫秒） */
const RECONNECT_BASE_DELAY_MS = 2000;

/** 重连最大延迟（毫秒） */
const RECONNECT_MAX_DELAY_MS = 30000;

/**
 * 微信消息发送 MsgType 映射
 * @enum {number}
 */
const SEND_MSG_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  VIDEO: 4,
  FILE: 6,
};

/**
 * 支持的语音文件格式
 * @type {string[]}
 */
const SUPPORTED_VOICE_FORMATS = ['silk', 'amr', 'slk'];

/**
 * 微信服务 API 客户端
 * 封装微信 iPad 协议服务的 HTTP 接口和 WebSocket 消息推送
 */
class WechatService {
  /**
   * @param {object} config - 服务配置
   * @param {string} [config.host='127.0.0.1'] - 微信服务主机地址
   * @param {number} [config.port=8099] - 微信服务端口
   * @param {string} [config.authKey=''] - 授权码
   * @param {string} [config.adminKey='daidai'] - 管理密钥
   */
  constructor(config) {
    this.host = config.host || '127.0.0.1';
    this.port = config.port || DEFAULT_WX_PORT;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.authKey = config.authKey || '';
    this.adminKey = config.adminKey || DEFAULT_ADMIN_KEY;

    /** @type {WebSocket|null} */
    this.ws = null;
    this.wsConnected = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;

    // 事件回调
    /** @type {((msg: object) => void)|null} */
    this.onMessage = null;
    /** @type {((url: string) => void)|null} */
    this.onQrCode = null;
    /** @type {((data: object) => void)|null} */
    this.onLoginSuccess = null;
    /** @type {(() => void)|null} */
    this.onLoginExpired = null;
    /** @type {((error: Error) => void)|null} */
    this.onError = null;

    // 状态
    /** @type {number} 登录状态：0=未登录，1=已登录 */
    this.loginState = 0;
    /** @type {object|null} 当前登录用户信息 */
    this.currentUser = null;

    /** @type {import('axios').AxiosInstance} */
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: HTTP_TIMEOUT_MS,
    });
  }

  /**
   * 设置授权码
   * @param {string} authKey - 新的授权码
   */
  setAuthKey(authKey) {
    this.authKey = authKey;
  }

  /**
   * 获取 API 请求公共 URL 参数
   * @returns {{ key: string }}
   */
  getUrlParams() {
    return { key: this.authKey };
  }

  // ── 登录相关 ───────────────────────────────────────────

  /**
   * 生成授权码
   * @param {number} [count=1] - 生成数量
   * @param {number} [days=365] - 有效天数
   * @returns {Promise<string>} 授权码
   * @throws {Error} 生成失败
   */
  async genAuthKey(count = 1, days = 365) {
    try {
      const response = await this.http.post('/admin/GenAuthKey1', {
        count,
        days,
      }, {
        params: { key: this.adminKey },
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        return response.data.Data[0];
      }

      throw new Error(response.data.Text || '生成授权码失败');
    } catch (error) {
      logger.error('生成授权码失败', error.message);
      throw error;
    }
  }

  /**
   * 唤醒登录（免扫码二次登录）
   * @returns {Promise<boolean>} 是否唤醒成功
   */
  async wakeUpLogin() {
    try {
      logger.info('尝试唤醒登录...');
      const response = await this.http.post('/login/WakeUpLogin', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        logger.success('唤醒登录成功');
        return true;
      }

      logger.warn('唤醒登录失败:', response.data.Text || '未知原因');
      return false;
    } catch (error) {
      logger.warn('唤醒登录失败', error.message);
      return false;
    }
  }

  /**
   * 获取登录二维码
   * @returns {Promise<object>} 二维码数据
   * @throws {Error} 获取失败
   */
  async getLoginQrCode() {
    try {
      const response = await this.http.post('/login/GetLoginQrCodeNew', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const data = response.data.Data;
        let qrcodeUrl = data.QrCodeUrl || '';

        // 如果是二维码生成服务的 URL，提取实际的微信链接
        if (qrcodeUrl.includes('data=')) {
          try {
            const url = new URL(qrcodeUrl);
            const actualUrl = url.searchParams.get('data');
            if (actualUrl) {
              qrcodeUrl = actualUrl;
            }
          } catch {
            // URL 解析失败，使用原始值
          }
        }

        if (this.onQrCode && qrcodeUrl) {
          this.onQrCode(qrcodeUrl);
        }
        return data;
      }

      throw new Error(response.data.Text || '获取二维码失败');
    } catch (error) {
      logger.error('获取登录二维码失败', error.message);
      throw error;
    }
  }

  /**
   * 检查微信登录状态
   * @returns {Promise<{ loginState: number, loginTime?: string, onlineTime?: string }>}
   */
  async getLoginStatus() {
    try {
      const response = await this.http.get('/login/GetLoginStatus', {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const data = response.data.Data;
        this.loginState = data.loginState || 0;

        if (this.loginState === 1 && !this.currentUser) {
          this.currentUser = { loginTime: data.loginTime };
          if (this.onLoginSuccess) {
            this.onLoginSuccess(data);
          }
        }

        return data;
      }

      return { loginState: 0 };
    } catch (error) {
      logger.error('检查登录状态失败', error.message);
      return { loginState: 0 };
    }
  }

  /**
   * 等待登录完成（轮询）
   * @param {number} [interval=2000] - 轮询间隔（毫秒）
   * @param {number} [timeout=120000] - 超时时间（毫秒）
   * @returns {Promise<boolean>} 登录成功返回 true
   * @throws {Error} 超时
   */
  async waitForLogin(interval = DEFAULT_POLL_INTERVAL_MS, timeout = DEFAULT_LOGIN_TIMEOUT_MS) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.getLoginStatus();

      if (status.loginState === 1) {
        logger.success('微信登录成功');
        return true;
      }

      await delay(interval);
    }

    throw new Error('等待登录超时');
  }

  // ── 联系人相关 ─────────────────────────────────────────

  /**
   * 获取联系人列表
   * @returns {Promise<string[]>} 联系人用户名列表
   * @throws {Error} 获取失败
   */
  async getContactList() {
    try {
      const response = await this.http.post('/friend/GetContactList', {}, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        return response.data.Data?.ContactList?.contactUsernameList || [];
      }

      throw new Error(response.data.Text || '获取联系人列表失败');
    } catch (error) {
      logger.error('获取联系人列表失败', error.message);
      throw error;
    }
  }

  /**
   * 获取联系人详细信息
   * @param {string[]} userNames - 用户名列表
   * @returns {Promise<object[]>} 联系人详情数组
   * @throws {Error} 获取失败
   */
  async getContactDetails(userNames) {
    try {
      const response = await this.http.post('/friend/GetContactDetailsList', {
        UserNames: userNames,
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        return response.data.Data?.contactList || [];
      }

      throw new Error(response.data.Text || '获取联系人详情失败');
    } catch (error) {
      logger.error('获取联系人详情失败', error.message);
      throw error;
    }
  }

  /**
   * 搜索联系人
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<object[]>} 搜索结果
   */
  async searchContact(keyword) {
    try {
      const response = await this.http.post('/friend/SearchContact', {
        keyword,
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        return response.data.Data || [];
      }

      return [];
    } catch (error) {
      logger.error('搜索联系人失败', error.message);
      return [];
    }
  }

  // ── 消息发送 ───────────────────────────────────────────

  /**
   * 发送文本消息
   * @param {string} toUser - 接收者微信 ID
   * @param {string} content - 消息内容
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendTextMessage(toUser, content) {
    try {
      const response = await this.http.post('/message/SendTextMessage', {
        MsgItem: [
          {
            ToUserName: toUser,
            MsgType: SEND_MSG_TYPE.TEXT,
            Content: content,
            TextContent: content,
          },
        ],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const results = response.data.Data || [];
        return results[0]?.isSendSuccess || false;
      }

      return false;
    } catch (error) {
      logger.error('发送文本消息失败', error.message);
      return false;
    }
  }

  /**
   * 发送图片消息
   * @param {string} toUser - 接收者微信 ID
   * @param {string} imagePath - 图片文件路径
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendImageMessage(toUser, imagePath) {
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync(imagePath)) {
        logger.error('图片文件不存在', imagePath);
        return false;
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const imageBase64 = imageBuffer.toString('base64');

      logger.info(`发送图片 to=${toUser} size=${imageBuffer.length} bytes`);

      const response = await this.http.post('/message/SendImageNewMessage', {
        MsgItem: [
          {
            ToUserName: toUser,
            MsgType: SEND_MSG_TYPE.IMAGE,
            ImageContent: imageBase64,
          },
        ],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const result = (response.data.Data || [])[0];
        if (result?.resp?.baseResponse?.ret === WX_API_RET_SUCCESS) {
          return true;
        }
        if (result?.isSendSuccess) {
          return true;
        }
        logger.warn('发送图片返回', JSON.stringify(result));
        return false;
      }

      logger.error('发送图片响应', response.data);
      return false;
    } catch (error) {
      logger.error('发送图片消息失败', error.message);
      return false;
    }
  }

  /**
   * 发送文件消息（优先尝试 SendFileMessage，失败后回退到 SendAppMessage）
   * @param {string} toUser - 接收者微信 ID
   * @param {string} filePath - 文件路径
   * @param {string} [fileName] - 文件名，默认从路径提取
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendFileMessage(toUser, filePath, fileName) {
    try {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');

      if (!fs.existsSync(filePath)) {
        logger.error('文件不存在', filePath);
        return false;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const fileBase64 = fileBuffer.toString('base64');
      const fileSize = fileBuffer.length;
      const resolvedFileName = fileName || pathMod.basename(filePath);

      logger.info(`发送文件 to=${toUser} name=${resolvedFileName} size=${fileSize} bytes`);

      const msgItem = {
        ToUserName: toUser,
        MsgType: SEND_MSG_TYPE.FILE,
        FileContent: fileBase64,
        FileName: resolvedFileName,
        FileSize: fileSize,
      };

      // 尝试 SendFileMessage 接口
      try {
        const response = await this.http.post('/message/SendFileMessage', {
          MsgItem: [msgItem],
        }, {
          params: this.getUrlParams(),
        });

        if (response.data.Code === WX_API_SUCCESS_CODE) {
          const result = (response.data.Data || [])[0];
          if (result?.resp?.baseResponse?.ret === WX_API_RET_SUCCESS || result?.isSendSuccess) {
            logger.success(`文件发送成功 (SendFileMessage) name=${resolvedFileName}`);
            return true;
          }
          logger.warn('SendFileMessage 返回', JSON.stringify(result));
        }
      } catch (err) {
        logger.warn('SendFileMessage 接口失败，尝试 SendAppMessage', err.message);
      }

      // 回退到 SendAppMessage 接口
      const response = await this.http.post('/message/SendAppMessage', {
        MsgItem: [msgItem],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const result = (response.data.Data || [])[0];
        if (result?.resp?.baseResponse?.ret === WX_API_RET_SUCCESS || result?.isSendSuccess) {
          logger.success(`文件发送成功 (SendAppMessage) name=${resolvedFileName}`);
          return true;
        }
        logger.warn('SendAppMessage 返回', JSON.stringify(result));
        return false;
      }

      logger.error('发送文件响应', response.data);
      return false;
    } catch (error) {
      logger.error('发送文件消息失败', error.message);
      return false;
    }
  }

  /**
   * 发送视频消息
   * @param {string} toUser - 接收者微信 ID
   * @param {string} videoPath - 视频文件路径
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendVideoMessage(toUser, videoPath) {
    try {
      const fs = await import('node:fs');

      if (!fs.existsSync(videoPath)) {
        logger.error('视频文件不存在', videoPath);
        return false;
      }

      const videoBuffer = fs.readFileSync(videoPath);
      const videoBase64 = videoBuffer.toString('base64');

      if (videoBuffer.length > VIDEO_SIZE_WARNING_BYTES) {
        logger.warn(`视频文件较大 (${Math.round(videoBuffer.length / 1024 / 1024)}MB)，可能发送失败或超时`);
      }

      logger.info(`发送视频 to=${toUser} size=${videoBuffer.length} bytes`);

      const response = await this.http.post('/message/SendVideoMessage', {
        MsgItem: [
          {
            ToUserName: toUser,
            MsgType: SEND_MSG_TYPE.VIDEO,
            VideoContent: videoBase64,
          },
        ],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const result = (response.data.Data || [])[0];
        if (result?.resp?.baseResponse?.ret === WX_API_RET_SUCCESS || result?.isSendSuccess) {
          logger.success('视频发送成功');
          return true;
        }
        logger.warn('发送视频返回', JSON.stringify(result));
        return false;
      }

      logger.error('发送视频响应', response.data);
      return false;
    } catch (error) {
      logger.error('发送视频消息失败', error.message);
      return false;
    }
  }

  /**
   * 发送语音消息
   * @param {string} toUser - 接收者微信 ID
   * @param {string} voicePath - 语音文件路径（建议 silk/amr 格式）
   * @param {number} [voiceDurationMs=0] - 语音时长（毫秒），0 表示未知
   * @returns {Promise<boolean>} 是否发送成功
   */
  async sendVoiceMessage(toUser, voicePath, voiceDurationMs = 0) {
    try {
      const fs = await import('node:fs');

      if (!fs.existsSync(voicePath)) {
        logger.error('语音文件不存在', voicePath);
        return false;
      }

      const voiceBuffer = fs.readFileSync(voicePath);
      const voiceBase64 = voiceBuffer.toString('base64');

      // 检查文件格式
      const ext = voicePath.split('.').pop()?.toLowerCase();
      if (ext && !SUPPORTED_VOICE_FORMATS.includes(ext)) {
        logger.warn(`语音格式可能不被支持: .${ext}，微信通常要求 silk/amr 格式`);
      }

      logger.info(`发送语音 to=${toUser} size=${voiceBuffer.length} bytes duration=${voiceDurationMs}ms`);

      const response = await this.http.post('/message/SendVoiceMessage', {
        MsgItem: [
          {
            ToUserName: toUser,
            MsgType: SEND_MSG_TYPE.VOICE,
            VoiceContent: voiceBase64,
            VoiceLength: voiceDurationMs,
          },
        ],
      }, {
        params: this.getUrlParams(),
      });

      if (response.data.Code === WX_API_SUCCESS_CODE) {
        const result = (response.data.Data || [])[0];
        if (result?.resp?.baseResponse?.ret === WX_API_RET_SUCCESS || result?.isSendSuccess) {
          logger.success('语音发送成功');
          return true;
        }
        logger.warn('发送语音返回', JSON.stringify(result));
        return false;
      }

      logger.error('发送语音响应', response.data);
      return false;
    } catch (error) {
      logger.error('发送语音消息失败', error.message);
      return false;
    }
  }

  /**
   * 撤回消息
   * @param {number} msgId - 消息 ID
   * @param {string} toUser - 接收者微信 ID
   * @returns {Promise<boolean>} 是否撤回成功
   */
  async revokeMessage(msgId, toUser) {
    try {
      const response = await this.http.post('/message/RevokeMsg', {
        MsgId: msgId,
        ToUserName: toUser,
      }, {
        params: this.getUrlParams(),
      });

      return response.data.Code === WX_API_SUCCESS_CODE;
    } catch (error) {
      logger.error('撤回消息失败', error.message);
      return false;
    }
  }

  // ── 媒体下载 ───────────────────────────────────────────

  /**
   * 下载图片（分片下载）
   * @param {object} params - 下载参数
   * @param {number} params.msgId - 消息 ID
   * @param {number} params.totalLen - 图片总大小（字节）
   * @param {string} params.fromUser - 发送者微信 ID
   * @param {string} params.toUser - 接收者微信 ID
   * @returns {Promise<Buffer|null>} 图片数据，下载失败返回 null
   */
  async downloadImage(params) {
    const { msgId, totalLen, fromUser, toUser } = params;

    if (!msgId || !totalLen) {
      logger.warn('下载图片缺少必要参数');
      return null;
    }

    try {
      logger.info(`开始下载图片 msgId=${msgId} size=${totalLen}`);

      const chunks = [];
      let startPos = 0;

      while (startPos < totalLen) {
        const response = await this.http.post('/message/GetMsgBigImg', {
          MsgId: msgId,
          TotalLen: totalLen,
          Section: { StartPos: startPos },
          ToUserName: toUser,
          FromUserName: fromUser,
          CompressType: 0,
        }, {
          params: this.getUrlParams(),
        });

        if (response.data.Code !== WX_API_SUCCESS_CODE) {
          logger.error('下载图片分片失败', response.data.Text);
          return null;
        }

        const data = response.data.Data;
        if (data && data.Data && data.Data.iLen > 0) {
          const chunkData = Buffer.from(data.Data.buffer || '', 'base64');
          chunks.push(chunkData);
          startPos = data.StartPos + data.DataLen;
          logger.debug(`下载进度: ${startPos}/${totalLen}`);
        } else {
          break;
        }
      }

      if (chunks.length > 0) {
        const imageBuffer = Buffer.concat(chunks);
        logger.success(`图片下载完成 size=${imageBuffer.length}`);
        return imageBuffer;
      }

      return null;
    } catch (error) {
      logger.error('下载图片失败', error.message);
      return null;
    }
  }

  /**
   * 下载文件（App 消息附件，支持分片）
   * @param {object} message - 消息对象
   * @param {string} [message.rawContent] - 原始 XML 内容
   * @param {string} [message.content] - 消息内容
   * @param {number} [message.msgId] - 消息 ID
   * @param {string} [message.from] - 发送者
   * @param {string} [message.to] - 接收者
   * @returns {Promise<{ buffer: Buffer, fileName: string }|null>} 文件数据和文件名，失败返回 null
   */
  async downloadFile(message) {
    try {
      const content = message.rawContent || message.content || '';

      // 从 XML 中提取文件元数据
      const titleMatch = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || content.match(/<title>(.*?)<\/title>/);
      const fileName = titleMatch ? titleMatch[1] : null;
      const attachIdMatch = content.match(/<attachid><!\[CDATA\[(.*?)\]\]><\/attachid>/) || content.match(/<attachid>(.*?)<\/attachid>/);
      const attachId = attachIdMatch ? attachIdMatch[1] : null;
      const totalLenMatch = content.match(/<totallen>(\d+)<\/totallen>/);
      const totalLen = totalLenMatch ? parseInt(totalLenMatch[1], 10) : 0;
      const cdnUrlMatch = content.match(/<cdnattachurl><!\[CDATA\[(.*?)\]\]><\/cdnattachurl>/) || content.match(/<cdnattachurl>(.*?)<\/cdnattachurl>/);
      const cdnUrl = cdnUrlMatch ? cdnUrlMatch[1] : null;

      if (!attachId && !cdnUrl) {
        logger.warn('文件消息缺少 attachId 和 cdnUrl，无法下载');
        return null;
      }

      logger.info(`下载文件: name=${fileName} attachId=${attachId} size=${totalLen}`);

      const downloadParams = {
        AttachId: attachId,
        MsgId: message.msgId,
        TotalLen: totalLen,
        FromUserName: message.from,
        ToUserName: message.to,
        CdnUrl: cdnUrl,
      };

      // 尝试一次性下载
      try {
        const response = await this.http.post('/message/DownloadAttach', {
          ...downloadParams,
          Section: { StartPos: 0 },
        }, {
          params: this.getUrlParams(),
          timeout: FILE_DOWNLOAD_TIMEOUT_MS,
        });

        if (response.data.Code === WX_API_SUCCESS_CODE && response.data.Data) {
          const data = response.data.Data;
          const bufferData = data.Data?.buffer || data.buffer || data.data;
          if (bufferData) {
            const fileBuffer = Buffer.from(bufferData, 'base64');
            logger.success(`文件下载完成: ${fileName} size=${fileBuffer.length}`);
            return { buffer: fileBuffer, fileName };
          }
        }
      } catch (err) {
        logger.warn('DownloadAttach 一次性下载失败', err.message);
      }

      // 回退到分片下载
      try {
        const chunks = [];
        let startPos = 0;

        while (startPos < totalLen) {
          const response = await this.http.post('/message/DownloadAttach', {
            ...downloadParams,
            Section: { StartPos: startPos },
          }, {
            params: this.getUrlParams(),
            timeout: FILE_DOWNLOAD_TIMEOUT_MS,
          });

          if (response.data.Code !== WX_API_SUCCESS_CODE) break;

          const data = response.data.Data;
          if (data && data.Data && data.Data.iLen > 0) {
            const chunkData = Buffer.from(data.Data.buffer || '', 'base64');
            chunks.push(chunkData);
            startPos = (data.StartPos || startPos) + (data.DataLen || chunkData.length);
          } else {
            break;
          }
        }

        if (chunks.length > 0) {
          const fileBuffer = Buffer.concat(chunks);
          logger.success(`文件分片下载完成: ${fileName} size=${fileBuffer.length}`);
          return { buffer: fileBuffer, fileName };
        }
      } catch (err) {
        logger.warn('分片下载文件失败', err.message);
      }

      logger.error('所有文件下载方式均失败');
      return null;
    } catch (error) {
      logger.error('下载文件失败', error.message);
      return null;
    }
  }

  // ── WebSocket 消息接收 ─────────────────────────────────

  /**
   * 连接 WebSocket 接收实时消息推送
   */
  connectWebSocket() {
    const wsUrl = `ws://${this.host}:${this.port}/ws/GetSyncMsg?key=${this.authKey}`;

    logger.info(`连接微信服务 WebSocket: ${wsUrl}`);

    this.ws = new WebSocket(wsUrl, {
      handshakeTimeout: WS_HANDSHAKE_TIMEOUT_MS,
    });

    this.ws.on('open', () => {
      logger.success('微信服务 WebSocket 已连接');
      this.wsConnected = true;
      this.reconnectAttempts = 0;
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWsMessage(message);
      } catch (error) {
        logger.error('解析微信消息失败', error.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`微信服务 WebSocket 连接关闭: ${code}`);
      this.wsConnected = false;

      if (this.shouldReconnect) {
        this.scheduleWsReconnect();
      }
    });

    this.ws.on('error', (error) => {
      logger.error('微信服务 WebSocket 错误', error.message);

      if (this.onError) {
        this.onError(error);
      }
    });
  }

  /**
   * 处理 WebSocket 推送的消息，解析并分发
   * @param {object} message - 原始微信消息对象
   */
  handleWsMessage(message) {
    logger.info(`收到微信消息 from=${message.from_user_name?.str || 'unknown'} content=${message.content?.str || ''}`);

    if (message && message.from_user_name && message.to_user_name) {
      const fromUser = message.from_user_name.str || '';
      const toUser = message.to_user_name.str || '';
      const content = message.content?.str || '';

      const parsed = parseMessageContent({
        content,
        msgType: message.msg_type,
      });

      if (this.onMessage && content) {
        const msgObj = {
          from: fromUser,
          to: toUser,
          content: parsed.content,
          rawContent: content,
          type: parsed.type,
          msgType: message.msg_type,
          timestamp: message.create_time || Date.now(),
          msgId: message.msg_id,
        };

        // 对 App 消息 (msgType 49) 提取文件名和类型
        if (message.msg_type === WX_MSG_TYPE.APP) {
          const titleMatch = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || content.match(/<title>(.*?)<\/title>/);
          if (titleMatch) {
            msgObj.fileName = titleMatch[1];
          }
          // type=6 表示文件
          const typeMatch = content.match(/<type>(\d+)<\/type>/);
          if (typeMatch && typeMatch[1] === WX_APP_SUB_TYPE.FILE) {
            msgObj.type = 'file';
          }
        }

        this.onMessage(msgObj);
      }
    }
  }

  /**
   * 安排 WebSocket 自动重连
   * @returns {Promise<void>}
   */
  async scheduleWsReconnect() {
    if (!this.shouldReconnect) return;

    this.reconnectAttempts++;
    const delayTime = await backoffDelay(this.reconnectAttempts, RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS);

    logger.info(`准备重连微信服务... (尝试 ${this.reconnectAttempts})，等待 ${Math.round(delayTime / 1000)} 秒`);

    setTimeout(() => {
      this.connectWebSocket();
    }, delayTime);
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnectWebSocket() {
    this.shouldReconnect = false;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.wsConnected = false;
  }

  /**
   * 注册事件回调
   * @param {'message'|'qrcode'|'loginSuccess'|'loginExpired'|'error'} event - 事件名
   * @param {Function} callback - 回调函数
   */
  on(event, callback) {
    switch (event) {
      case 'message':
        this.onMessage = callback;
        break;
      case 'qrcode':
        this.onQrCode = callback;
        break;
      case 'loginSuccess':
        this.onLoginSuccess = callback;
        break;
      case 'loginExpired':
        this.onLoginExpired = callback;
        break;
      case 'error':
        this.onError = callback;
        break;
    }
  }

  /**
   * 获取当前服务状态
   * @returns {{ loginState: number, wsConnected: boolean, hasAuthKey: boolean }}
   */
  getStatus() {
    return {
      loginState: this.loginState,
      wsConnected: this.wsConnected,
      hasAuthKey: !!this.authKey,
    };
  }
}

/**
 * 创建微信服务实例（工厂函数）
 * @param {object} config - 服务配置
 * @returns {WechatService}
 */
function createWechatService(config) {
  return new WechatService(config);
}

export {
  WechatService,
  createWechatService,
};
