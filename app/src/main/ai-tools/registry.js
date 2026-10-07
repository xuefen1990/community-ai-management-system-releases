'use strict';

const { defineAiTool, publicToolMetadata } = require('./tool-definition');

class AiToolRegistry {
  constructor(tools = []) {
    this.tools = [];
    this.byId = new Map();
    for (const tool of tools) this.register(tool);
  }

  register(definition) {
    const tool = defineAiTool(definition);
    if (this.byId.has(tool.id)) throw new Error(`AI 工具编号重复：${tool.id}`);
    this.tools.push(tool);
    this.byId.set(tool.id, tool);
    return tool;
  }

  get(id) {
    return this.byId.get(String(id || '').trim()) || null;
  }

  list({ stage = '' } = {}) {
    return this.tools
      .filter(tool => !stage || tool.stages.includes(stage))
      .map(publicToolMetadata);
  }

  async executeFirst(context = {}, { stage = 'post-plan' } = {}) {
    for (const tool of this.tools) {
      if (!tool.stages.includes(stage)) continue;
      const result = await tool.handle(context);
      if (result === null || result === undefined || result === false) continue;
      const response = typeof result === 'string'
        ? { content: result, provider: 'system', handled: true }
        : { ...result };
      response.aiTool = publicToolMetadata(tool);
      return response;
    }
    return null;
  }

  async execute(id, context = {}) {
    const tool = this.get(id);
    if (!tool) throw new Error(`未登记的 AI 工具：${id}`);
    const result = await tool.handle(context);
    if (result === null || result === undefined || result === false) return null;
    const response = typeof result === 'string'
      ? { content: result, provider: 'system', handled: true }
      : { ...result };
    response.aiTool = publicToolMetadata(tool);
    return response;
  }
}

module.exports = { AiToolRegistry };
