import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { ChatStatus, RoleType } from '@coze/api';
import { getCozeClient } from './coze.js';
import {
  readRegistry,
  writeRegistry,
  readPromptFile,
  writePromptFile,
} from './promptStore.js';

const PORT = Number(process.env.PORT) || 3847;
const token = process.env.COZE_API_TOKEN || '';
const baseURL =
  process.env.COZE_BASE_URL || 'https://api.coze.cn';
const debugUserId =
  process.env.COZE_DEBUG_USER_ID || 'local-dev-user';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(token),
    baseURL,
  });
});

app.get('/api/agents', async (_req, res, next) => {
  try {
    const reg = await readRegistry();
    res.json(reg);
  } catch (e) {
    next(e);
  }
});

app.post('/api/agents', async (req, res, next) => {
  try {
    const { botId, name, notes } = req.body || {};
    if (!botId || typeof botId !== 'string') {
      res.status(400).json({ error: '需要 botId（字符串）' });
      return;
    }
    const reg = await readRegistry();
    if (reg.agents.some((a) => a.botId === botId)) {
      res.status(409).json({ error: '该 botId 已存在' });
      return;
    }
    reg.agents.push({
      botId,
      name: name || botId,
      notes: notes || '',
      updatedAt: new Date().toISOString(),
    });
    await writeRegistry(reg);
    await writePromptFile(botId, '');
    res.status(201).json(reg);
  } catch (e) {
    next(e);
  }
});

app.delete('/api/agents/:botId', async (req, res, next) => {
  try {
    const { botId } = req.params;
    const reg = await readRegistry();
    const idx = reg.agents.findIndex((a) => a.botId === botId);
    if (idx === -1) {
      res.status(404).json({ error: '未找到' });
      return;
    }
    reg.agents.splice(idx, 1);
    await writeRegistry(reg);
    res.json(reg);
  } catch (e) {
    next(e);
  }
});

app.get('/api/prompts/:botId', async (req, res, next) => {
  try {
    const { botId } = req.params;
    const text = await readPromptFile(botId);
    res.json({ botId, text });
  } catch (e) {
    next(e);
  }
});

app.put('/api/prompts/:botId', async (req, res, next) => {
  try {
    const { botId } = req.params;
    const { text } = req.body || {};
    if (typeof text !== 'string') {
      res.status(400).json({ error: '需要 text 字符串' });
      return;
    }
    await writePromptFile(botId, text);
    const reg = await readRegistry();
    const agent = reg.agents.find((a) => a.botId === botId);
    if (agent) {
      agent.updatedAt = new Date().toISOString();
      await writeRegistry(reg);
    }
    res.json({ ok: true, botId });
  } catch (e) {
    next(e);
  }
});

app.post('/api/debug/chat', async (req, res, next) => {
  try {
    const client = getCozeClient({ token, baseURL });
    const { botId, message, userId } = req.body || {};
    if (!botId || typeof botId !== 'string') {
      res.status(400).json({ error: '需要 botId' });
      return;
    }
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: '需要 message' });
      return;
    }

    const result = await client.chat.createAndPoll({
      bot_id: botId,
      user_id: userId || debugUserId,
      additional_messages: [
        {
          role: RoleType.User,
          content: message,
          content_type: 'text',
        },
      ],
    });

    const status = result.chat?.status;
    const messages = result.messages || [];
    const answers = messages.filter((m) => m.type === 'answer');
    const reply =
      answers.map((m) => m.content).join('\n') ||
      [...messages]
        .reverse()
        .find((m) => m.role === RoleType.Assistant)?.content ||
      '';

    res.json({
      chatId: result.chat?.id,
      conversationId: result.chat?.conversation_id,
      status,
      ok: status === ChatStatus.COMPLETED,
      reply,
      messages,
      usage: result.chat?.usage,
      lastError: result.chat?.last_error,
    });
  } catch (e) {
    next(e);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const msg = err?.message || String(err);
  const code =
    err?.status ||
    err?.statusCode ||
    err?.response?.status ||
    (msg.includes('401') ? 401 : null) ||
    500;
  res.status(code >= 400 && code < 600 ? code : 500).json({
    error: msg,
    detail: err?.body ?? err?.response?.data,
  });
});

app.listen(PORT, () => {
  console.log(`Coze prompt lab API http://127.0.0.1:${PORT}`);
  if (!token) {
    console.warn('警告: 未设置 COZE_API_TOKEN，调试接口将不可用');
  }
});
