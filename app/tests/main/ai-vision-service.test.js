'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AiVisionService } = require('../../src/main/ai-vision-service');

async function imageFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-vision-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, '材料.png');
  await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return filePath;
}

test('图片发给在线模型前必须得到本次明确确认', async t => {
  const filePath = await imageFixture(t);
  const service = new AiVisionService({ aiRouter: { onlineChat() {}, getOnlineCapabilities() {} } });
  await assert.rejects(() => service.describe({ entry: { archivePath: filePath } }), /请先确认本次用途/u);
});

test('后端未启用视觉模型时保留原图与离线文字核对', async t => {
  const filePath = await imageFixture(t);
  let onlineCalls = 0;
  const service = new AiVisionService({ aiRouter: {
    getOnlineCapabilities: async () => ({ supportsVision: false }),
    onlineChat: async () => { onlineCalls += 1; },
  } });
  const result = await service.describe({ entry: { archivePath: filePath }, confirmed: true });
  assert.equal(result.status, 'ocr-only');
  assert.equal(onlineCalls, 0);
});

test('视觉模型只收到确认后的安全图片副本与中文说明', async t => {
  const filePath = await imageFixture(t);
  let request = null;
  const service = new AiVisionService({ aiRouter: {
    getOnlineCapabilities: async () => ({ supportsVision: true, visionModel: 'vision-pro' }),
    onlineChat: async (messages, options) => {
      request = { messages, options };
      return { content: '这是一张证明材料，右下角有印章。', provider: 'online', model: 'vision-pro', usage: { total_tokens: 32 } };
    },
  } });
  const result = await service.describe({ entry: { archivePath: filePath }, confirmed: true, instruction: '说明版面' });
  assert.equal(result.status, 'completed');
  assert.match(request.messages[0].content[1].image_url.url, /^data:image\/png;base64,/u);
  assert.equal(request.options.taskKind, 'vision-document-review');
  assert.match(result.description, /证明材料/u);
});
