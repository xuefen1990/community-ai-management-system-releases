import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FoundationBusinessService } = require('../../src/main/foundation-business-service');
const root = process.env.FOUNDATION_UI_BASELINE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let data = { settings: { villageName: '合成数据测试社区' }, personnel: Array.from({ length: 10000 }, (_, i) => ({
  id: `synthetic-${i}`, name: `测试居民${i}`, idCard: `SYNTHETIC-${String(i).padStart(6, '0')}`,
  birth_date: '1980-01-01', gender: i % 2 ? '男' : '女', village_group: `测试${i % 8}组`,
  household_id: String(Math.floor(i / 4)).padStart(6, '0'), relation_to_head: i % 4 === 0 ? '户主' : '子',
  tags: i % 20 === 0 ? ['党员'] : [],
  ...(i < 1024 ? {
    disbursementHistory: [{ batchDate: '2026-09-06', categoryName: '固定工资', role: '东二组组长', amountCents: 240000, bankName: '交通银行', bankCard: '6222000000000731', paymentStatus: 'paid', batchId: 'workbench-synthetic-batch' }],
    residentOperationLog: [{ id: 'synthetic-operation', occurredAt: '2026-09-06T23:14:00Z', action: 'resident_phone_update', description: '已更新联系电话', sourceType: 'resident_profile_edit', recordId: 'resident-change-synthetic', status: 'completed' }],
    importSources: [{ sourceType: 'farmland_subsidy_import', recordId: 'farmland-subsidy-synthetic', importedAt: '2026-09-03T01:11:00Z', description: '土地补贴记录导入' }],
  } : {}),
})) };
const service = new FoundationBusinessService({ authorize: async () => {}, store: {
  read: async () => structuredClone(data),
  update: async mutator => { const draft = structuredClone(data); const result = await mutator(draft); data = draft; return { result }; },
} });
const requests = [];
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/fixture-db') {
      if (req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        data = JSON.parse(body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); return;
      }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data)); return;
    }
    if (req.url === '/fixture-api' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); requests.push({ method: input.method || 'GET', path: input.path });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(await service.request(input))); return;
    }
    const url = new URL(req.url, 'http://fixture.local');
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    const type = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)];
    res.setHeader('content-type', type || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(path.join(tmpdir(), 'community-foundation-ui-'));
const screenshot = path.join(profile, 'foundation.png');
const chrome = process.env.TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
{
  const mode = ['skin', 'performance', 'inventory', 'auth', 'forms', 'settings', 'menu', 'navigation', 'imports', 'interaction', 'certificate', 'drafting', 'child'].find(value => process.argv.includes(value)) || 'base';
  const child = spawn(chrome, ['--headless', '--use-mock-keychain', '--password-store=basic', '--disable-background-networking',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1600,1000', '--remote-debugging-pipe', 'about:blank'],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
  let nextId = 0, buffer = ''; const pending = new Map();
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString(); let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const result = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const waiting = pending.get(result.id); if (!waiting) continue;
      pending.delete(result.id); result.error ? waiting.reject(new Error(result.error.message)) : waiting.resolve(result.result);
    }
  });
  child.on('exit', () => { for (const wait of pending.values()) wait.reject(new Error('Chrome exited before completing performance test')); });
  const timer = setTimeout(() => child.kill('SIGTERM'), mode === 'skin' ? 120000 : 45000);
  try {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    await call('Page.enable', {}, sessionId);
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/app/tests/renderer/foundation-fixture.html?${mode}=1#/personnel` }, sessionId);
    let result;
    for (let attempt = 0; attempt < 140; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try { const response = await call('Runtime.evaluate', { expression: 'document.body?.dataset.testResult', returnByValue: true }, sessionId); if (response.result?.value) { result = JSON.parse(response.result.value); break; } } catch {}
    }
    if (!result) throw new Error('Performance test did not finish');
    if (mode === 'skin' && result.ok) {
      const evaluate = async expression => {
        const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
        return response.result.value;
      };
      result.skin = { environment: 'isolated headless Chrome, synthetic data', layouts: [], screenshots: [] };
      for (const [width, height, scale] of [[1600, 900, 1], [1080, 680, 1], [1280, 720, 1.25], [1067, 600, 1.5]]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
        const layout = await evaluate(`import('/app/tests/renderer/green-skin-scenarios.mjs').then(module => module.checkGreenSkinLayout(${width}, ${height}))`);
        result.skin.layouts.push(layout);
        for (const route of ['/overview', '/personnel', '/village-duty', '/drafting']) {
          await evaluate(`import('/app/tests/renderer/green-skin-scenarios.mjs').then(module => module.openGreenSkinRoute(${JSON.stringify(route)}))`);
          const capture = await call('Page.captureScreenshot', { format: 'png' }, sessionId);
          const target = path.join(profile, `skin-${width}x${height}-${route.slice(1)}.png`);
          await writeFile(target, Buffer.from(capture.data, 'base64'));
          result.skin.screenshots.push(target);
        }
      }
      await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      result.skin.compatibility = await evaluate("import('/app/tests/renderer/green-skin-scenarios.mjs').then(module => module.checkGreenSkinCompatibility())");
      await evaluate("import('/app/tests/renderer/green-skin-scenarios.mjs').then(module => module.openGreenSkinRoute('/overview'))");
    }
    if(mode==='interaction'&&result.ok){
      const evaluate=async expression=>{const response=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(response.exceptionDetails)throw Error(response.exceptionDetails.text);return response.result.value;};
      const rect=await evaluate("(()=>{const r=document.querySelector('#aiCopilotToggleBtn').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:innerWidth-r.right,bottom:innerHeight-r.bottom}})()");
      if(Math.abs(rect.right-24)>2||Math.abs(rect.bottom-24)>2)throw Error('AI launcher initial position is not bottom right');
      const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1},sessionId);
      for(let i=1;i<=8;i++)await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:x-i*30,y:y-i*15,button:'left',buttons:1},sessionId);
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:x-240,y:y-120,button:'left',clickCount:1},sessionId);
      const moved=await evaluate("(()=>{const e=document.querySelector('#aiCopilotToggleBtn'),r=e.getBoundingClientRect();return{x:r.x,y:r.y,open:e.getAttribute('aria-expanded')}})()");
      if(Math.abs(moved.x-rect.x)<200||moved.open!=='false')throw Error('Dragging did not move launcher or incorrectly opened chat');
      await evaluate("document.querySelector('#aiCopilotToggleBtn').click()");
      if(!await evaluate("document.querySelector('#aiCopilotToggleBtn').getAttribute('aria-expanded')==='true'"))throw Error('Launcher click did not open chat');
      await evaluate("document.querySelector('#aiCopilotCloseBtn').click();document.querySelector('#aiCopilotToggleBtn').click()");
      if(!await evaluate("Math.abs(document.querySelector('#aiCopilotToggleBtn').getBoundingClientRect().x-"+moved.x+")<2"))throw Error('Close/open lost current position');
      await evaluate("document.querySelector('#aiCopilotCloseBtn').click()");
      await call('Page.reload',{},sessionId);
      let completed=false;
      for(let attempt=0;attempt<110;attempt++){await new Promise(resolve=>setTimeout(resolve,200));try{const value=await evaluate('document.body?.dataset.testResult');if(value){const again=JSON.parse(value);if(!again.ok)throw Error(again.error);completed=true;break;}}catch(error){if(error.message!=='Cannot find context with specified id')throw error;}}
      if(!completed)throw Error('Reload did not complete interaction checks');
      if(!await evaluate("(()=>{const e=document.querySelector('#aiCopilotToggleBtn'),r=e.getBoundingClientRect();return !e.style.left&&Math.abs(innerWidth-r.right-24)<2&&Math.abs(innerHeight-r.bottom-24)<2})()"))throw Error('Reload must reset launcher to bottom right');
      result.floatingInteraction={nativePointerDrag:true,noClickAfterDrag:true,reopenKeepsPosition:true,reloadResetsBottomRight:true};
      await evaluate("document.querySelector('[data-testid=\"accounts-person-synthetic-0\"]').click()");
      await evaluate("new Promise(resolve=>setTimeout(resolve,900))");
      const editorImage=await call('Page.captureScreenshot',{format:'png'},sessionId);result.editorScreenshot=path.join(profile,'resident-editor.png');await writeFile(result.editorScreenshot,Buffer.from(editorImage.data,'base64'));
      await evaluate("document.querySelector('.person-form-el-dialog .el-dialog__headerbtn').click()");await evaluate("new Promise(resolve=>setTimeout(resolve,300))");
      await evaluate("import('/app/src/renderer/foundation/bootstrap.mjs').then(async({foundation})=>{await foundation.router.push('/assistant-records');await new Promise(resolve=>setTimeout(resolve,400));document.querySelector('.ai-operation-details').click();await new Promise(resolve=>setTimeout(resolve,250));})");
      const recordsImage=await call('Page.captureScreenshot',{format:'png'},sessionId);result.recordsScreenshot=path.join(profile,'ai-records.png');await writeFile(result.recordsScreenshot,Buffer.from(recordsImage.data,'base64'));
      await evaluate("import('/app/src/renderer/foundation/bootstrap.mjs').then(async({foundation})=>{await foundation.router.push('/personnel');document.querySelector('#aiCopilotToggleBtn').click();await new Promise(resolve=>setTimeout(resolve,400));})");
    }
    const capture = await call('Page.captureScreenshot', { format: 'png' }, sessionId); await writeFile(screenshot, Buffer.from(capture.data, 'base64'));
    console.log(JSON.stringify({ ...result, screenshot, requests })); if (!result.ok) process.exitCode = 1;
  } finally { clearTimeout(timer); child.kill('SIGTERM'); server.closeAllConnections(); server.close(); }
}
