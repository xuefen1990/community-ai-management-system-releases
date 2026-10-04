'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

function assertInternalStorage(directory, platform = process.platform) {
  const target = path.resolve(directory);
  if (platform === 'darwin') {
    const device = execFileSync('df', ['-P', target], { encoding: 'utf8' }).split('\n')[1]?.trim().split(/\s+/u)[0];
    if (!device?.startsWith('/dev/')) throw new Error('请选择本机内置磁盘上的文件夹');
    const plist = execFileSync('diskutil', ['info', '-plist', device]);
    const internal = execFileSync('plutil', ['-extract', 'Internal', 'raw', '-'], { input: plist, encoding: 'utf8' }).trim();
    if (internal !== 'true') throw new Error('请选择本机内置磁盘上的文件夹');
  } else if (platform === 'win32') {
    if (target.startsWith('\\\\')) throw new Error('请选择本机内置磁盘上的文件夹');
    const drive = path.win32.parse(target).root;
    const type = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.IO.DriveInfo]::new($args[0]).DriveType.ToString()', drive], { encoding: 'utf8' }).trim();
    if (type !== 'Fixed') throw new Error('请选择本机内置磁盘上的文件夹');
  }
  return target;
}

module.exports = { assertInternalStorage };
