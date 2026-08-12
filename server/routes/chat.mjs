import { Router } from 'express';
import { getBot } from '../qwen/botRegistry.mjs';
import { streamQwenText } from '../qwen/client.mjs';
import { detectAudioFormat, getFile } from '../lib/fileStore.mjs';
import { genId, nowUnix } from '../lib/ids.mjs';
import { initSse, writeSseEvent } from '../lib/sse.mjs';
import {
  detectOralExamStandard,
  enrichOralExamRubricText,
  examStandardForcePrompt,
} from '../lib/oralExamEnrich.mjs';

const router = Router();

/**
 * 解析 additional_messages 中的 object_string
 * @returns {{ userText: string, audioFileId: string | null, hasAudio: boolean }}
 */
function parseObjectString(additionalMessages = []) {
  const userMsg =
    [...additionalMessages].reverse().find((m) => m.role === 'user') ||
    additionalMessages[additionalMessages.length - 1];

  if (!userMsg) {
    return { userText: '', audioFileId: null, hasAudio: false };
  }

  if (userMsg.content_type !== 'object_string') {
    return {
      userText: typeof userMsg.content === 'string' ? userMsg.content : '',
      audioFileId: null,
      hasAudio: false,
    };
  }

  let parts = [];
  try {
    parts = JSON.parse(userMsg.content);
  } catch {
    throw new Error('object_string content 不是合法 JSON 数组');
  }

  const textPart = parts.find((p) => p.type === 'text');
  const audioPart = parts.find((p) => p.type === 'audio');
  return {
    userText: textPart?.text ?? '',
    audioFileId: audioPart?.file_id ?? null,
    hasAudio: Boolean(audioPart),
  };
}

function mapUsage(usage) {
  if (!usage) {
    return {
      token_count: 0,
      input_count: 0,
      output_count: 0,
    };
  }
  return {
    token_count: usage.total_tokens ?? 0,
    input_count: usage.prompt_tokens ?? 0,
    output_count: usage.completion_tokens ?? 0,
  };
}

async function handleStreamChat(req, res, body) {
  const bot = getBot(body.bot_id);
  if (!bot) {
    return res.status(404).json({
      code: 4200,
      msg: `未知 bot_id: ${body.bot_id}`,
    });
  }

  let parsed;
  try {
    parsed = parseObjectString(body.additional_messages);
  } catch (err) {
    return res.status(400).json({
      code: 4000,
      msg: err.message,
    });
  }

  if (!parsed.hasAudio || !parsed.audioFileId) {
    return res.status(400).json({
      code: 4000,
      msg: '当前 Qwen 代理仅支持含 audio 的 object_string 请求',
    });
  }

  const fileMeta = getFile(parsed.audioFileId);
  if (!fileMeta) {
    return res.status(404).json({
      code: 4004,
      msg: `file_id 不存在或已过期: ${parsed.audioFileId}`,
    });
  }

  const conversationId =
    req.query.conversation_id || body.conversation_id || genId('conv_');
  const chatId = genId('chat_');
  const messageId = genId('msg_');
  const botId = body.bot_id;
  const createdAt = nowUnix();

  initSse(res);

  const chatBase = {
    id: chatId,
    conversation_id: conversationId,
    bot_id: botId,
    created_at: createdAt,
  };

  writeSseEvent(res, 'conversation.chat.created', {
    ...chatBase,
    status: 'created',
  });
  writeSseEvent(res, 'conversation.chat.in_progress', {
    ...chatBase,
    status: 'in_progress',
  });

  try {
    const audioFormat = detectAudioFormat(fileMeta.filename);
    const examHint = detectOralExamStandard(parsed.userText);
    const systemPrompt = examHint
      ? `${bot.systemPrompt || ''}${examStandardForcePrompt(examHint)}`
      : bot.systemPrompt;

    const { fullText, usage } = await streamQwenText({
      model: bot.model,
      systemPrompt,
      userText: parsed.userText,
      audioBuffer: fileMeta.buffer,
      audioFormat,
      onDelta: (delta) => {
        writeSseEvent(res, 'conversation.message.delta', {
          id: messageId,
          conversation_id: conversationId,
          bot_id: botId,
          chat_id: chatId,
          role: 'assistant',
          type: 'answer',
          content_type: 'text',
          content: delta,
          created_at: createdAt,
          updated_at: nowUnix(),
        });
      },
    });

    const content = enrichOralExamRubricText(fullText, examHint);

    writeSseEvent(res, 'conversation.message.completed', {
      id: messageId,
      conversation_id: conversationId,
      bot_id: botId,
      chat_id: chatId,
      role: 'assistant',
      type: 'answer',
      content_type: 'text',
      content,
      created_at: createdAt,
      updated_at: nowUnix(),
    });

    writeSseEvent(res, 'conversation.chat.completed', {
      ...chatBase,
      status: 'completed',
      completed_at: nowUnix(),
      usage: mapUsage(usage),
    });
    writeSseEvent(res, 'done', '[DONE]');
    res.end();
  } catch (err) {
    console.error('[chat stream error]', err);
    writeSseEvent(res, 'conversation.chat.failed', {
      ...chatBase,
      status: 'failed',
      last_error: {
        code: 5000,
        msg: err.message || 'Qwen 调用失败',
      },
    });
    writeSseEvent(res, 'error', {
      code: 5000,
      msg: err.message || 'Qwen 调用失败',
    });
    writeSseEvent(res, 'done', '[DONE]');
    res.end();
  }
}

router.post('/', async (req, res) => {
  const body = req.body || {};
  const { stream, additional_messages: additionalMessages } = body;

  let hasAudio = false;
  try {
    hasAudio = parseObjectString(additionalMessages).hasAudio;
  } catch (err) {
    return res.status(400).json({ code: 4000, msg: err.message });
  }

  if (hasAudio && stream !== true) {
    return res.status(400).json({
      code: 4000,
      msg: '含 audio 的消息必须使用 stream: true',
    });
  }

  if (stream === true) {
    return handleStreamChat(req, res, body);
  }

  return res.status(501).json({
    code: 5010,
    msg: '当前 Qwen 代理仅实现 stream: true 的音频对话',
  });
});

export default router;
