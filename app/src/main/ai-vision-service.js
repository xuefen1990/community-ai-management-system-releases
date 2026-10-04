'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MIME_TYPES = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp' });
const text = value => value == null ? '' : String(value).trim();

class AiVisionService {
  constructor({ aiRouter } = {}) {
    if (!aiRouter?.onlineChat || !aiRouter?.getOnlineCapabilities) throw new TypeError('aiRouter is required');
    this.aiRouter = aiRouter;
  }

  async describe({ entry, confirmed = false, instruction = '' } = {}) {
    if (confirmed !== true) throw new Error('发送图片给在线视觉模型前，请先确认本次用途');
    const capabilities = await this.aiRouter.getOnlineCapabilities();
    if (!capabilities.supportsVision) return { status: 'ocr-only', provider: 'local',
      message: '后端当前没有启用视觉模型，已保留原图查看和 OCR 文字核对功能。', description: '' };
    const extension = path.extname(text(entry.archivePath)).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) throw new Error('当前图片格式不能发送给视觉模型');
    const stats = await fs.stat(entry.archivePath);
    if (!stats.isFile() || stats.size > 12 * 1024 * 1024) throw new Error('视觉理解仅支持不超过 12 MB 的普通图片');
    const base64 = (await fs.readFile(entry.archivePath)).toString('base64');
    const prompt = text(instruction) || '请用中文说明这张材料的类型、版面结构、表格关系、勾选项、印章和签字位置。不要猜测看不清的文字，无法确认的内容请明确说明。';
    const response = await this.aiRouter.onlineChat([{ role: 'user', content: [
      { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
    ] }], { taskTier: 'deep', taskKind: 'vision-document-review', maxTokens: 1800 });
    return { status: 'completed', provider: response.provider, model: response.model, usage: response.usage,
      description: text(response.content), message: '图片版面理解已完成，请继续对照原图人工核对。' };
  }
}

module.exports = { AiVisionService, MIME_TYPES };
