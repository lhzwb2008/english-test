/**
 * 串联三个智能体跑一次端到端，并把每个 bot 的 **真实请求/响应** 落到
 * tests/fixtures/api-examples/{plan,image,oral}.json，便于据此刷新 docs/API.md。
 *
 * 依赖：.env 中 COZE_API_TOKEN（或环境变量），coze/bots.registry.json
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatStatus } from '@coze/api';
import { streamChatThenListMessages } from './lib/coze-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tests/fixtures/api-examples');
fs.mkdirSync(OUT, { recursive: true });

function loadRegistry() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'coze/bots.registry.json'), 'utf8')
  );
}
function botIdByName(reg, part) {
  const b = reg.bots.find((x) => x.name.includes(part));
  if (!b) throw new Error(`registry 中未找到名称含「${part}」的 bot`);
  return b.bot_id;
}
function extractAnswers(messages) {
  return (messages || [])
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .join('');
}
function tryParse(s) {
  try {
    return { ok: true, data: JSON.parse(s) };
  } catch (e) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return { ok: true, data: JSON.parse(m[0]), repaired: true };
      } catch {}
    }
    return { ok: false, error: e?.message };
  }
}

async function runPlan(client, botId) {
  const userText = `student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系，从 KIDS BOX1 学到目前 THINK1 第一单元 Reading 阶段；每周六下午一次线下课，每次一个半小时；学校译林教材，每天英语课。能完成作业、自觉背默单词，但性格比较拖拉。
学习目标：小学三年级暑假 KET 达到卓越；小学五年级暑假 PET 达到优秀。
每天可学英语 30–60 分钟。
start_date: 2026-05-08（周五）
period_hint: 先排两周（连续 14 个学习日）。

请仅输出 JSON 学习计划，schedule_mode 设为 by_date 并包含 days[].date。`;
  const additional = [
    { role: RoleType.User, content: userText, content_type: 'text' },
  ];
  const r = await client.chat.createAndPoll({
    bot_id: botId,
    user_id: 'api-doc-plan',
    additional_messages: additional,
  });
  const reply = extractAnswers(r.messages);
  const parsed = tryParse(reply);
  const out = {
    bot: '英语学习-计划生成',
    bot_id: botId,
    request: {
      method: 'POST /v3/chat (createAndPoll, stream:false)',
      additional_messages: additional,
    },
    chat_status: r.chat?.status,
    raw_response_text: reply,
    parsed_ok: parsed.ok,
    parsed_data: parsed.data,
    note: parsed.repaired ? '响应外被包裹了 Markdown 代码围栏，已截取 JSON' : undefined,
  };
  fs.writeFileSync(
    path.join(OUT, 'plan.json'),
    JSON.stringify(out, null, 2),
    'utf8'
  );
  return out;
}

async function runImage(client, botId) {
  const imgPath = path.join(ROOT, 'tests/fixtures/mock_homework.png');
  const up = await client.files.upload({
    file: fs.createReadStream(imgPath),
  });
  const fileId = up.id;
  const text = `教材：THINK1 Unit 1 — Reading & Practice（合成测试图）
题号：A1-A2 阅读、B3-B4 填空、C 写作
本页阅读 passage（与图中一致，便于你判分时引用）：
"""
My name is Anna. I am twelve years old. I live in a small town with my family.
I have got a brother and a sister. My brother plays football every weekend. My sister
likes painting. I like reading books and playing the guitar. I never play computer
games on weekdays because I think they are boring. On Saturdays my whole family
goes to the park. I usually take my camera with me to take photos of birds.
"""
answer_key:
1. B
2. A
3. plays
4. like
composition_rubric:
- 内容（25%）：是否说明了爱好、频率、地点和感受
- 结构（25%）：是否有连贯的开头-展开-结尾
- 语言（30%）：动词三单/时态/动名词搭配
- 卷面（20%）：拼写与标点

请仅输出 JSON。`;
  const obj = [
    { type: 'text', text },
    { type: 'image', file_id: fileId },
  ];
  const additional = [
    {
      role: RoleType.User,
      content: JSON.stringify(obj),
      content_type: 'object_string',
    },
  ];
  const r = await client.chat.createAndPoll({
    bot_id: botId,
    user_id: 'api-doc-image',
    additional_messages: additional,
  });
  const reply = extractAnswers(r.messages);
  const parsed = tryParse(reply);
  const out = {
    bot: '英语学习-图片批改',
    bot_id: botId,
    request: {
      method: 'POST /v1/files/upload + POST /v3/chat (createAndPoll, stream:false)',
      uploaded_file_id: fileId,
      uploaded_file_local: 'tests/fixtures/mock_homework.png',
      additional_messages_object_string: obj,
    },
    chat_status: r.chat?.status,
    raw_response_text: reply,
    parsed_ok: parsed.ok,
    parsed_data: parsed.data,
    note: parsed.repaired ? '响应外被包裹了 Markdown 代码围栏，已截取 JSON' : undefined,
  };
  fs.writeFileSync(
    path.join(OUT, 'image.json'),
    JSON.stringify(out, null, 2),
    'utf8'
  );
  return out;
}

async function runOral(client, botId) {
  const wavPath = path.join(ROOT, 'tests/fixtures/oral_sample.wav');
  const up = await client.files.upload({
    file: fs.createReadStream(wavPath),
  });
  const fileId = up.id;
  const text = `assignment: 口语作业：介绍自己的爱好或日常活动。请使用 like + gerund（如 like reading books）；不要 like + 动词原形。
reference_text: I like playing football and reading books at weekends. (示例参考)
请仅输出 JSON 口语批改结果（含 dimensions 五维 + holistic 总评）。`;
  const obj = [
    { type: 'text', text },
    { type: 'audio', file_id: fileId },
  ];
  const additional = [
    {
      role: RoleType.User,
      content: JSON.stringify(obj),
      content_type: 'object_string',
    },
  ];
  const messages = await streamChatThenListMessages(client, {
    bot_id: botId,
    user_id: 'api-doc-oral',
    additional_messages: additional,
  });
  const reply = extractAnswers(messages);
  const parsed = tryParse(reply);
  const out = {
    bot: '英语学习-口语批改',
    bot_id: botId,
    request: {
      method:
        'POST /v1/files/upload + POST /v3/chat (stream:true) + GET /v3/chat/message/list',
      uploaded_file_id: fileId,
      uploaded_file_local: 'tests/fixtures/oral_sample.wav',
      additional_messages_object_string: obj,
    },
    raw_response_text: reply,
    parsed_ok: parsed.ok,
    parsed_data: parsed.data,
    note: parsed.repaired ? '响应外被包裹了 Markdown 代码围栏，已截取 JSON' : undefined,
  };
  fs.writeFileSync(
    path.join(OUT, 'oral.json'),
    JSON.stringify(out, null, 2),
    'utf8'
  );
  return out;
}

async function main() {
  const reg = loadRegistry();
  const client = new CozeAPI({
    token: process.env.COZE_API_TOKEN,
    baseURL: process.env.COZE_BASE_URL || '[REDACTED]',
  });

  const results = {};
  console.log('\n=== Plan ===');
  results.plan = await runPlan(client, botIdByName(reg, '计划'));
  console.log(
    'parsed_ok:',
    results.plan.parsed_ok,
    'days:',
    results.plan.parsed_data?.days?.length
  );
  console.log(
    'preview:',
    results.plan.raw_response_text.slice(0, 240).replace(/\s+/g, ' ')
  );

  console.log('\n=== Image ===');
  results.image = await runImage(client, botIdByName(reg, '图片'));
  console.log(
    'parsed_ok:',
    results.image.parsed_ok,
    'items:',
    results.image.parsed_data?.items?.length
  );
  console.log(
    'preview:',
    results.image.raw_response_text.slice(0, 240).replace(/\s+/g, ' ')
  );

  console.log('\n=== Oral ===');
  results.oral = await runOral(client, botIdByName(reg, '口语'));
  console.log(
    'parsed_ok:',
    results.oral.parsed_ok,
    'transcript:',
    results.oral.parsed_data?.transcript?.slice(0, 80)
  );
  console.log(
    'preview:',
    results.oral.raw_response_text.slice(0, 240).replace(/\s+/g, ' ')
  );

  console.log('\n保存了 fixtures:');
  for (const f of fs.readdirSync(OUT)) {
    const p = path.join(OUT, f);
    console.log(' -', p, fs.statSync(p).size, 'bytes');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
