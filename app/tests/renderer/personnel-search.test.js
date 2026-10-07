'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

test('resident search waits for Chinese input composition before filtering', async () => {
  const source = await fs.readFile(path.join(__dirname, '../../src/renderer/js/personnel-search.js'), 'utf8');
  assert.match(source, /compositionstart/u);
  assert.match(source, /compositionend/u);
  assert.match(source, /event\?\.isComposing/u);
  assert.match(source, /compositionCommitPending/u);
  assert.match(source, /stopImmediatePropagation/u);
  assert.match(source, /window\.filterPersonnel = \(\) =>/u);
  assert.match(source, /search\.oninput = null/u);
});
