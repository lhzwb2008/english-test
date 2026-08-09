import 'dotenv/config';
import express from 'express';
import { listBots } from './qwen/botRegistry.mjs';
import filesRouter from './routes/files.mjs';
import chatRouter from './routes/chat.mjs';
import grammarRouter from './routes/grammar.mjs';

const app = express();
const port = Number(process.env.QWEN_PROXY_PORT || 8787);

// 业务侧无需传 token：鉴权由服务器侧维护（内网/安全组限制访问来源），
// DASHSCOPE_API_KEY 也只在服务端持有，不对外暴露。
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    provider: 'qwen-omni-proxy',
    bots: listBots().map((b) => ({ name: b.name, bot_id: b.bot_id })),
    endpoints: [
      'POST /v1/files/upload',
      'POST /v3/chat',
      'POST /v1/grammar/assess',
      'POST /v1/grammar/drill',
    ],
    text_model: process.env.QWEN_TEXT_MODEL || 'qwen3.8-max',
  });
});

app.use('/v1/files', filesRouter);
app.use('/v3/chat', chatRouter);
app.use('/v1/grammar', grammarRouter);

app.use((_req, res) => {
  res.status(404).json({ code: 4040, msg: 'not found' });
});

app.listen(port, () => {
  console.log(`[qwen-proxy] listening on http://127.0.0.1:${port}`);
  console.log('[qwen-proxy] bots:', listBots().map((b) => b.bot_id).join(', '));
  console.log(
    '[qwen-proxy] text model:',
    process.env.QWEN_TEXT_MODEL || 'qwen3.8-max',
  );
});
