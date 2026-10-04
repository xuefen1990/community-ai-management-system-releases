'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('测试后端未在规定时间内启动');
}

async function request(url, pathName, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${url}/api${pathName}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('手机号注册主账号，并管理成员、有效期和模型', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'community-ai-backend-'));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DB_PATH: path.join(directory, 'backend.db'),
      UPDATE_FILES_DIR: path.join(directory, 'updates'),
      JWT_SECRET: 'test-only-jwt-secret',
      ADMIN_PHONE: '13800000000',
      ADMIN_PASSWORD: 'test-admin-bootstrap-pass',
    },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await waitForHealth(url);

  const adminLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13800000000', password: 'test-admin-bootstrap-pass' } });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.body.user.mustChangePassword, true);
  assert.equal((await request(url, '/auth/users', { token: adminLogin.body.token })).status, 403);
  const initialPasswordChange = await request(url, '/auth/password', { token: adminLogin.body.token, method: 'PUT', body: { oldPassword: 'test-admin-bootstrap-pass', newPassword: 'test-admin-working-pass' } });
  assert.equal(initialPasswordChange.status, 200);
  const adminToken = (await request(url, '/auth/login', { method: 'POST', body: { phone: '13800000000', password: 'test-admin-working-pass' } })).body.token;

  const registered = await request(url, '/auth/register', { method: 'POST', body: {
    phone: '139 0013 9000', password: 'secret88', confirmPassword: 'secret88', machineId: 'mac-test-001',
  } });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.role, 'main_account');
  assert.equal(registered.body.user.planType, 'trial');
  assert.equal(registered.body.user.mainAccountId, registered.body.user.id);
  assert.equal(registered.body.user.organizationId, null);

  const unitAdminLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'secret88' } });
  assert.equal(unitAdminLogin.status, 200);
  const unitQuota = await request(url, '/ai/quota', { token: unitAdminLogin.body.token });
  assert.equal(unitQuota.status, 200);
  assert.equal(unitQuota.body.quota.permanent, true);
  assert.equal(unitQuota.body.quota.totalTokens, 1000000);
  const unitLedger = await request(url, '/ai/quota/ledger?pageSize=10', { token: unitAdminLogin.body.token });
  assert.equal(unitLedger.status, 200);
  assert.equal(unitLedger.body.pagination.total, 1);
  const grantedQuota = await request(url, `/admin/ai/quotas/${unitQuota.body.quota.mainAccountId}/grants`, { token: adminToken, method: 'POST', body: { tokens: 5000, reason: '测试购买额度' } });
  assert.equal(grantedQuota.status, 201);
  assert.equal(grantedQuota.body.quota.totalTokens, 1005000);
  const stoppedInvite = await request(url, '/auth/unit/invites', { token: unitAdminLogin.body.token, method: 'POST', body: { maxUses: 3 } });
  assert.equal(stoppedInvite.status, 410);
  const stoppedApplication = await request(url, '/auth/member-applications', { method: 'POST', body: { phone: '13700137000', password: 'member88', name: '张成员' } });
  assert.equal(stoppedApplication.status, 410);
  const reviewedMember = await request(url, '/auth/unit/members', { token: unitAdminLogin.body.token, method: 'POST', body: { phone: '13700137000', name: '张成员', preset: 'custom', permissions: { personnel: ['view', 'create'], party: ['view'], workspace: ['view', 'update'] }, aiAccessEnabled: true } });
  assert.equal(reviewedMember.status, 201);
  assert.deepEqual(reviewedMember.body.user.permissions.personnel, ['view', 'create']);
  const initialMemberLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13700137000', password: reviewedMember.body.initialPassword } });
  assert.equal(initialMemberLogin.status, 200);
  const firstPasswordChange = await request(url, '/auth/password', { token: initialMemberLogin.body.token, method: 'PUT', body: { oldPassword: reviewedMember.body.initialPassword, newPassword: 'member88' } });
  assert.equal(firstPasswordChange.status, 200);
  const memberLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13700137000', password: 'member88' } });
  assert.equal(memberLogin.status, 200);

  const savedConversation = await request(url, '/ai/assistant/conversation', {
    token: unitAdminLogin.body.token, method: 'PUT', body: {
      conversationId: 'conversation-unit-admin',
      messages: [{ role: 'user', content: '查一下张三' }, { role: 'assistant', content: '请补充村民组' }],
    },
  });
  assert.equal(savedConversation.status, 200);
  assert.equal(savedConversation.body.conversation.messages.length, 2);
  const restoredConversation = await request(url, '/ai/assistant/conversation?conversationId=conversation-unit-admin', { token: unitAdminLogin.body.token });
  assert.equal(restoredConversation.body.conversation.messages[0].content, '查一下张三');
  const otherUsersConversation = await request(url, '/ai/assistant/conversation?conversationId=conversation-unit-admin', { token: memberLogin.body.token });
  assert.equal(otherUsersConversation.body.conversation, null);

  const longConversation = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `第 ${index + 1} 条对话内容` }));
  const compactedConversation = await request(url, '/ai/assistant/conversation', {
    token: unitAdminLogin.body.token, method: 'PUT', body: { conversationId: 'conversation-long', messages: longConversation },
  });
  assert.equal(compactedConversation.status, 200);
  assert.equal(compactedConversation.body.conversation.messages.length, 20);
  assert.match(compactedConversation.body.conversation.summary, /第 1 条对话内容/u);

  const savedTask = await request(url, '/ai/assistant/tasks/task-unit-admin', {
    token: unitAdminLogin.body.token, method: 'PUT', body: {
      conversationId: 'conversation-unit-admin', title: '跨模块核对', originalRequest: '查询张三的土地和发放', status: 'waiting-input',
      steps: [{ id: 'step-1', title: '查询土地', toolId: 'land.resident-parcels-query', status: 'completed' }, { id: 'step-2', title: '查询发放', toolId: 'funds.paid-summary', status: 'waiting-input' }],
      clarification: { field: 'year', question: '请补充年份' },
      taskKind: 'file-recognition', artifactIds: ['file-1'], fileEntries: [{ id: 'file-1', fileName: '测试.xlsx' }],
      pendingAction: { id: 'action-1', type: 'resident_phone_update', before: { phone: '13800000000' }, after: { phone: '13900000000' } },
      permissionDecision: { allowed: true, permission: { module: 'personnel', action: 'update' } },
      confirmationHistory: [{ step: 1, label: '执行确认', confirmedAt: '2026-09-20T08:00:00.000Z' }],
      operationId: 'operation-1', verification: { passed: true, status: 'passed', message: '复核通过' },
    },
  });
  assert.equal(savedTask.status, 200);
  assert.deepEqual(savedTask.body.task.progress, { completed: 1, total: 2 });
  const restoredTasks = await request(url, '/ai/assistant/tasks?conversationId=conversation-unit-admin', { token: unitAdminLogin.body.token });
  assert.equal(restoredTasks.body.tasks[0].id, 'task-unit-admin');
  assert.equal(restoredTasks.body.tasks[0].pendingAction.type, 'resident_phone_update');
  assert.equal(restoredTasks.body.tasks[0].taskKind, 'file-recognition');
  assert.deepEqual(restoredTasks.body.tasks[0].artifactIds, ['file-1']);
  assert.equal(restoredTasks.body.tasks[0].fileEntries[0].fileName, '测试.xlsx');
  assert.equal(restoredTasks.body.tasks[0].permissionDecision.allowed, true);
  assert.equal(restoredTasks.body.tasks[0].confirmationHistory.length, 1);
  assert.equal(restoredTasks.body.tasks[0].operationId, 'operation-1');
  assert.equal(restoredTasks.body.tasks[0].verification.passed, true);
  const otherUsersTasks = await request(url, '/ai/assistant/tasks?conversationId=conversation-unit-admin', { token: memberLogin.body.token });
  assert.deepEqual(otherUsersTasks.body.tasks, []);

  const personalMemory = await request(url, '/ai/assistant/memories', {
    token: unitAdminLogin.body.token, method: 'POST', body: { scope: 'personal', content: '称呼我为李主任' },
  });
  assert.equal(personalMemory.status, 201);
  const unitMemory = await request(url, '/ai/assistant/memories', {
    token: unitAdminLogin.body.token, method: 'POST', body: { scope: 'organization', content: '承包费先核对各组固定总额' },
  });
  assert.equal(unitMemory.status, 201);
  const forbiddenUnitMemory = await request(url, '/ai/assistant/memories', {
    token: memberLogin.body.token, method: 'POST', body: { scope: 'organization', content: '成员不能直接发布单位规则' },
  });
  assert.equal(forbiddenUnitMemory.status, 403);
  const sensitiveMemory = await request(url, '/ai/assistant/memories', {
    token: unitAdminLogin.body.token, method: 'POST', body: { scope: 'personal', content: '记住手机号 13800000000' },
  });
  assert.equal(sensitiveMemory.status, 400);
  const memberMemories = await request(url, '/ai/assistant/memories', { token: memberLogin.body.token });
  assert.deepEqual(memberMemories.body.memories.map(item => item.content), ['承包费先核对各组固定总额']);
  const forbiddenDelete = await request(url, `/ai/assistant/memories/${personalMemory.body.memory.id}`, { token: memberLogin.body.token, method: 'DELETE' });
  assert.equal(forbiddenDelete.status, 403);
  const deletedPersonalMemory = await request(url, `/ai/assistant/memories/${personalMemory.body.memory.id}`, { token: unitAdminLogin.body.token, method: 'DELETE' });
  assert.equal(deletedPersonalMemory.status, 200);

  const emptyWorkspace = await request(url, '/unit/workspace/data', { token: memberLogin.body.token });
  assert.equal(emptyWorkspace.status, 200);
  const workspaceWrite = await request(url, '/unit/workspace/data', { token: memberLogin.body.token, method: 'PUT', body: { version: emptyWorkspace.body.version, data: { personnel: [{ name: '测试村民' }] } } });
  assert.equal(workspaceWrite.status, 200);
  const workspaceConflict = await request(url, '/unit/workspace/data', { token: memberLogin.body.token, method: 'PUT', body: { version: emptyWorkspace.body.version, data: {} } });
  assert.equal(workspaceConflict.status, 409);
  const disabledMember = await request(url, `/auth/unit/members/${reviewedMember.body.user.id}/status`, { token: unitAdminLogin.body.token, method: 'PUT', body: { isActive: false } });
  assert.equal(disabledMember.status, 200);
  assert.equal(disabledMember.body.user.isActive, false);
  const disabledLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13700137000', password: 'member88' } });
  assert.equal(disabledLogin.status, 403);
  const restoredMember = await request(url, `/auth/unit/members/${reviewedMember.body.user.id}/status`, { token: unitAdminLogin.body.token, method: 'PUT', body: { isActive: true } });
  assert.equal(restoredMember.status, 200);
  assert.equal(restoredMember.body.user.isActive, true);
  const reactivatedMemberLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13700137000', password: 'member88' } });
  assert.equal(reactivatedMemberLogin.status, 200);
  const invalidMemberStatus = await request(url, `/auth/unit/members/${reviewedMember.body.user.id}/status`, { token: unitAdminLogin.body.token, method: 'PUT', body: { isActive: 'yes' } });
  assert.equal(invalidMemberStatus.status, 400);

  const installerPath = path.join(directory, 'community-ai-management-system-0.3.1-arm64.dmg');
  await fs.writeFile(installerPath, 'test installer');
  const updateForm = new FormData();
  updateForm.set('version', '0.3.1');
  updateForm.set('platform', 'darwin-arm64');
  updateForm.set('channel', 'stable');
  updateForm.set('releaseNotes', '同步发布测试');
  updateForm.set('githubReleaseUrl', 'https://github.com/example/releases/tag/v0.3.1');
  updateForm.set('file', new Blob([await fs.readFile(installerPath)]), path.basename(installerPath));
  const published = await fetch(`${url}/api/update/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: updateForm,
  });
  assert.equal(published.status, 201);
  const publishedBody = await published.json();
  assert.equal(publishedBody.version.githubReleaseUrl, 'https://github.com/example/releases/tag/v0.3.1');

  const updateCheck = await request(url, '/update/check?version=0.3.0&platform=darwin-arm64');
  assert.equal(updateCheck.status, 200);
  assert.equal(updateCheck.body.latestVersion, '0.3.1');
  assert.equal(updateCheck.body.githubReleaseUrl, 'https://github.com/example/releases/tag/v0.3.1');

  const zipForm = new FormData();
  zipForm.set('version', '0.3.2');
  zipForm.set('platform', 'darwin-arm64');
  zipForm.set('packageType', 'zip');
  zipForm.set('file', new Blob(['zip update package']), 'community-ai-management-system-0.3.2-arm64.zip');
  const zipPublished = await fetch(`${url}/api/update/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: zipForm,
  });
  assert.equal(zipPublished.status, 201);
  const inAppCheck = await request(url, '/update/check?version=0.3.1&platform=darwin-arm64');
  assert.equal(inAppCheck.body.hasUpdate, true);
  assert.equal(inAppCheck.body.packageType, 'zip');
  assert.match(inAppCheck.body.fileSha512, /^[A-Za-z0-9+/]+=*$/u);
  const electronManifest = await fetch(`${url}/api/update/electron/latest-mac.yml?platform=darwin-arm64`);
  assert.equal(electronManifest.status, 200);
  const electronManifestText = await electronManifest.text();
  assert.match(electronManifestText, /version: 0\.3\.2/u);
  const downloadMatch = electronManifestText.match(/url: (\.\.\/download\/[^/]+\/[^\n]+\.zip)/u);
  assert.ok(downloadMatch, '应用内更新清单应提供以 ZIP 文件名结尾的下载地址');
  const inAppDownload = await fetch(new URL(downloadMatch[1], `${url}/api/update/electron/latest-mac.yml`));
  assert.equal(inAppDownload.status, 200);
  assert.equal(await inAppDownload.text(), 'zip update package');

  const oldWindowsBlockMap = zlib.gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', checksums: ['old'], sizes: [12] }] }));
  const oldWindowsForm = new FormData();
  oldWindowsForm.set('version', '0.3.1');
  oldWindowsForm.set('platform', 'win32-x64');
  oldWindowsForm.set('packageType', 'exe');
  oldWindowsForm.set('file', new Blob(['previous exe']), 'community-ai-management-system-0.3.1-win-x64.exe');
  oldWindowsForm.set('blockmap', new Blob([oldWindowsBlockMap]), 'community-ai-management-system-0.3.1-win-x64.exe.blockmap');
  const oldWindowsPublished = await fetch(`${url}/api/update/publish`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: oldWindowsForm,
  });
  assert.equal(oldWindowsPublished.status, 201);

  const newWindowsBlockMap = zlib.gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', checksums: ['new'], sizes: [19] }] }));
  const windowsForm = new FormData();
  windowsForm.set('version', '0.3.2');
  windowsForm.set('platform', 'win32-x64');
  windowsForm.set('packageType', 'exe');
  windowsForm.set('file', new Blob(['nsis update package']), 'community-ai-management-system-0.3.2-win-x64.exe');
  windowsForm.set('blockmap', new Blob([newWindowsBlockMap]), 'community-ai-management-system-0.3.2-win-x64.exe.blockmap');
  const windowsPublished = await fetch(`${url}/api/update/publish`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: windowsForm,
  });
  assert.equal(windowsPublished.status, 201);
  const windowsCheck = await request(url, '/update/check?version=0.3.1&platform=win32-x64');
  assert.equal(windowsCheck.body.hasUpdate, true);
  assert.equal(windowsCheck.body.packageType, 'exe');
  assert.match(windowsCheck.body.fileSha512, /^[A-Za-z0-9+/]+=*$/u);
  const windowsManifest = await fetch(`${url}/api/update/electron/latest.yml`);
  assert.equal(windowsManifest.status, 200);
  const windowsManifestText = await windowsManifest.text();
  assert.match(windowsManifestText, /version: 0\.3\.2/u);
  const windowsDownloadMatch = windowsManifestText.match(/url: (\.\.\/download\/[^/]+\/[^\n]+\.exe)/u);
  assert.ok(windowsDownloadMatch, 'Windows 更新清单应指向 NSIS 安装包');
  const windowsDownload = await fetch(new URL(windowsDownloadMatch[1], `${url}/api/update/electron/latest.yml`));
  assert.equal(windowsDownload.status, 200);
  assert.equal(await windowsDownload.text(), 'nsis update package');
  const windowsDownloadUrl = new URL(windowsDownloadMatch[1], `${url}/api/update/electron/latest.yml`);
  const newBlockMapResponse = await fetch(`${windowsDownloadUrl}.blockmap`);
  assert.equal(newBlockMapResponse.status, 200);
  assert.deepEqual(Buffer.from(await newBlockMapResponse.arrayBuffer()), newWindowsBlockMap);
  const oldBlockMapResponse = await fetch(`${windowsDownloadUrl.toString().replace('0.3.2', '0.3.1')}.blockmap`);
  assert.equal(oldBlockMapResponse.status, 200);
  assert.deepEqual(Buffer.from(await oldBlockMapResponse.arrayBuffer()), oldWindowsBlockMap);
  const singleRange = await fetch(windowsDownloadUrl, { headers: { Range: 'bytes=0-3' } });
  assert.equal(singleRange.status, 206);
  assert.equal(singleRange.headers.get('content-range'), 'bytes 0-3/19');
  assert.equal(singleRange.headers.get('accept-ranges'), 'bytes');
  assert.equal(await singleRange.text(), 'nsis');
  const multipleRanges = await fetch(windowsDownloadUrl, { headers: { Range: 'bytes=0-3,5-10' } });
  assert.equal(multipleRanges.status, 206);
  assert.match(multipleRanges.headers.get('content-type'), /^multipart\/byteranges; boundary=/u);
  const multipart = await multipleRanges.text();
  assert.match(multipart, /Content-Range: bytes 0-3\/19\r\n\r\nnsis\r\n/u);
  assert.match(multipart, /Content-Range: bytes 5-10\/19\r\n\r\nupdate\r\n/u);
  const invalidRange = await fetch(windowsDownloadUrl, { headers: { Range: 'bytes=999-1000' } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('content-range'), 'bytes */19');
  assert.equal((await (await fetch(`${url}/api/update/electron/latest-mac.yml`)).text()).includes('.exe'), false);

  const duplicateForm = new FormData();
  duplicateForm.set('version', '0.3.1');
  duplicateForm.set('platform', 'darwin-arm64');
  duplicateForm.set('file', new Blob(['duplicate installer']), 'duplicate.dmg');
  const duplicate = await fetch(`${url}/api/update/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: duplicateForm,
  });
  assert.equal(duplicate.status, 409);

  const page = await request(url, '/auth/users?keyword=139001&page=1&pageSize=10', { token: adminToken });
  assert.equal(page.status, 200);
  assert.equal(page.body.pagination.total, 1);
  assert.equal(page.body.users[0].id, registered.body.user.id);

  const reset = await request(url, `/auth/users/${registered.body.user.id}/reset-password`, { token: adminToken, method: 'POST', body: { newPassword: 'new-secret88' } });
  assert.equal(reset.status, 200);
  const userLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'new-secret88' } });
  assert.equal(userLogin.status, 200);

  const expiresAt = '2026-12-31T23:59:59.000Z';
  const entitlementUpdate = await request(url, `/auth/users/${registered.body.user.id}/entitlement`, { token: adminToken, method: 'PUT', body: { planType: 'expires', planExpiresAt: expiresAt, isActive: true } });
  assert.equal(entitlementUpdate.status, 200);
  const entitlement = await request(url, '/auth/entitlement', { token: userLogin.body.token });
  assert.equal(entitlement.status, 200);
  assert.equal(entitlement.body.plan, 'expires');
  assert.equal(entitlement.body.expiresAt, expiresAt);

  const adminDisabled = await request(url, `/auth/users/${registered.body.user.id}/entitlement`, { token: adminToken, method: 'PUT', body: { isActive: false } });
  assert.equal(adminDisabled.status, 200);
  const memberAfterAdminDisabled = await request(url, '/auth/entitlement', { token: memberLogin.body.token });
  assert.equal(memberAfterAdminDisabled.status, 401);
  const adminRestored = await request(url, `/auth/users/${registered.body.user.id}/entitlement`, { token: adminToken, method: 'PUT', body: { isActive: true } });
  assert.equal(adminRestored.status, 200);
  const restoredUnitAdminLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13900139000', password: 'new-secret88' } });
  assert.equal(restoredUnitAdminLogin.status, 200);

  const mockAiPort = await freePort();
  const mockAiUrl = `http://127.0.0.1:${mockAiPort}`;
  let aiRequestCount = 0;
  const mockAi = http.createServer(async (req, res) => {
    aiRequestCount += 1;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(body.model, 'demo-chat');
    assert.equal(body.messages[0].content, '请只回复：连接成功');
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer secret-api-key') {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: 'API 密钥无效' } }));
      return;
    }
    res.end(JSON.stringify({
      model: body.model,
      choices: [{ message: { content: '连接成功' } }],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    }));
  });
  await new Promise(resolve => mockAi.listen(mockAiPort, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mockAi.close(resolve)));

  const unauthorizedTest = await request(url, '/ai/providers/test', { method: 'POST', body: { baseUrl: `${mockAiUrl}/v1`, apiKey: 'secret-api-key', defaultModel: 'demo-chat' } });
  assert.equal(unauthorizedTest.status, 401);

  const unsavedTest = await request(url, '/ai/providers/test', { token: adminToken, method: 'POST', body: { baseUrl: `${mockAiUrl}/v1`, apiKey: 'secret-api-key', defaultModel: 'demo-chat' } });
  assert.equal(unsavedTest.status, 200);
  assert.equal(unsavedTest.body.success, true);
  assert.equal(unsavedTest.body.model, 'demo-chat');
  assert.equal(unsavedTest.body.totalTokens, 10);
  assert.equal(unsavedTest.body.reply, '连接成功');
  assert.equal(Object.hasOwn(unsavedTest.body, 'apiKey'), false);

  const invalidKeyTest = await request(url, '/ai/providers/test', { token: adminToken, method: 'POST', body: { baseUrl: `${mockAiUrl}/v1`, apiKey: 'wrong-secret', defaultModel: 'demo-chat' } });
  assert.equal(invalidKeyTest.status, 502);
  assert.match(invalidKeyTest.body.error, /API 密钥无效/u);

  const provider = await request(url, '/ai/providers', { token: adminToken, method: 'POST', body: { name: '测试模型', providerType: 'openai-compatible', baseUrl: `${mockAiUrl}/v1`, apiKey: 'secret-api-key', defaultModel: 'demo-chat', availableModels: ['demo-chat'] } });
  assert.equal(provider.status, 201);
  assert.equal(Object.hasOwn(provider.body.provider, 'apiKey'), false);
  assert.equal(provider.body.provider.hasApiKey, true);
  const savedProviderTest = await request(url, '/ai/providers/test', { token: adminToken, method: 'POST', body: { providerId: provider.body.provider.id, apiKey: '', defaultModel: 'demo-chat' } });
  assert.equal(savedProviderTest.status, 200);
  assert.equal(savedProviderTest.body.totalTokens, 10);
  assert.equal(aiRequestCount, 3);

  const ordinaryEstimate = await request(url, '/ai/estimate', {
    token: restoredUnitAdminLogin.body.token,
    method: 'POST',
    body: { messages: [{ role: 'user', content: '你好' }], taskTier: 'basic', taskKind: 'assistant-conversation' },
  });
  assert.equal(ordinaryEstimate.status, 200);
  assert.equal(ordinaryEstimate.body.highCost, false);
  assert.equal(ordinaryEstimate.body.requiresConfirmation, false);
  assert.equal(ordinaryEstimate.body.sufficient, true);
  assert.equal(ordinaryEstimate.body.totalTokens, 1005000);

  const documentEstimate = await request(url, '/ai/estimate', {
    token: restoredUnitAdminLogin.body.token,
    method: 'POST',
    body: { messages: [{ role: 'user', content: '根据这些材料起草一份证明' }], taskTier: 'deep', taskKind: 'document-draft' },
  });
  assert.equal(documentEstimate.status, 200);
  assert.equal(documentEstimate.body.highCost, true);
  assert.equal(documentEstimate.body.requiresConfirmation, true);
  assert.match(documentEstimate.body.reminderReason, /预计用量较高/u);

  const usageAfterProviderTests = await request(url, '/ai/usage/all?days=30', { token: adminToken });
  assert.equal(usageAfterProviderTests.body.stats.total_calls, 0);
  const auditAfterProviderTests = await request(url, '/auth/audit-logs', { token: adminToken });
  assert.doesNotMatch(JSON.stringify(auditAfterProviderTests.body), /secret-api-key|wrong-secret/u);

  const overview = await request(url, '/admin/overview', { token: adminToken });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.metrics.registeredUsers, 2);
  assert.equal(overview.body.metrics.activeProviders, 1);
  const staticPage = await fetch(`${url}/admin/`);
  assert.equal(staticPage.status, 200);
  assert.match(staticPage.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/u);
  const staticHtml = await staticPage.text();
  assert.match(staticHtml, /function bindDynamicActions\(\)/u);
  assert.match(staticHtml, /button\.removeAttribute\('onclick'\)/u);
  assert.match(staticHtml, /ai-quota-management\.js/u);
  assert.match(staticHtml, /id="testProvider"/u);
  assert.match(staticHtml, /window\.testSavedProvider/u);
  assert.match(staticHtml, />测试连接<\/button>/u);
  assert.match(staticHtml, /providerTestResult/u);
  assert.match(staticHtml, /\/ai\/providers\/test/u);
  assert.match(staticHtml, /id="supportsVision"/u);
  assert.match(staticHtml, /id="visionModel"/u);
  assert.match(staticHtml, /id="testVisionProvider"/u);
  assert.match(staticHtml, /账户安全/u);
  assert.match(staticHtml, /window\.deleteUser/u);
  assert.match(staticHtml, /window\.unlockLogin/u);
  const quotaPageScript = await fetch(`${url}/admin/ai-quota-management.js`);
  assert.equal(quotaPageScript.status, 200);
  assert.match(await quotaPageScript.text(), /AI 额度管理/u);

  const changedAdminPassword = await request(url, '/auth/password', { token: adminToken, method: 'PUT', body: { oldPassword: 'test-admin-working-pass', newPassword: 'admin-new-secret88' } });
  assert.equal(changedAdminPassword.status, 200);
  const staleAdminToken = await request(url, '/auth/users', { token: adminToken });
  assert.equal(staleAdminToken.status, 401);
  const refreshedAdminLogin = await request(url, '/auth/login', { method: 'POST', body: { phone: '13800000000', password: 'admin-new-secret88' } });
  assert.equal(refreshedAdminLogin.status, 200);

  const deletedMember = await request(url, `/auth/users/${reviewedMember.body.user.id}`, { token: refreshedAdminLogin.body.token, method: 'DELETE' });
  assert.equal(deletedMember.status, 200);
  const deletedMemberToken = await request(url, '/auth/entitlement', { token: reactivatedMemberLogin.body.token });
  assert.equal(deletedMemberToken.status, 401);
  const memberRecreation = await request(url, '/auth/unit/members', { token: restoredUnitAdminLogin.body.token, method: 'POST', body: { phone: '13700137000', name: '张成员再次开通', preset: 'custom' } });
  assert.equal(memberRecreation.status, 201);

  const deletedUnitAdmin = await request(url, `/auth/users/${registered.body.user.id}`, { token: refreshedAdminLogin.body.token, method: 'DELETE' });
  assert.equal(deletedUnitAdmin.status, 200);
  const deletedUnitAdminToken = await request(url, '/auth/entitlement', { token: restoredUnitAdminLogin.body.token });
  assert.equal(deletedUnitAdminToken.status, 401);
  const unitAdminReapplication = await request(url, '/auth/register', { method: 'POST', body: { phone: '13900139000', password: 'unit-new88', confirmPassword: 'unit-new88' } });
  assert.equal(unitAdminReapplication.status, 201);
});
