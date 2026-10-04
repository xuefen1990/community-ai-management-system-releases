'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { CertificateDocumentService, certificateText, inspectDocxBuffer, renderDocxBuffer } = require('../../src/main/certificate-document-service');

function wordBuffer(content) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.folder('word').file('document.xml', `<w:document><w:body><w:p><w:r><w:t>${content}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' });
}

test('检查 Word 模板时返回中文变量', () => {
  assert.deepEqual(inspectDocxBuffer(wordBuffer('{村民姓名}与{双方关系}')).variables, ['村民姓名', '双方关系']);
});

test('Word 输出使用开具快照替换字段且不写入内部编号', () => {
  const record = { internalRecordNo: 'CERT-2026-0001', subjectSnapshots: { person1: { name: '张三' } }, valueSnapshot: { 'manual.relationship': '父子' },
    templateSnapshot: { fields: [{ key: 'person1.name', label: '村民姓名', source: 'archive' }, { key: 'manual.relationship', label: '双方关系', source: 'manual' }] } };
  const output = renderDocxBuffer(wordBuffer('{村民姓名}系{双方关系}'), record);
  const xml = new PizZip(output).file('word/document.xml').asText();
  assert.match(xml, /张三系父子/u); assert.doesNotMatch(xml, /CERT-2026/u);
});

test('Word 模板缺少开具值时列出具体字段', () => {
  const record = { subjectSnapshots: {}, valueSnapshot: {}, templateSnapshot: { fields: [{ key: 'person1.name', label: '村民姓名', source: 'archive' }] } };
  assert.throws(() => renderDocxBuffer(wordBuffer('{村民姓名}'), record), /村民姓名/u);
});

test('系统 A4 输出使用可保存的署名、中文日期和自然字距正文', () => {
  const output = certificateText({ outputSnapshot: { title: '关系证明', content: '兹证明张三与李四系夫妻关系。' }, system: { organizationName: '陆庄社区居民委员会', issuedDate: '2026-09-15' } });
  assert.match(output.contentHtml, /data-doc-align="left"/u);
  assert.match(output.contentHtml, /陆庄社区居民委员会/u);
  assert.match(output.contentHtml, /2026年09月15日/u);
});

test('证明正文换行后首行缩进，导出采用适中行距并让落款隔开三行', async () => {
  const record = { outputSnapshot: { title: '情况证明', content: '第一段。\n\n第二段。\n第三段。' }, system: {} };
  const output = certificateText(record);
  assert.equal((output.contentHtml.match(/data-doc-role="body"/gu) || []).length, 3);
  const exporter = new CertificateDocumentService({ store: { dataDirectory: '/tmp' }, dialog: {} });
  const xml = new PizZip(await exporter.outputBuffer(record, 'docx')).file('word/document.xml').asText();
  assert.equal((xml.match(/w:firstLine="640"/gu) || []).length, 3);
  assert.equal((xml.match(/w:line="560"/gu) || []).length >= 3, true);
  assert.match(xml, /w:before="1680"/u);
  assert.match(xml, /w:eastAsia="宋体"[^]*?<w:sz w:val="44"/u);
  assert.match(xml, /w:line="560" w:lineRule="exact" w:after="560"/u);
});
