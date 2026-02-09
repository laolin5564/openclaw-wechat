/**
 * 文件发送功能测试脚本
 * 运行: node test-file-feature.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Helpers ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
  }
}

// ── Import targets ───────────────────────────────────────

// Bridge is a class; we need an instance to call extractImagePaths / extractFilePaths.
// They rely on fs.existsSync, so we create temp files to make matches succeed.

import { Bridge } from './bridge.mjs';
import { WechatService } from './wechat.mjs';

const bridge = new Bridge();

// ── 1. extractFilePaths ──────────────────────────────────

console.log('\n📂 extractFilePaths 测试');

// Create temp files for path detection
// 必须用 /tmp/ 前缀，因为 extractFilePaths/extractImagePaths 的正则只匹配 /Users/ 和 /tmp/
const tmpDir = fs.mkdtempSync('/tmp/wechat-test-');
const tmpPdf = path.join(tmpDir, 'report.pdf');
const tmpZip = path.join(tmpDir, 'archive.zip');
const tmpDoc = path.join(tmpDir, 'notes.docx');
const tmpMp4 = path.join(tmpDir, 'video.mp4');
const tmpMp3 = path.join(tmpDir, 'audio.mp3');
fs.writeFileSync(tmpPdf, 'fake-pdf');
fs.writeFileSync(tmpZip, 'fake-zip');
fs.writeFileSync(tmpDoc, 'fake-doc');
fs.writeFileSync(tmpMp4, 'fake-mp4');
fs.writeFileSync(tmpMp3, 'fake-mp3');

test('提取 /tmp 下的 pdf 文件路径', () => {
  const r = bridge.extractFilePaths(`请查看文件 ${tmpPdf} 里面的内容`);
  assert.equal(r.length, 1);
  assert.equal(r[0], tmpPdf);
});

test('提取多个文件路径', () => {
  const r = bridge.extractFilePaths(`文件1: ${tmpPdf} 文件2: ${tmpZip}`);
  assert.equal(r.length, 2);
});

test('提取 docx 路径 (已修复: docx 放在 doc 前面)', () => {
  const r = bridge.extractFilePaths(`打开 ${tmpDoc}`);
  assert.equal(r.length, 1, 'docx 应能正确提取');
});

test('提取 mp4 视频路径', () => {
  const r = bridge.extractFilePaths(`视频在 ${tmpMp4}`);
  assert.equal(r.length, 1);
});

test('提取 mp3 音频路径', () => {
  const r = bridge.extractFilePaths(`音频在 ${tmpMp3}`);
  assert.equal(r.length, 1);
});

test('没有文件路径时返回空数组', () => {
  const r = bridge.extractFilePaths('今天天气不错');
  assert.equal(r.length, 0);
});

test('不存在的文件路径不返回', () => {
  const r = bridge.extractFilePaths('/tmp/nonexistent_12345.pdf');
  assert.equal(r.length, 0);
});

test('去重：相同路径只返回一次', () => {
  const r = bridge.extractFilePaths(`${tmpPdf} and again ${tmpPdf}`);
  assert.equal(r.length, 1);
});

// ── 2. extractImagePaths ─────────────────────────────────

console.log('\n🖼️  extractImagePaths 测试');

const tmpJpg = path.join(tmpDir, 'photo.jpg');
const tmpPng = path.join(tmpDir, 'screenshot.png');
fs.writeFileSync(tmpJpg, 'fake-jpg');
fs.writeFileSync(tmpPng, 'fake-png');

test('提取 jpg 路径', () => {
  const r = bridge.extractImagePaths(`看这张图 ${tmpJpg}`);
  assert.equal(r.length, 1);
  assert.equal(r[0], tmpJpg);
});

test('提取 png 路径', () => {
  const r = bridge.extractImagePaths(`截图 ${tmpPng}`);
  assert.equal(r.length, 1);
});

test('不提取 pdf 等非图片文件', () => {
  const r = bridge.extractImagePaths(`文件 ${tmpPdf}`);
  assert.equal(r.length, 0);
});

test('没有图片路径时返回空数组', () => {
  const r = bridge.extractImagePaths('纯文本消息');
  assert.equal(r.length, 0);
});

// ── 3. WechatService 方法存在性和签名 ────────────────────

console.log('\n🔌 WechatService 方法签名测试');

const ws = new WechatService({ host: '127.0.0.1', port: 8099 });

test('sendFileMessage 方法存在', () => {
  assert.equal(typeof ws.sendFileMessage, 'function');
});

test('sendFileMessage 接受 3 个参数 (toUser, filePath, fileName)', () => {
  assert.equal(ws.sendFileMessage.length, 3);
});

test('sendVideoMessage 方法存在', () => {
  assert.equal(typeof ws.sendVideoMessage, 'function');
});

test('sendVideoMessage 接受 2 个参数 (toUser, videoPath)', () => {
  assert.equal(ws.sendVideoMessage.length, 2);
});

test('sendVoiceMessage 方法存在', () => {
  assert.equal(typeof ws.sendVoiceMessage, 'function');
});

test('sendVoiceMessage 接受 2 个参数 (toUser, voicePath)', () => {
  assert.equal(ws.sendVoiceMessage.length, 2);
});

test('sendImageMessage 方法存在（原有功能）', () => {
  assert.equal(typeof ws.sendImageMessage, 'function');
});

test('sendTextMessage 方法存在（原有功能）', () => {
  assert.equal(typeof ws.sendTextMessage, 'function');
});

// ── 4. 文件读取和 base64 编码 ────────────────────────────

console.log('\n📦 文件读取与 base64 编码测试');

const testContent = 'Hello, 微信文件发送测试! 🎉';
const testFile = path.join(tmpDir, 'test-encode.txt');
fs.writeFileSync(testFile, testContent);

test('读取文件并 base64 编码/解码', () => {
  const buf = fs.readFileSync(testFile);
  const b64 = buf.toString('base64');
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  assert.equal(decoded, testContent);
});

test('二进制文件 base64 往返', () => {
  const binFile = path.join(tmpDir, 'test-bin.dat');
  const binData = Buffer.from([0x00, 0xFF, 0x80, 0x7F, 0x01, 0xFE]);
  fs.writeFileSync(binFile, binData);
  const b64 = fs.readFileSync(binFile).toString('base64');
  const restored = Buffer.from(b64, 'base64');
  assert.deepEqual(restored, binData);
});

test('空文件 base64 编码', () => {
  const emptyFile = path.join(tmpDir, 'empty.txt');
  fs.writeFileSync(emptyFile, '');
  const b64 = fs.readFileSync(emptyFile).toString('base64');
  assert.equal(b64, '');
});

// ── 5. Bridge extractFilePaths 与 extractImagePaths 不冲突 ─

console.log('\n🔀 路径提取互不干扰测试');

test('图片路径不会被 extractFilePaths 提取', () => {
  const r = bridge.extractFilePaths(`图片在 ${tmpJpg}`);
  assert.equal(r.length, 0);
});

test('文件路径不会被 extractImagePaths 提取', () => {
  const r = bridge.extractImagePaths(`文件在 ${tmpPdf}`);
  assert.equal(r.length, 0);
});

test('混合路径各自正确提取', () => {
  const text = `图片 ${tmpJpg} 和文件 ${tmpPdf}`;
  const images = bridge.extractImagePaths(text);
  const files = bridge.extractFilePaths(text);
  assert.equal(images.length, 1);
  assert.equal(files.length, 1);
  assert.equal(images[0], tmpJpg);
  assert.equal(files[0], tmpPdf);
});

// ── Cleanup & Summary ────────────────────────────────────

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\n' + '─'.repeat(40));
console.log(`总计: ${passed + failed} | ✅ 通过: ${passed} | ❌ 失败: ${failed}`);

if (failed > 0) {
  console.log('\n⚠️  有测试失败！');
  process.exit(1);
} else {
  console.log('\n🎉 全部测试通过！');
}
