'use strict';

const fs = require('node:fs/promises');

class LocalAiRuntime {
  constructor({ loadModule = () => import('node-llama-cpp') } = {}) {
    this.loadModule = loadModule;
    this.model = null;
    this.context = null;
    this.session = null;
    this.modelPath = null;
    this.loading = false;
    this.error = null;
  }

  getStatus() {
    return {
      running: Boolean(this.session),
      loading: this.loading,
      modelPath: this.modelPath,
      error: this.error,
    };
  }

  async start(modelPath) {
    if (!modelPath || !modelPath.toLowerCase().endsWith('.gguf')) throw new Error('请选择有效的 GGUF 模型');
    await fs.access(modelPath);
    if (this.session && this.modelPath === modelPath) return this.getStatus();
    await this.stop();
    this.loading = true;
    this.error = null;
    try {
      const module = await this.loadModule();
      const llama = await module.getLlama();
      this.model = await llama.loadModel({ modelPath });
      this.context = await this.model.createContext({ contextSize: 4096 });
      this.session = new module.LlamaChatSession({ contextSequence: this.context.getSequence() });
      this.modelPath = modelPath;
      this.loading = false;
      return this.getStatus();
    } catch (error) {
      this.error = error.message;
      await this.stop({ preserveError: true });
      throw error;
    } finally {
      this.loading = false;
    }
  }

  async stop({ preserveError = false } = {}) {
    for (const resource of [this.session, this.context, this.model]) {
      if (typeof resource?.dispose === 'function') await resource.dispose();
    }
    this.session = null;
    this.context = null;
    this.model = null;
    this.modelPath = null;
    if (!preserveError) this.error = null;
    return this.getStatus();
  }

  async toggle(value = {}) {
    const shouldStart = value === true || value.enabled === true || value.action === 'start';
    return shouldStart ? this.start(value.modelPath) : this.stop();
  }

  async chat(messages) {
    if (!this.session) throw new Error('本地 AI 服务尚未启动');
    const prompt = Array.isArray(messages)
      ? messages.map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${message.content}`).join('\n')
      : String(messages || '');
    if (!prompt.trim()) throw new Error('消息内容不能为空');
    const content = await this.session.prompt(prompt, { temperature: 0.2 });
    return { ok: true, content, model: this.modelPath, provider: 'local' };
  }
}

module.exports = { LocalAiRuntime };
