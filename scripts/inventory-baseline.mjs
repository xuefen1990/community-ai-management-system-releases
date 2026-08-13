#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const projectRoot = path.resolve(import.meta.dirname, '..');
const baselineRoot = path.join(projectRoot, 'source-original', 'app-asar');
const docsRoot = path.join(projectRoot, 'docs', 'baseline');

function stripHtml(value) {
  return value
    .replace(/<svg[\s\S]*?<\/svg>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

function escapeTable(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'iu'))?.[1] ?? '';
}

function unique(values) {
  return [...new Set(values)];
}

async function buildPageInventory() {
  const html = await readFile(path.join(baselineRoot, 'index.html'), 'utf8');
  const menuItems = [];
  const menuPattern = /<button\b[^>]*class="[^"]*\bmenu-item\b[^"]*"[^>]*data-target="([^"]+)"[^>]*>([\s\S]*?)<\/button>/giu;
  let match;

  while ((match = menuPattern.exec(html))) {
    menuItems.push({ target: match[1], label: stripHtml(match[2]) });
  }

  const contentSections = [];
  const startTagPattern = /<(?:div|section)\b[^>]*>/giu;
  while ((match = startTagPattern.exec(html))) {
    const tag = match[0];
    const className = attribute(tag, 'class');
    const id = attribute(tag, 'id');
    if (id && /(?:^|\s)(?:content-tab|tab-content|sub-tab-content)(?:\s|$)/u.test(className)) {
      contentSections.push({ id, className });
    }
  }

  const modals = [];
  startTagPattern.lastIndex = 0;
  while ((match = startTagPattern.exec(html))) {
    const tag = match[0];
    const className = attribute(tag, 'class');
    const id = attribute(tag, 'id');
    if (!id || !/(?:^|\s)modal-overlay(?:\s|$)/u.test(className)) continue;

    const nearby = html.slice(match.index, match.index + 3000);
    const headingMatch = nearby.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/iu);
    modals.push({ id, title: headingMatch ? stripHtml(headingMatch[1]) : '' });
  }

  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/giu)].map((item) => item[1]);
  const stylesheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/giu)].map((item) => item[1]);
  const images = [...html.matchAll(/<img\b[^>]*>/giu)].map((item) => ({
    src: attribute(item[0], 'src'),
    alt: attribute(item[0], 'alt'),
  }));

  const lines = [
    '# 原版页面清单',
    '',
    `- 侧边栏入口：${menuItems.length}`,
    `- 内容区域：${unique(contentSections.map((item) => item.id)).length}`,
    `- 模态弹窗：${modals.length}`,
    `- 页面脚本：${scripts.length}`,
    '',
    '## 侧边栏入口',
    '',
    '| 顺序 | 页面 | 目标 ID |',
    '| ---: | --- | --- |',
    ...menuItems.map((item, index) => `| ${index + 1} | ${escapeTable(item.label)} | \`${escapeTable(item.target)}\` |`),
    '',
    '## 内容区域',
    '',
    '| ID | class |',
    '| --- | --- |',
    ...unique(contentSections.map((item) => `${item.id}\t${item.className}`)).map((row) => {
      const [id, className] = row.split('\t');
      return `| \`${escapeTable(id)}\` | \`${escapeTable(className)}\` |`;
    }),
    '',
    '## 模态弹窗',
    '',
    '| ID | 标题 |',
    '| --- | --- |',
    ...modals.map((item) => `| \`${escapeTable(item.id)}\` | ${escapeTable(item.title) || '未设置固定标题'} |`),
    '',
    '## 页面直接加载的脚本',
    '',
    ...scripts.map((source) => `- \`${source}\``),
    '',
    '## 样式与图片引用',
    '',
    ...stylesheets.map((source) => `- 样式：\`${source}\``),
    ...unique(images.map((item) => `${item.src}\t${item.alt}`)).map((row) => {
      const [src, alt] = row.split('\t');
      return `- 图片：\`${src}\`${alt ? `（${alt}）` : ''}`;
    }),
    '',
  ];

  await writeFile(path.join(docsRoot, 'page-inventory.md'), lines.join('\n'), 'utf8');
  return { menuItems, contentSections, modals, scripts };
}

