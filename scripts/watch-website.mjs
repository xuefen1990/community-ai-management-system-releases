import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(projectRoot, 'website', 'dist');
const deployScript = path.join(projectRoot, 'scripts', 'deploy-website.sh');
let timer;
let running = false;
let pending = false;

function deploy() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const child = spawn('bash', [deployScript], { cwd: projectRoot, env: process.env, stdio: 'inherit' });
  child.on('error', error => {
    console.error('官网同步无法启动：', error.message);
  });
  child.on('close', code => {
    if (code !== 0) console.error(`官网同步失败（退出码 ${code}），下次保存时会重试。`);
    running = false;
    if (pending) {
      pending = false;
      deploy();
    }
  });
}

const watcher = watch(sourceDir, { recursive: true }, (_event, filename) => {
  if (filename && (filename === '.DS_Store' || filename.startsWith('._'))) return;
  clearTimeout(timer);
  timer = setTimeout(deploy, 500);
});

console.log(`正在监听 ${sourceDir}；保存网页文件后自动同步。按 Ctrl+C 退出。`);
deploy();
process.on('SIGINT', () => { watcher.close(); clearTimeout(timer); process.exit(0); });
