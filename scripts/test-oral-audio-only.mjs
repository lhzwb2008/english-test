/**
 * 用 wav + stream 调口语 Bot，打印 answer 原文（验证多模态音频）。
 * 依赖：tests/fixtures/oral_sample.wav
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const ORAL_BOT_ID = '7627028747031642150';
const WAV = path.join(ROOT, 'tests/fixtures/oral_sample.wav');

async function main() {
  if (!fs.existsSync(WAV)) {
    console.error('缺少', WAV);
    process.exit(1);
  }

  const client = new CozeAPI({
    token: process.env.COZE_API_TOKEN,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const up = await client.files.upload({ file: fs.createReadStream(WAV) });
  console.log('upload ok file_id=', up.id);

  const obj = [
    { type: 'text', text: '' },
    { type: 'audio', file_id: up.id },
  ];

  let convId;
  let chatId;
  for await (const evt of client.chat.stream({
    bot_id: ORAL_BOT_ID,
    user_id: 'api-oral-smoke',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify(obj),
        content_type: 'object_string',
      },
    ],
  })) {
    if (evt.event === ChatEventType.ERROR) {
      console.error('stream error', evt.data);
      process.exit(1);
    }
    const d = evt.data;
    // 仅用 chat.created / chat.completed 里的 id 作为 chat_id；delta 里的 id 是 message id，误用会导致 message/list 404
    if (
      (evt.event === ChatEventType.CONVERSATION_CHAT_CREATED ||
        evt.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) &&
      d?.conversation_id &&
      d?.id
    ) {
      convId = d.conversation_id;
      chatId = d.id;
    }
  }

  if (!convId || !chatId) {
    console.error('流结束仍未解析到 conversation_id / chat_id');
    process.exit(1);
  }

  const msgs = await client.chat.messages.list(convId, chatId);
  const answers = msgs.filter((m) => m.type === 'answer');
  const text = answers.map((m) => m.content).join('');
  console.log('\n--- answer raw ---\n');
  console.log(text);
  console.log('\n--- JSON parse try ---');
  try {
    const j = JSON.parse(text);
    console.log(JSON.stringify(j, null, 2));
    if (j.audio_received === false) {
      console.warn('\n[WARN] audio_received=false，模型认为未收到音频');
    }
  } catch (e) {
    console.error('parse fail:', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
