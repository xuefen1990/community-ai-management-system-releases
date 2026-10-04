#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';

function run(command, argumentsList, options = {}) {
  const result = spawnSync(command, argumentsList, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${argumentsList.join(' ')} 失败${detail ? `：${detail}` : ''}`);
  }
}

try {
  // This command never launches an interactive login. A saved Git credential
  // works in every new window, while a missing one fails clearly.
  // GitHub Actions releases use their own GITHUB_TOKEN, so a stale local gh
  // CLI token must not block ordinary commits and pushes.
  run('git', ['ls-remote', '--exit-code', 'origin', 'HEAD']);
  console.log('GitHub 凭据可复用：当前窗口无需再次授权。');
} catch (error) {
  console.error(`GitHub 凭据不可用：${error.message}`);
  console.error('请在本机首次完成 GitHub 登录并保存到 macOS 钥匙串；完成后新开的窗口会自动复用该凭据。');
  process.exitCode = 1;
}
