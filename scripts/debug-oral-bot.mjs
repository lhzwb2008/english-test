/**
 * 口语 Bot 调试：上传 test.wav → 打印等价 curl → 自动流式对话 → 自动轮询 retrieve → 自动拉 message/list。
 *
 * 依赖：根目录 test.wav（或 ORAL_DEBUG_WAV）、.env 中 COZE_API_TOKEN
 * 用法：npm run debug:oral
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const ORAL_BOT_ID = '7627028747031642150';
const BASE_URL = (process.env.COZE_BASE_URL || 'https://api.coze.cn').replace(/\/$/, '');
const WAV = process.env.ORAL_DEBUG_WAV
  ? path.resolve(process.env.ORAL_DEBUG_WAV)
  : path.join(ROOT, 'test.wav');

const USER_ID = process.env.COZE_DEBUG_USER_ID || 'debug-oral-cli';

function printSection(title) {
  console.log('');
  console.log('========== ' + title + ' ==========');
}

function prettyMaybeJson(s) {
  if (typeof s !== 'string' || !s.trim()) return s;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.COZE_API_TOKEN) {
    console.error('请配置 .env 中的 COZE_API_TOKEN');
    process.exit(1);
  }
  if (!fs.existsSync(WAV)) {
    console.error('找不到音频文件:', WAV);
    process.exit(1);
  }

  const stat = fs.statSync(WAV);
  const absWav = path.resolve(WAV);

  const client = new CozeAPI({
    token: process.env.COZE_API_TOKEN,
    baseURL: BASE_URL,
  });

  printSection('上传音频（执行）');
  console.log('文件:', absWav);
  console.log('大小:', stat.size, 'bytes');

  const up = await client.files.upload({ file: fs.createReadStream(absWav) });
  const fileId = up.id;
  console.log('file_id:', fileId);

  const chatBody = {
    bot_id: ORAL_BOT_ID,
    user_id: USER_ID,
    stream: true,
    additional_messages: [
      {
        role: 'user',
        content_type: 'object_string',
        content: JSON.stringify([
          { type: 'text', text: '' },
          { type: 'audio', file_id: fileId },
        ]),
      },
    ],
  };

  const chatJson = JSON.stringify(chatBody);

  printSection('① 等价 curl（上传，可手动复现）');
  console.log(`curl -sS -X POST '${BASE_URL}/v1/files/upload' \\
  --header "Authorization: Bearer \${COZE_API_TOKEN}" \\
  -F "file=@${absWav}"`);

  printSection('② 等价 curl（对话流式，可手动复现）');
  console.log(`curl -N -sS --location '${BASE_URL}/v3/chat' \\
  --header "Authorization: Bearer \${COZE_API_TOKEN}" \\
  --header 'Content-Type: application/json' \\
  --data @- << 'CHATJSON'
${chatJson}
CHATJSON`);

  printSection('② 自动执行：chat.stream（不打印 SSE 正文，仅等待结束）');
  process.stderr.write('流式传输中… ');
  let convId;
  let chatId;
  for await (const evt of client.chat.stream({
    bot_id: ORAL_BOT_ID,
    user_id: USER_ID,
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify([
          { type: 'text', text: '' },
          { type: 'audio', file_id: fileId },
        ]),
        content_type: 'object_string',
      },
    ],
  })) {
    if (evt.event === ChatEventType.ERROR) {
      process.stderr.write('\n');
      console.error('stream error:', evt.data);
      process.exit(1);
    }
    const d = evt.data;
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
  process.stderr.write('结束\n');
  console.log('conversation_id:', convId);
  console.log('chat_id:', chatId);

  if (!convId || !chatId) {
    console.error('未能解析 conversation_id / chat_id');
    process.exit(1);
  }

  const qRetrieve = `conversation_id=${encodeURIComponent(convId)}&chat_id=${encodeURIComponent(chatId)}`;
  const qList = qRetrieve;

  printSection('③ 已补全的 curl（轮询 retrieve，可复制）');
  console.log(`curl -sS '${BASE_URL}/v3/chat/retrieve?${qRetrieve}' \\
  --header "Authorization: Bearer \${COZE_API_TOKEN}"`);

  printSection('③ 自动执行：轮询 retrieve（SDK，直到 completed / failed）');
  let status = '';
  for (let i = 1; i <= 60; i++) {
    const info = await client.chat.retrieve(convId, chatId);
    status = info.status || '';
    console.log(`[${i}] status: ${status}`);
    if (status === 'completed' || status === 'failed') break;
    await sleep(2000);
  }
  if (status !== 'completed') {
    console.error('对话未成功完成，当前 status:', status);
    process.exit(1);
  }
  const last = await client.chat.retrieve(convId, chatId);
  console.log('usage:', JSON.stringify(last.usage || {}, null, 2));

  printSection('④ 已补全的 curl（message/list，可复制）');
  console.log(`curl -sS '${BASE_URL}/v3/chat/message/list?${qList}' \\
  --header "Authorization: Bearer \${COZE_API_TOKEN}"`);

  printSection('④ 自动执行：message/list（助手 answer）');
  const msgs = await client.chat.messages.list(convId, chatId);
  const sorted = [...msgs].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  for (const m of sorted) {
    const typ = m.type || '?';
    const role = m.role || '?';
    if (typ === 'answer' && role === 'assistant') {
      console.log('');
      console.log('--- assistant | answer ---');
      console.log(prettyMaybeJson(m.content ?? ''));
    }
  }

  if (process.env.DEBUG_ORAL_VERBOSE === '1') {
    printSection('（verbose）全部消息类型');
    for (const m of sorted) {
      console.log(m.type, m.role, (m.content || '').slice(0, 120));
    }
  }

  printSection('环境说明');
  console.log('需已配置 COZE_API_TOKEN；或：cd ' + ROOT + ' && set -a && . ./.env && set +a');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
