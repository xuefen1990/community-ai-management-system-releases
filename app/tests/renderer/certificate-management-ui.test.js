'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = path.resolve(__dirname, '../../src/renderer');

test('证明管理由独立扩展页接管且不增加重复菜单', () => {
  const extensions = fs.readFileSync(path.join(renderer, 'foundation/extensions.mjs'), 'utf8');
  assert.match(extensions, /key: 'certificate-workspace'/u); assert.match(extensions, /tab: 'tab-certificate-management'/u); assert.match(extensions, /menuKey: 'certificate-management'/u); assert.match(extensions, /insertMenu: false/u);
  assert.match(extensions, /\[item\.menuKey \|\| item\.key, item\.path\]/u, '原有证明管理菜单键也必须映射到新版路由');
  assert.match(extensions, /router\.removeRoute\(name\)/u, '必须移除基础模板自带的旧证明页面');
  assert.match(extensions, /path: '\/certificate-management', redirect: '\/certificate-workspace'/u, '旧地址必须自动跳转新版');
  assert.match(extensions, /router\.isReady\(\).*router\.replace\('\/certificate-workspace'\)/su, '启动时已经处于旧地址也必须立即切换新版');
  assert.match(extensions, /certificate-management-ui\.js/u); assert.match(extensions, /certificate-management\.css/u);
});

test('新页面包含确认的三个入口和单份开具流程', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  for (const label of ['开具证明', '开具记录', '模板管理', '输入姓名、身份证号或户号', '来自一户一档', '临时人员开具', 'A4 实时预览', '确认开具并打印']) assert.match(script, new RegExp(label, 'u'));
  for (const removed of ['批量开具', '上传 Excel', '字段映射', '新建批次']) assert.doesNotMatch(script, new RegExp(removed, 'u'));
});

test('居民搜索从首字实时查询、保留焦点并只显示必要信息', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  assert.doesNotMatch(script, /trim\(\)\.length < 2/u);
  assert.match(script, /searchSequences/u, '应防止较早的搜索请求覆盖最新结果');
  assert.match(script, /updateResidentCandidates/u, '候选列表应局部更新，避免重绘输入框');
  assert.match(script, /身份证号/u);
  assert.doesNotMatch(script, /出生日期未登记/u);
  assert.doesNotMatch(script, /关系未登记/u);
  assert.match(script, /data-template-field-subject/u, '居民字段应能显式选择第一位或第二位居民');
});

