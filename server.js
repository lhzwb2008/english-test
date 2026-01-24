/**
 * 豆包实时语音 API 代理服务器
 * 由于浏览器 WebSocket 不支持自定义 headers，需要通过后端代理转发
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

// 配置
const CONFIG = {
  appId: process.env.DOUBAO_APP_ID || '6562502703',
  accessToken: process.env.DOUBAO_ACCESS_TOKEN || 'izP6RKAM-KuvGM2YMQPGlsDBUSMxbFcp',
  resourceId: 'volc.speech.dialog',
  appKey: 'PlgvMymc7f3tQnJ6',
};

const DOUBAO_WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';

// 创建 HTTP 服务器
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

// 创建 WebSocket 服务器
const wss = new WebSocketServer({ server, path: '/ws' });

// 生成 UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

wss.on('connection', (clientWs, req) => {
  console.log('[Proxy] Client connected');
  
  let doubaoWs = null;
  let doubaoReady = false;
  let pendingMessages = [];
  
  // 连接到豆包 API
  const connectId = generateUUID();
  
  doubaoWs = new WebSocket(DOUBAO_WS_URL, {
    headers: {
      'X-Api-App-ID': CONFIG.appId,
      'X-Api-Access-Key': CONFIG.accessToken,
      'X-Api-Resource-Id': CONFIG.resourceId,
      'X-Api-App-Key': CONFIG.appKey,
      'X-Api-Connect-Id': connectId,
    },
  });

  doubaoWs.binaryType = 'arraybuffer';

  doubaoWs.on('open', () => {
    console.log('[Proxy] Connected to Doubao API');
    doubaoReady = true;
    
    // 发送所有待处理的消息
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift();
      console.log('[Proxy] Sending pending message, length:', msg.length);
      doubaoWs.send(msg);
    }
  });

  doubaoWs.on('message', (data) => {
    // 转发豆包的响应给客户端
    if (clientWs.readyState === WebSocket.OPEN) {
      const buf = Buffer.from(data);
      console.log('[Proxy] Forwarding to client, length:', buf.length, 'first bytes:', buf.slice(0, 8).toString('hex'));
      clientWs.send(data);
    }
  });

  doubaoWs.on('close', (code, reason) => {
    console.log('[Proxy] Doubao connection closed:', code, reason.toString());
    doubaoReady = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  doubaoWs.on('error', (error) => {
    console.error('[Proxy] Doubao error:', error.message);
    doubaoReady = false;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  // 转发客户端消息到豆包
  clientWs.on('message', (data) => {
    const buf = Buffer.from(data);
    console.log('[Proxy] Received from client, length:', buf.length, 'first bytes:', buf.slice(0, 8).toString('hex'));
    
    if (doubaoReady && doubaoWs.readyState === WebSocket.OPEN) {
      doubaoWs.send(data);
    } else {
      console.log('[Proxy] Doubao not ready, queueing message');
      pendingMessages.push(data);
    }
  });

  clientWs.on('close', () => {
    console.log('[Proxy] Client disconnected');
    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
      doubaoWs.close();
    }
  });

  clientWs.on('error', (error) => {
    console.error('[Proxy] Client error:', error.message);
    if (doubaoWs && doubaoWs.readyState === WebSocket.OPEN) {
      doubaoWs.close();
    }
  });
});

const PORT = process.env.PROXY_PORT || 3001;

server.listen(PORT, () => {
  console.log(`[Proxy] WebSocket proxy server running on ws://localhost:${PORT}/ws`);
  console.log(`[Proxy] Health check: http://localhost:${PORT}/health`);
});
