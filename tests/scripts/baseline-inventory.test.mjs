import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

test('page inventory covers every main navigation target', async () => {
  const inventory = await readFile(path.join(projectRoot, 'docs/baseline/page-inventory.md'), 'utf8');
  const expectedTargets = [
    'tab-overview',
    'tab-statistics',
    'tab-personnel',
    'tab-party',
    'tab-visit-records',
    'tab-duty',
    'tab-finance',
    'tab-land',
    'tab-certificate',
    'tab-documents',
    'tab-settings',
  ];

  for (const target of expectedTargets) assert.match(inventory, new RegExp(`\\b${target}\\b`, 'u'));
  assert.match(inventory, /侧边栏入口：11/u);
  assert.match(inventory, /内容区域：14/u);
  assert.match(inventory, /模态弹窗：25/u);
});

test('IPC inventory contains the complete exposed compatibility surface', async () => {
  const inventory = await readFile(path.join(projectRoot, 'docs/baseline/ipc-inventory.md'), 'utf8');
  assert.match(inventory, /API 数量：42/u);
  assert.match(inventory, /`readDb`[\s\S]*`read-db`/u);
  assert.match(inventory, /`writeDb`[\s\S]*`write-db`/u);
  assert.match(inventory, /`scanLocalModels`[\s\S]*`scan-local-models`/u);
  assert.match(inventory, /`getInternalAiServerStatus`[\s\S]*`get-internal-ai-server-status`/u);
});

test('asset inventory records all application-owned files and business modules', async () => {
  const inventory = await readFile(path.join(projectRoot, 'docs/baseline/asset-inventory.md'), 'utf8');
  assert.match(inventory, /非第三方应用文件：55/u);
  assert.match(inventory, /业务模块脚本：35/u);
  assert.match(inventory, /`js\/modules\/household-360\.js`/u);
  assert.match(inventory, /`js\/modules\/ai\/ai_orchestrator\.js`/u);
  assert.match(inventory, /`login_bg\.jpg`/u);
});

