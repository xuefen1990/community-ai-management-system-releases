import fs from 'node:fs/promises';
import { constants } from 'node:fs';

export async function ensureElectronRuntime(executable) {
  await fs.access(executable, constants.X_OK).catch(() => { throw new Error('Electron 开发运行时缺失。请执行 node node_modules/electron/install.js，或 npm run dev:setup。'); });
}
