/**
 * 调用口语评测 Bot，统计 SSE 事件，特别是 conversation.audio.delta（助手 TTS 分片）
 * 用法: node scripts/debug-oral-audio.mjs [file_id]
 */
import 'dotenv/config';
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const ORAL_BOT_ID = '7627028747031642150';
const FILE_ID = process.argv[2] || '7629257269041676329';

const token = process.env.COZE_API_TOKEN;
if (!token) throw new Error('缺少 COZE_API_TOKEN');

const client = new CozeAPI({
  token,
  baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
});

const stats = {
  eventCounts: {},
  audioDeltaCount: 0,
  audioDeltaBytesBase64: 0,
  textDeltaChars: 0,
  answerChars: 0,
  firstEventAt: 0,
  lastEventAt: 0,
  audioFirstAt: 0,
  audioLastAt: 0,
};

const t0 = Date.now();
let convId, chatId;

console.log('[start] bot=', ORAL_BOT_ID, 'file_id=', FILE_ID);

const stream = await client.chat.stream({
  bot_id: ORAL_BOT_ID,
  user_id: 'debug-oral-audio',
  additional_messages: [
    {
      role: RoleType.User,
      content_type: 'object_string',
      content: JSON.stringify([
        { type: 'text', text: '请仅输出 JSON 口语批改结果。' },
        { type: 'audio', file_id: FILE_ID },
      ]),
    },
  ],
});

for await (const evt of stream) {
  const now = Date.now() - t0;
  if (!stats.firstEventAt) stats.firstEventAt = now;
  stats.lastEventAt = now;
  const name = evt.event || 'unknown';
  stats.eventCounts[name] = (stats.eventCounts[name] || 0) + 1;

  const data = evt.data || {};
  const ct = data.content_type;
  const content = data.content;

  if (ct === 'audio' || name === 'conversation.audio.delta' || name.includes('audio')) {
    stats.audioDeltaCount += 1;
    if (typeof content === 'string') stats.audioDeltaBytesBase64 += content.length;
    if (!stats.audioFirstAt) stats.audioFirstAt = now;
    stats.audioLastAt = now;
    if (stats.audioDeltaCount <= 2) {
      const shallow = { ...data, content: typeof content === 'string' ? `[base64 ${content.length} chars]` : content };
      console.log(`[audio sample #${stats.audioDeltaCount}]`, JSON.stringify(shallow, null, 2));
    }
  } else if (name === 'conversation.message.delta' && data.type === 'answer') {
    if (typeof content === 'string') stats.textDeltaChars += content.length;
  } else if (name === 'conversation.message.completed' && data.type === 'answer') {
    if (typeof content === 'string') stats.answerChars += content.length;
  }

  if (name === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
    convId = data.conversation_id;
    chatId = data.id;
  }
  if (name === 'conversation.chat.failed' || name.endsWith('.failed') || name === 'error') {
    console.log('[failed event]', JSON.stringify(data, null, 2));
  }
}

const totalMs = Date.now() - t0;
console.log('\n=== 统计 ===');
console.log('总耗时(ms):', totalMs);
console.log('事件计数:', stats.eventCounts);
console.log('audio delta 数量:', stats.audioDeltaCount);
console.log('audio delta base64 总长度(字符):', stats.audioDeltaBytesBase64);
console.log('  ≈ 解码后字节:', Math.floor(stats.audioDeltaBytesBase64 * 3 / 4));
console.log('  ≈ MB:', (stats.audioDeltaBytesBase64 * 3 / 4 / 1024 / 1024).toFixed(2));
console.log('audio 首次/末次出现(ms):', stats.audioFirstAt, '/', stats.audioLastAt);
console.log('audio 流持续(ms):', stats.audioLastAt - stats.audioFirstAt);
console.log('answer 文本累计:', stats.textDeltaChars, '完成态 answer 长度:', stats.answerChars);
console.log('conv/chat:', convId, chatId);
