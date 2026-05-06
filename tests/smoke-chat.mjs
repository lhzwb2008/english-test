/**
 * 最小联调：调用 Chat API 与「学习计划」智能体对话（需已发布 API）。
 * 用法：node tests/smoke-chat.mjs
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, ChatStatus, RoleType } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const registry = JSON.parse(
  await fs.readFile(path.join(ROOT, 'coze/bots.registry.json'), 'utf8')
);
const planBot = registry.bots.find((b) => b.name.includes('计划'));
if (!planBot) {
  console.error('bots.registry.json 中未找到计划生成 bot');
  process.exit(1);
}

const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
});

const msg = `curriculum: think1

student_profile:
三年级，教材 THINK1，目标 KET 卓越。每日可学习 45 分钟。

task_pool（节选）：
Welcome-PartA-01 | 必做：练习册 P4 必做；主题词汇认读。

请输出 JSON 学习计划（含 meta 与 days）。`;

const r = await client.chat.createAndPoll({
  bot_id: planBot.bot_id,
  user_id: process.env.COZE_DEBUG_USER_ID || 'smoke-test',
  additional_messages: [
    { role: RoleType.User, content: msg, content_type: 'text' },
  ],
});

console.log('status:', r.chat?.status);
if (r.chat?.status !== ChatStatus.COMPLETED) {
  console.log('last_error:', r.chat?.last_error);
}
const answers = (r.messages || []).filter((m) => m.type === 'answer');
console.log(answers.map((m) => m.content).join('\n'));
