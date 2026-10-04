import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function refreshFoundation(project) {
  const root = path.join(project, 'app/src/renderer/foundation/vendor');
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'provenance.json'), 'utf8'));
  const original = await fs.readFile(path.join(root, metadata.originalBundle), 'utf8');
  const target = path.join(root, 'assets/foundation-runtime.mjs');
  const current = await fs.readFile(target, 'utf8');
  const exports = current.slice(current.lastIndexOf('\nexport {'));
  if (!exports.startsWith('\nexport {') || original.split('B1.mount("#app");').length !== 2) throw new Error('基础界面导出或挂载入口发生变化，请检查适配脚本');
  const adapter = path.join(project, 'scripts/foundation-adaptations.cjs');
  delete require.cache[require.resolve(adapter)];
  const next = require(adapter)(original.replace('B1.mount("#app");', '')) + exports;
  if (next !== current) await fs.writeFile(target, next);
}
