'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function assertLocalDataPath(root, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('本机文件路径必须是绝对路径');
  const rootPath = await fs.realpath(root);
  const filePath = await fs.realpath(candidate);
  const relative = path.relative(rootPath, filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('只能打开应用数据目录内的文件');
  }
  return path.resolve(candidate);
}

module.exports = { assertLocalDataPath };
