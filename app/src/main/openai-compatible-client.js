'use strict';

function extractVisibleText(value) {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    return '';
  }).join('').trim();
}

class OpenAiCompatibleClient {
  constructor({ fetchImplementation = globalThis.fetch, timeoutMs = 30_000 } = {}) {
    this.fetchImplementation = fetchImplementation;
    this.timeoutMs = timeoutMs;
  }

  async chat({ baseUrl, apiKey, model, messages, temperature = 0.2 }) {
    if (!baseUrl || !model) throw new Error('请先填写在线 AI 接口地址和模型名称');
    if (!apiKey) throw new Error('请先填写在线 AI API 密钥');
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('消息内容不能为空');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(`${baseUrl.replace(/\/+$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature, stream: false }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || `在线 AI 请求失败（${response.status}）`);
      if (body.error?.message) throw new Error(body.error.message);
      const choice = body.choices?.[0];
      const content = extractVisibleText(choice?.message?.content) || extractVisibleText(choice?.text);
      if (!content) throw new Error('在线 AI 没有返回可用正文，请重试或切换模型');
      return { ok: true, content, usage: body.usage || null, model: body.model || model };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('在线 AI 请求超时');
      if (error.name === 'TypeError' && /fetch failed|failed to fetch|network/iu.test(error.message || '')) {
        throw new Error('无法连接在线 AI 接口，请检查接口地址和网络');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

module.exports = { OpenAiCompatibleClient, extractVisibleText };
