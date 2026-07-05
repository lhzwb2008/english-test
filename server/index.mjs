import 'dotenv/config';
import express from 'express';
import { requireBearer } from './lib/auth.mjs';
import { listBots } from './qwen/botRegistry.mjs';
import filesRouter from './routes/files.mjs';
import chatRouter from './routes/chat.mjs';

const app = express();
const port = Number(process.env.QWEN_PROXY_PORT || 8787);

app.use(express.json({ limit: '2mb' }));
app.use(requireBearer);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    provider: 'qwen-omni-proxy',
    bots: listBots().map((b) => ({ name: b.name, bot_id: b.bot_id })),
  });
});

app.use('/v1/files', filesRouter);
app.use('/v3/chat', chatRouter);

app.use((_req, res) => {
  res.status(404).json({ code: 4040, msg: 'not found' });
});

app.listen(port, () => {
  console.log(`[qwen-proxy] listening on http://127.0.0.1:${port}`);
  console.log('[qwen-proxy] bots:', listBots().map((b) => b.bot_id).join(', '));
});
