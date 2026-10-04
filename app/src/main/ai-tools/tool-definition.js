'use strict';

const RISK_LEVELS = Object.freeze(['R0', 'R1', 'R2']);
const STAGES = Object.freeze(['pre-plan', 'post-plan']);

function cleanText(value) {
  return String(value ?? '').trim();
}

function defineAiTool(definition = {}) {
  const id = cleanText(definition.id);
  const name = cleanText(definition.name);
  const category = cleanText(definition.category);
  const riskLevel = cleanText(definition.riskLevel || 'R0');
  const stages = [...new Set((Array.isArray(definition.stages) ? definition.stages : ['post-plan']).map(cleanText))];
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id)) throw new TypeError('AI 工具编号格式不正确');
  if (!name) throw new TypeError(`AI 工具 ${id} 缺少中文名称`);
  if (!category) throw new TypeError(`AI 工具 ${id} 缺少分类`);
  if (!RISK_LEVELS.includes(riskLevel)) throw new TypeError(`AI 工具 ${id} 风险等级不正确`);
  if (!stages.length || stages.some(stage => !STAGES.includes(stage))) throw new TypeError(`AI 工具 ${id} 执行阶段不正确`);
  if (typeof definition.handle !== 'function') throw new TypeError(`AI 工具 ${id} 缺少处理器`);
  const permission = definition.permission && typeof definition.permission === 'object'
    ? Object.freeze({ module: cleanText(definition.permission.module), action: cleanText(definition.permission.action || 'view') })
    : null;
  return Object.freeze({
    id,
    name,
    category,
    description: cleanText(definition.description),
    riskLevel,
    confirmationCount: Number(definition.confirmationCount || 0),
    permission,
    sourceCollections: Object.freeze([...(definition.sourceCollections || [])].map(cleanText).filter(Boolean)),
    precheck: cleanText(definition.precheck),
    impact: cleanText(definition.impact),
    verification: cleanText(definition.verification),
    undoPolicy: cleanText(definition.undoPolicy),
    onlineSummary: cleanText(definition.onlineSummary),
    stages: Object.freeze(stages),
    handle: definition.handle,
  });
}

function publicToolMetadata(tool) {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
    riskLevel: tool.riskLevel,
    confirmationCount: tool.confirmationCount,
    permission: tool.permission ? { ...tool.permission } : null,
    sourceCollections: [...tool.sourceCollections],
    precheck: tool.precheck,
    impact: tool.impact,
    verification: tool.verification,
    undoPolicy: tool.undoPolicy,
    onlineSummary: tool.onlineSummary,
  };
}

module.exports = { RISK_LEVELS, STAGES, defineAiTool, publicToolMetadata };
