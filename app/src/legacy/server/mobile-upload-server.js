const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let serverInstance = null;
let activePort = 9898;
let tempUploadsDir = '';

// 获取本机所有局域网 IPv4 地址
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      // 过滤 IPv4, 非回环, 非内部
      if ((alias.family === 'IPv4' || alias.family === 4) && alias.address !== '127.0.0.1' && !alias.internal) {
        ips.push(alias.address);
      }
    }
  }
  return ips;
}

// 统一向前端/手机返回 JSON
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET'
  });
  res.end(JSON.stringify(data));
}

// 读取 POST 请求体
function readRequestBody(req, limitBytes = 150 * 1024 * 1024) { // 支持最大 150MB 照片或短视频上传
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error('上传文件数据量过大（单个文件上限 150MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('请求体 JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

// 处理 HTTP 请求
async function requestHandler(req, res) {
  // 处理跨域预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'OPTIONS, POST, GET'
    });
    res.end();
    return;
  }

  const url = req.url;
  const method = req.method;

  try {
    // 1. 静态网页服务
    if ((url === '/' || url.startsWith('/mobile_upload.html') || url.startsWith('/mobile_upload.html?')) && method === 'GET') {
      const htmlPath = path.join(__dirname, '../mobile_upload.html');
      if (fs.existsSync(htmlPath)) {
        try {
          const htmlContent = fs.readFileSync(htmlPath);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlContent);
        } catch (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`读取 mobile_upload.html 失败: ${readErr.message}`);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('mobile_upload.html 文件不存在，请确保文件已放置于应用根目录。');
      }
      return;
    }

    if (url.startsWith('/mobile_voice.html') && method === 'GET') {
      const htmlPath = path.join(__dirname, '../mobile_voice.html');
      if (fs.existsSync(htmlPath)) {
        try {
          const htmlContent = fs.readFileSync(htmlPath);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(htmlContent);
        } catch (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`读取 mobile_voice.html 失败: ${readErr.message}`);
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('mobile_voice.html 文件不存在。');
      }
      return;
    }

    // 2. 接收手机语音口述并发起电脑 AI 意图解析
    if (url.startsWith('/api/voice-input') && method === 'POST') {
      const body = await readRequestBody(req);
      const { text } = body;
      
      if (!text || !text.trim()) {
        return sendJson(res, 400, { error: '未接收到有效口述文本' });
      }

      const requestId = 'VR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      
      // 挂起 HTTP 请求等待电脑端 AI 解析
      pendingVoiceRequests.set(requestId, res);

      // 设置 15 秒超时自动解开
      setTimeout(() => {
        if (pendingVoiceRequests.has(requestId)) {
          const pendingRes = pendingVoiceRequests.get(requestId);
          pendingVoiceRequests.delete(requestId);
          sendJson(pendingRes, 500, { error: '电脑端 AI 解析超时，请确认电脑已开启 Ollama 并下载了 Gemma:2b 模型' });
        }
      }, 15000);

      const { getMainWindow } = require('../main.js');
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mobile-voice-parse-request', { requestId, text });
      } else {
        pendingVoiceRequests.delete(requestId);
        return sendJson(res, 500, { error: '电脑主窗口未就绪' });
      }
      return;
    }

    // 3. 接收手机端核对授权后的入库确认指令
    if (url.startsWith('/api/voice-confirm') && method === 'POST') {
      const body = await readRequestBody(req);
      const { getMainWindow } = require('../main.js');
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mobile-voice-confirm-save', body);
        return sendJson(res, 200, { success: true });
      } else {
        return sendJson(res, 500, { error: '电脑主窗口未就绪' });
      }
    }

    // 3. 接收手机拍照上传接口
    if (url.startsWith('/api/upload') && method === 'POST') {
      const body = await readRequestBody(req);
      const { image, filename, ownerType, ownerKey } = body;

      if (!image || !image.includes(';base64,')) {
        return sendJson(res, 400, { error: '未接收到有效的图片数据' });
      }

      // 提取 base64 纯图片数据
      const base64Data = image.split(';base64,').pop();
      const buffer = Buffer.from(base64Data, 'base64');

      // 确保临时接收文件夹存在
      if (!fs.existsSync(tempUploadsDir)) {
        fs.mkdirSync(tempUploadsDir, { recursive: true });
      }

      // 生成带时间戳的安全文件名，避免重名覆盖
      const fileExt = path.extname(filename || 'upload.jpg') || '.jpg';
      const cleanBaseName = path.basename(filename || 'photo', fileExt).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '');
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const newFilename = `手机上传_${timestamp}_${cleanBaseName}${fileExt}`;
      const savePath = path.join(tempUploadsDir, newFilename);

      // 写文件
      fs.writeFileSync(savePath, buffer);

      // 通知 Electron 渲染进程 (前端)
      const { getMainWindow } = require('../main.js');
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mobile-file-uploaded', {
          tempPath: savePath,
          filename: newFilename,
          ownerType: ownerType || '未关联',
          ownerKey: ownerKey || ''
        });
      }

      return sendJson(res, 200, { success: true, filename: newFilename, path: savePath });
    }

    // 3. 其他请求返回 404
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (error) {
    console.error('Mobile upload server error:', error);
    sendJson(res, 500, { error: error.message });
  }
}

// 启动局域网上传服务
function startUploadServer(databaseDir) {
  stopUploadServer();

  // 初始化临时上传文件夹路径
  tempUploadsDir = path.join(databaseDir, 'TempUploads');
  if (!fs.existsSync(tempUploadsDir)) {
    fs.mkdirSync(tempUploadsDir, { recursive: true });
  }

  return new Promise((resolve) => {
    function tryListen(port) {
      const server = http.createServer(requestHandler);
      
      server.once('error', err => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[Mobile Server] 端口 ${port} 被占用，尝试递增 ${port + 1}...`);
          tryListen(port + 1);
        } else {
          console.error('[Mobile Server] 服务启动出错：', err);
          resolve(false);
        }
      });

      server.listen(port, '0.0.0.0', () => {
        serverInstance = server;
        activePort = port;
        console.log(`[Mobile Server] 手机拍照上传局域网服务启动成功！运行端口：${activePort}`);
        resolve(true);
      });
    }

    tryListen(9898); // 默认从 9898 起听
  });
}

// 停止服务
function stopUploadServer() {
  if (serverInstance) {
    try {
      serverInstance.close();
      console.log('[Mobile Server] 手机上传局域网服务已成功关闭。');
    } catch (err) {
      console.error('[Mobile Server] 关闭服务失败：', err);
    }
    serverInstance = null;
  }
}

// 获取当前服务信息
function getServerInfo() {
  return {
    running: serverInstance !== null,
    port: activePort,
    ips: getLocalIPs()
  };
}

// 挂起中的口述解析 HTTP 请求响应句柄
const pendingVoiceRequests = new Map();

function resolveVoiceParseResult(requestId, parsedData, errorMsg) {
  if (pendingVoiceRequests.has(requestId)) {
    const res = pendingVoiceRequests.get(requestId);
    pendingVoiceRequests.delete(requestId);
    if (errorMsg) {
      sendJson(res, 500, { error: errorMsg });
    } else {
      sendJson(res, 200, { success: true, parsedData });
    }
  }
}

module.exports = {
  startUploadServer,
  stopUploadServer,
  getServerInfo,
  resolveVoiceParseResult
};
