import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const label = 'cn.xuefeng.community-ai.website-watch';
const domain = `gui/${process.getuid()}`;
const agentDir = path.join(homedir(), 'Library', 'LaunchAgents');
const logDir = path.join(homedir(), 'Library', 'Logs', 'CommunityAIWebsite');
const plistPath = path.join(agentDir, `${label}.plist`);
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function run(...args) {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `launchctl ${args[0]} 失败`);
}

mkdirSync(agentDir, { recursive: true });
mkdirSync(logDir, { recursive: true });
const existing = spawnSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }).status === 0;
if (existing) run('bootout', domain, plistPath);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(path.join(projectRoot, 'scripts', 'watch-website.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(projectRoot)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(logDir, 'watch.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(logDir, 'watch-error.log'))}</string>
</dict></plist>
`;
writeFileSync(plistPath, plist);
run('bootstrap', domain, plistPath);
console.log(`官网自动同步已启用；登录电脑后会自动运行。日志：${logDir}`);