test('已选居民只展示当前证明使用的字段且人工输入不会重建页面', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  assert.match(script, /subjectDisplayFields/u);
  assert.match(script, /cm-needed-fields/u);
  assert.doesNotMatch(script, /\[\['身份证号', selected\.idCard\], \['性别'/u, '不得固定展示整套居民资料');
  assert.match(script, /if \(preview\) preview\.innerHTML = certificateBodyHtml\(model\(\)\.renderCertificateContent/u, '输入时应只更新证明预览');
  assert.doesNotMatch(script, /state\.draft\.values\[key\] = event\.target\.value; renderAndRestoreField/u, '输入时不得重建整页导致焦点跳转');
});

test('AI 开具提供连续对话、人工核对、草稿恢复和两种开具方式', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  for (const label of ['AI 开具', '连续对话', '重新生成整篇', '居民确认', '仅本次开具', '保存为模板并开具', '未完成内容会自动保存']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /draftCertificateWithAi/u);
  assert.match(script, /certificate-ai-draft/u);
  assert.match(script, /createTemplateFromAiDraft/u);
  assert.match(script, /确认继续吗/u, '新建和重新生成必须先保护现有草稿');
  assert.doesNotMatch(script, /estimateAiUsage|预计最多使用约|tokenConfirmationKey/u, 'AI 开具不能再弹 Token 预估确认');
  assert.match(script, /data-ai-token-status/u, 'Token 状态应显示在 AI 输入区底部');
  assert.doesNotMatch(script, /本次实际使用.*Token/u, '不在每条回复下重复显示 Token');
  assert.match(script, /const ready = Boolean\(text\(draft\.content\)\.trim\(\) && !draft\.loading\)/u, '正文已拟写时，不因档案或身份证号缺失禁用开具');
  assert.match(script, /aiReviewed: true/u, 'AI 开具应保存人工核对的正文');
  assert.doesNotMatch(script, /请先人工确认 AI 识别到的居民/u, '未关联档案只能提醒，不能阻止开具');
});

test('所有 AI 对话框统一为 Enter 发送、Shift+Enter 换行并保护中文输入法', () => {
  const scripts = [
    fs.readFileSync(path.join(renderer, 'js', 'ai-settings-ui.js'), 'utf8'),
    fs.readFileSync(path.join(renderer, 'js', 'certificate-management-ui.js'), 'utf8'),
    fs.readFileSync(path.join(renderer, 'js', 'document-drafting-ui.js'), 'utf8')
  ];
  const floatingAssistant = fs.readFileSync(path.join(renderer, 'foundation', 'floating-assistant.mjs'), 'utf8');
  for (const source of scripts) {
    assert.match(source, /event\.key !== ['"]Enter['"]/u, 'AI 输入框应识别 Enter');
    assert.match(source, /event\.shiftKey/u, 'Shift+Enter 应保留换行');
    assert.match(source, /event\.isComposing/u, '中文输入法组合期间不得发送');
    assert.match(source, /event\.keyCode === 229/u, '应兼容旧版输入法的组合键码');
  }
  assert.match(floatingAssistant, /Enter 发送 · Shift \+ Enter 换行/u);
  assert.match(scripts[1], /Enter 发送 · Shift \+ Enter 换行/u);
  assert.match(scripts[2], /Enter 发送 · Shift \+ Enter 换行/u);
  assert.doesNotMatch(scripts[0], /\(event\.ctrlKey \|\| event\.metaKey\).*event\.key === ['"]Enter['"]/su);
  assert.doesNotMatch(scripts[1], /event\.key !== ['"]Enter['"]\s*\|\|\s*!\(event\.metaKey \|\| event\.ctrlKey\)/su);
  assert.doesNotMatch(scripts[2], /\(event\.metaKey \|\| event\.ctrlKey\).*event\.key === ['"]Enter['"]/su);
});

test('AI 开具发现相同模板时复用或更新而不重复新建', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  for (const label of ['发现已有证明模板', '不再建立重复模板', '使用现有模板开具', '更新现有模板后开具', '更新并开具']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /findDuplicateCertificateTemplate/u);
  assert.match(script, /outputOverride/u, '复用模板时仍应保存人工核对后的本次正文');
  assert.match(script, /ai-conflict-cancel/u);
});

test('普通开具和 AI 开具均可修改署名日期并显示中文日期', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  assert.match(script, /profile\?\.profile\?\.villageName/u);
  for (const marker of ['data-system-field="organizationName"', 'data-system-field="issuedDate"', 'data-ai-system-field="organizationName"', 'data-ai-system-field="issuedDate"', 'formatCertificateDate']) assert.match(script, new RegExp(marker, 'u'));
  assert.doesNotMatch(script, /陆庄社区居民委员会/u);
  const style = fs.readFileSync(path.join(renderer, 'foundation/certificate-management.css'), 'utf8');
  for (const marker of ['text-align:left', 'word-break:break-all']) assert.match(style, new RegExp(marker, 'u'));
});

test('记录和模板管理提供中文业务操作', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  for (const label of ['重新打印', '复制开具', '作废', '作废原因', '模板新版本已发布', '系统 A4 版式', '人工填写', '居民档案']) assert.match(script, new RegExp(label, 'u'));
  assert.match(script, /operationUuid/u); assert.match(script, /certificate-residents/u);
  assert.match(script, /openRecords/u, '外部记录导航应进入新版开具记录页');
  assert.match(script, /openTemplateIntake/u, 'AI 识别的模板草稿应直接进入模板核对');
  assert.match(script, /核对并发布/u);
});

test('UI 样式提供双栏、固定操作栏、窄窗和打印版式', () => {
  const style = fs.readFileSync(path.join(renderer, 'foundation/certificate-management.css'), 'utf8');
  for (const marker of ['.cm-workspace', '.cm-actionbar', '.cm-candidates', '.cm-a4', '@media(max-width:1180px)', '@media print', 'prefers-reduced-motion']) assert.match(style, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
});

test('证明预览按换行分段首行缩进，正文为适中行距且落款留出多行', () => {
  const script = fs.readFileSync(path.join(renderer, 'js/certificate-management-ui.js'), 'utf8');
  const style = fs.readFileSync(path.join(renderer, 'foundation/certificate-management.css'), 'utf8');
  assert.match(script, /const certificateBodyHtml = value =>/u);
  assert.match(script, /split\(\/\\n\+\/u\)/u);
  assert.match(script, /preview\.innerHTML = certificateBodyHtml/u);
  assert.match(style, /\.cm-a4>div p\{margin:0;text-indent:2em;line-height:1\.75;text-align:left;/u);
  assert.match(style, /\.cm-a4>div p\+p\{margin-top:\.4em\}/u);
  assert.match(style, /\.cm-a4 footer\{margin-top:90px;/u);
});
