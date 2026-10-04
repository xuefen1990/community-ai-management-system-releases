'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class LocalModelCatalog {
  constructor({ userDataPath }) {
    this.modelsDirectory = path.join(userDataPath, 'models');
  }

  async ensureDirectory() {
    await fs.mkdir(this.modelsDirectory, { recursive: true });
    return this.modelsDirectory;
  }

  async scan() {
    await this.ensureDirectory();
    const entries = await fs.readdir(this.modelsDirectory, { withFileTypes: true });
    const models = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf'))
      .map(async (entry) => {
        const modelPath = path.join(this.modelsDirectory, entry.name);
        const stats = await fs.stat(modelPath);
        return {
          name: entry.name,
          path: modelPath,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      }));
    return models.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  }

  async importFile(sourcePath) {
    if (typeof sourcePath !== 'string' || path.extname(sourcePath).toLowerCase() !== '.gguf') {
      throw new Error('请选择 .gguf 格式的本地模型文件');
    }
    const stats = await fs.stat(sourcePath);
    if (!stats.isFile()) throw new Error('所选模型路径不是文件');
    await this.ensureDirectory();
    const destinationPath = path.join(this.modelsDirectory, path.basename(sourcePath));
    if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
      await fs.copyFile(sourcePath, destinationPath);
    }
    return {
      ok: true,
      model: (await this.scan()).find((model) => model.path === destinationPath),
    };
  }
}

module.exports = { LocalModelCatalog };