async function buildIpcInventory() {
  const preloadCode = await readFile(path.join(baselineRoot, 'preload.js'), 'utf8');
  const calls = [];
  let exposedName = '';
  let exposedApi = null;
  const ipcRenderer = {
    invoke(channel, ...args) {
      calls.push({ kind: 'invoke', channel, argumentCount: args.length });
      return Promise.resolve(null);
    },
    send(channel, ...args) {
      calls.push({ kind: 'send', channel, argumentCount: args.length });
    },
    on(channel, ...args) {
      calls.push({ kind: 'on', channel, argumentCount: args.length });
    },
    removeAllListeners(channel) {
      calls.push({ kind: 'removeAllListeners', channel, argumentCount: 0 });
    },
  };

  const sandbox = {
    require(moduleName) {
      if (moduleName !== 'electron') throw new Error(`Unexpected preload dependency: ${moduleName}`);
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposedName = name;
            exposedApi = api;
          },
        },
        ipcRenderer,
      };
    },
    process: { platform: 'darwin' },
    Buffer,
    console,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(preloadCode, sandbox, { timeout: 5000, filename: 'preload.js' });
  if (!exposedApi) throw new Error('Preload script did not expose an API');

  const apiRows = [];
  for (const [name, value] of Object.entries(exposedApi)) {
    if (typeof value !== 'function') {
      apiRows.push({ name, type: typeof value, calls: [], value: String(value) });
      continue;
    }

    const before = calls.length;
    try {
      const callback = () => {};
      value({}, '', callback);
    } catch (error) {
      calls.push({ kind: 'inspection-error', channel: error.message, argumentCount: 0 });
    }
    apiRows.push({ name, type: 'function', calls: calls.slice(before), value: '' });
  }

  const lines = [
    '# 原版预加载 API 与 IPC 清单',
    '',
    `- 暴露对象：\`window.${exposedName}\``,
    `- API 数量：${apiRows.length}`,
    '',
    '| API | 类型 | IPC 方式 | channel | 参数数量 |',
    '| --- | --- | --- | --- | ---: |',
  ];

  for (const row of apiRows) {
    if (row.calls.length === 0) {
      lines.push(`| \`${row.name}\` | ${row.type} | — | ${escapeTable(row.value) || '—'} | 0 |`);
    } else {
      for (const [index, call] of row.calls.entries()) {
        lines.push(`| ${index === 0 ? `\`${row.name}\`` : '↳'} | ${row.type} | \`${escapeTable(call.kind)}\` | \`${escapeTable(call.channel)}\` | ${call.argumentCount} |`);
      }
    }
  }

  lines.push('', '该清单通过受限 Electron stub 执行原 `preload.js` 获取，用于新兼容桥接层逐项实现和核对。', '');
  await writeFile(path.join(docsRoot, 'ipc-inventory.md'), lines.join('\n'), 'utf8');
  return { exposedName, apiRows };
}

async function buildAssetInventory(pageInventory) {
  const manifestText = await readFile(
    path.join(projectRoot, 'source-original', 'manifest', 'app-asar-files.tsv'),
    'utf8',
  );
  const rows = manifestText.trim().split('\n').slice(1).map((line) => {
    const [type, mode, size, sha256, filePath] = line.split('\t');
    return { type, mode, size: Number(size), sha256, filePath };
  });

  const appFiles = rows.filter((row) => !row.filePath.startsWith('node_modules/'));
  const extensionCounts = new Map();
  for (const row of rows) {
    const extension = path.extname(row.filePath).toLowerCase() || '[none]';
    extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
  }

  const visualAssets = appFiles.filter((row) => /\.(?:png|jpe?g|gif|webp|svg|icns|css)$/iu.test(row.filePath));
  const businessScripts = appFiles.filter((row) => row.filePath.startsWith('js/modules/') && row.filePath.endsWith('.js'));
  const coreScripts = appFiles.filter((row) => row.filePath.startsWith('js/core/') && row.filePath.endsWith('.js'));

  const lines = [
    '# 原版资源与业务脚本清单',
    '',
    `- ASAR 文件总数：${rows.length}`,
    `- 非第三方应用文件：${appFiles.length}`,
    `- 视觉资源：${visualAssets.length}`,
    `- 业务模块脚本：${businessScripts.length}`,
    `- 核心辅助脚本：${coreScripts.length}`,
    `- HTML 直接加载脚本：${pageInventory.scripts.length}`,
    '',
    '## 文件类型统计',
    '',
    '| 扩展名 | 数量 |',
    '| --- | ---: |',
    ...[...extensionCounts.entries()].sort((left, right) => right[1] - left[1]).map(([extension, count]) => `| \`${extension}\` | ${count} |`),
    '',
    '## 非第三方应用文件',
    '',
    '| 路径 | 大小 | SHA-256 |',
    '| --- | ---: | --- |',
    ...appFiles.map((row) => `| \`${escapeTable(row.filePath)}\` | ${row.size} | \`${row.sha256}\` |`),
    '',
  ];

  await writeFile(path.join(docsRoot, 'asset-inventory.md'), lines.join('\n'), 'utf8');
  return { rows, appFiles, visualAssets, businessScripts, coreScripts };
}

await mkdir(docsRoot, { recursive: true });
const pageInventory = await buildPageInventory();
const ipcInventory = await buildIpcInventory();
const assetInventory = await buildAssetInventory(pageInventory);

console.log(JSON.stringify({
  menuItems: pageInventory.menuItems.length,
  contentSections: unique(pageInventory.contentSections.map((item) => item.id)).length,
  modals: pageInventory.modals.length,
  scripts: pageInventory.scripts.length,
  preloadApi: ipcInventory.apiRows.length,
  appFiles: assetInventory.appFiles.length,
  businessScripts: assetInventory.businessScripts.length,
  visualAssets: assetInventory.visualAssets.length,
}, null, 2));
