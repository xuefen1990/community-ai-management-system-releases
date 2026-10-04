'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..', '..');

test('foundation IPC data removes Vue-style proxies before cloning', async () => {
  const { toIpcData } = await import(path.join(appRoot, 'src', 'renderer', 'foundation', 'ipc-data.mjs'));
  const target = { customFields: { note: '可保存' }, nested: [{ value: '正常' }] };
  const reactive = new Proxy(target, {});
  const plain = toIpcData({ baseValues: reactive, repeat: reactive, kept: undefined });

  assert.notEqual(plain.baseValues, reactive);
  assert.notEqual(plain.baseValues.customFields, reactive.customFields);
  assert.equal(plain.baseValues.customFields.note, '可保存');
  assert.equal(plain.kept, undefined);
  assert.doesNotThrow(() => structuredClone(plain));
});
