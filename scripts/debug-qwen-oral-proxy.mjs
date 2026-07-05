/**
 * 端到端验证：用 @coze/api 客户端指向本地 Qwen 代理，模拟业务侧调用口语批改。
 *
 * 用法：
 *   1. 终端 A: npm run qwen:serve
 *   2. 终端 B: npm run qwen:debug-oral [audio_path]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORAL_BOT_ID = 'qwen-oral-v1';
const AUDIO_PATH =
  process.argv[2] || path.join(ROOT, 'homework-12.wav');

const baseURL = process.env.QWEN_PROXY_BASE_URL || `http://127.0.0.1:${process.env.QWEN_PROXY_PORT || 8787}`;

if (!fs.existsSync(AUDIO_PATH)) throw new Error(`音频不存在: ${AUDIO_PATH}`);

// Qwen 代理不校验业务侧 token（鉴权由服务器网络侧维护），@coze/api 的
// CozeAPI 构造函数要求非空 token 参数，这里传占位符即可，代理不会校验它。
const client = new CozeAPI({ token: 'unused', baseURL });

const stats = {
  events: {},
  textCompleted: false,
  audioDeltaCount: 0,
};

console.log('[start] baseURL=', baseURL, 'bot_id=', ORAL_BOT_ID, 'audio=', AUDIO_PATH);

const t0 = Date.now();
const up = await client.files.upload({ file: fs.createReadStream(AUDIO_PATH) });
console.log('[upload] file_id=', up.id, 'bytes=', up.bytes);

const userText = [
  'assignment: 口语作业：介绍自己的爱好或日常活动。请使用 like + gerund（如 like reading books），不要 like + 动词原形。',
  '请仅输出 JSON 口语批改结果（含 dimensions 五维 + holistic 总评 + standard_response_en）。',
].join('\n');

const abort = new AbortController();
let oralRaw = '';

for await (const evt of client.chat.stream(
  {
    bot_id: ORAL_BOT_ID,
    user_id: process.env.COZE_DEBUG_USER_ID || 'debug-qwen-oral',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify([
          { type: 'text', text: userText },
          { type: 'audio', file_id: up.id },
        ]),
        content_type: 'object_string',
      },
    ],
  },
  { signal: abort.signal },
)) {
  stats.events[evt.event] = (stats.events[evt.event] || 0) + 1;
  if (evt.event === ChatEventType.CONVERSATION_AUDIO_DELTA) {
    stats.audioDeltaCount += 1;
  }
  if (
    evt.event === ChatEventType.CONVERSATION_MESSAGE_COMPLETED &&
    evt.data?.type === 'answer' &&
    evt.data?.content_type === 'text'
  ) {
    oralRaw = evt.data.content;
    stats.textCompleted = true;
    abort.abort();
    break;
  }
}

const elapsed = Date.now() - t0;
console.log('\n=== 统计 ===');
console.log('总耗时(ms):', elapsed);
console.log('事件计数:', stats.events);
console.log('audio.delta 数量:', stats.audioDeltaCount, '(期望 0)');
console.log('text completed:', stats.textCompleted);

if (!oralRaw) {
  console.error('未收到 text answer completed');
  process.exit(1);
}

let oral;
try {
  oral = JSON.parse(oralRaw.trim().replace(/^```(?:json)?\s*|```$/g, ''));
} catch (err) {
  console.error('JSON 解析失败:', err.message);
  console.log('raw:', oralRaw.slice(0, 500));
  process.exit(1);
}

const required = [
  'reference_text',
  'transcript',
  'standard_response_en',
  'holistic_score_1_to_5',
  'holistic_summary_zh',
  'dimensions',
  'pronunciation',
  'language',
  'coaching_tips_zh',
  'limitations',
];
const missing = required.filter((k) => !(k in oral));
console.log('\n[schema] 缺失字段:', missing.length ? missing : '无');
console.log('[transcript]', oral.transcript?.slice(0, 120));
console.log('[holistic]', oral.holistic_score_1_to_5, oral.holistic_summary_zh?.slice(0, 80));
console.log('\n[OK] Qwen 代理端到端验证通过');
