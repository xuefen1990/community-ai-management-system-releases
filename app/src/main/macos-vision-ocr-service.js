'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const executeFile = promisify(execFile);

class MacosVisionOcrService {
  constructor({ platform = process.platform, isPackaged = false, resourcesPath = process.resourcesPath || '', userDataPath = '',
    sourcePath = path.resolve(__dirname, '..', 'native', 'macos-vision-ocr.swift'), execute = executeFile } = {}) {
    this.platform = platform;
    this.isPackaged = isPackaged;
    this.resourcesPath = resourcesPath;
    this.userDataPath = userDataPath;
    this.sourcePath = sourcePath;
    this.execute = execute;
    this.executablePromise = null;
  }

  async isNewer(source, target) {
    try {
      const [sourceStat, targetStat] = await Promise.all([fs.stat(source), fs.stat(target)]);
      return targetStat.mtimeMs >= sourceStat.mtimeMs;
    } catch {
      return false;
    }
  }

  async resolveExecutable() {
    if (this.platform !== 'darwin') throw new Error('当前系统暂不支持离线图片文字识别，请在 Mac 上核对原文件');
    if (this.isPackaged) {
      const bundled = path.join(this.resourcesPath, 'community-vision-ocr');
      await fs.access(bundled);
      return bundled;
    }
    const outputDirectory = path.join(this.userDataPath, 'ai-ocr');
    const executable = path.join(outputDirectory, 'community-vision-ocr');
    if (await this.isNewer(this.sourcePath, executable)) return executable;
    await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${executable}.${process.pid}.tmp`;
    try {
      await this.execute('/usr/bin/xcrun', [
        'swiftc', this.sourcePath, '-o', temporary, '-target', `${process.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`,
        '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'PDFKit', '-framework', 'Vision',
      ], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
      await fs.chmod(temporary, 0o700);
      await fs.rename(temporary, executable);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return executable;
  }

  async recognize(filePath, { maximumPages = 30 } = {}) {
    if (!this.executablePromise) this.executablePromise = this.resolveExecutable();
    let executable;
    try {
      executable = await this.executablePromise;
    } catch (error) {
      this.executablePromise = null;
      throw error;
    }
    const { stdout } = await this.execute(executable, [path.resolve(filePath), String(maximumPages)], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.pages)) throw new Error('文字识别结果格式不正确');
    return result;
  }
}

module.exports = { MacosVisionOcrService };
