'use strict';

// Build-time only: change source literals, never stored records or DOM text.
const acorn = require('../app/node_modules/acorn');
const terminology = value => String(value).replace(/社区/gu, '村居').replace(/村民(?!委员会)/gu, '居民');
const propertyName = node => node?.key?.name || node?.key?.value;

function renameCodeLiterals(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
  const changes = [];
  function visit(node, ancestors = []) {
    if (!node || typeof node !== 'object' || !node.type) return;
    const parent = ancestors.at(-1);
    if (node.type === 'Literal' && typeof node.value === 'string' && /社区|村民/u.test(node.value)) {
      const key = propertyName(parent);
      const stableKey = parent?.type === 'Property' && parent.key === node || parent?.type === 'MemberExpression' && parent.property === node;
      const fileReference = ['filePath', 'wordPath', 'pdfPath'].includes(key);
      const stableField = key === 'key';
      // Old spreadsheet headers and template variables remain accepted inputs.
      const inputArray = parent?.type === 'ArrayExpression' && (
        ancestors.at(-2)?.type === 'Property' && ['aliases', 'name', '姓名', '性别', '组名', 'village_group', 'villageGroupName', 'groupName'].includes(propertyName(ancestors.at(-2))) ||
        ancestors.at(-2)?.type === 'MemberExpression' && ['includes', 'indexOf'].includes(ancestors.at(-2).property?.name)
      );
      const value = terminology(node.value);
      const hasAlias = inputArray && parent.elements.some(item => item?.value === value);
      if (!stableKey && !fileReference && !stableField && !hasAlias && value !== node.value) {
        changes.push({ start: node.start, end: node.end, value: inputArray ? `${JSON.stringify(value)}, ${source.slice(node.start, node.end)}` : JSON.stringify(value) });
      }
    } else if (node.type === 'TemplateElement' && /社区|村民/u.test(node.value.raw)) {
      changes.push({ start: node.start, end: node.end, value: terminology(node.value.raw) });
    } else if (node.type === 'Literal' && node.regex && /社区|村民/u.test(node.regex.pattern)) {
      const pattern = node.regex.pattern.replace(/社区(?!\|村居)/gu, '(?:社区|村居)').replace(/村民(?!委员会|\|居民)/gu, '(?:村民|居民)');
      changes.push({ start: node.start, end: node.end, value: `/${pattern}/${node.regex.flags}` });
    }
    for (const [name, value] of Object.entries(node)) {
      if (['start', 'end', 'loc'].includes(name)) continue;
      if (Array.isArray(value)) value.forEach(child => visit(child, [...ancestors, node]));
      else if (value && typeof value === 'object') visit(value, [...ancestors, node]);
    }
  }
  visit(ast);
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.value + source.slice(change.end);
  return source;
}

module.exports = { terminology, renameCodeLiterals };
