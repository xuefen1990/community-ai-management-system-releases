import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const require = createRequire(new URL('../app/package.json', import.meta.url));
export async function createUpdateBlockmap(file) {
  const { appBuilderPath } = require('app-builder-bin');
  const output = `${file}.blockmap`;
  const result = spawnSync(appBuilderPath, ['blockmap', '--input', file, '--output', output], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`生成更新块索引失败：${result.stderr || result.error?.message || result.status}`);
  const map = JSON.parse(gunzipSync(await readFile(output)).toString('utf8'));
  if (!map.files?.length) throw new Error('更新块索引没有有效文件块');
  return output;
}
