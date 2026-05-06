/**
 * 使用 THINK1 素材对三个智能体做 API 联调。
 *
 * 依赖：根目录 .env 中 COZE_API_TOKEN；coze/bots.registry.json
 *
 * 口语真实音频：扣子 OpenAPI 要求音频为 wav 或 ogg_opus，且须 stream=true。
 * 若不存在 tests/fixtures/oral_sample.wav，会跳过音频用例，仅跑「文本模拟转写」用例。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatStatus } from '@coze/api';
import { streamChatThenListMessages } from './lib/coze-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadRegistry() {
  const p = path.join(ROOT, 'coze/bots.registry.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function botIdByName(registry, part) {
  const b = registry.bots.find((x) => x.name.includes(part));
  if (!b) throw new Error(`registry 中未找到名称含「${part}」的 bot`);
  return b.bot_id;
}

function extractAnswers(messages) {
  return (messages || [])
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .join('');
}

async function testPlan(client, botId) {
  const student = `student_profile:
学员：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系从 KIDS BOX1 开始，目前 THINK1 第九单元；每周六下午线下课 1.5 小时。学校译林教材，每天英语课。2026年3月 KET 听力错5、阅读错10。能完成作业、背默单词；性格拖拉，难以自主学习。每日可学习 30–60 分钟。
目标：小学三年级暑假 KET 达到卓越；小学五年级暑假 PET 达到优秀。`;

  const taskPool = `task_pool（THINK1 节选）：
Welcome-PartA-01 | 必做：练习册P4(1/2/4题) | 选做：练习册P4（6题） | 口语必做：主题词汇认读 | 选做：用几句话介绍自己
Welcome-PartC-01 | 必做：练习册P7(1-2题) | 选做：P7（3/4题） | 口语必做：主题词汇背诵 | 选做：询问生日并回答（When's your birthday? / It's on...），录音发群
U1-L1-Reading1 | 必做：P8 知识清单单词1-19背记认读、句子朗读；P10 quiz 单词句子自默1-27 | 选做：P9 思维导图；P10 Practice 填空 | 口语：分享喜欢或讨厌的活动（I think... is always/sometimes/never...）`;

  const header = `curriculum: think1

`;

  const msg = `${header}${student}\n\n${taskPool}\n\n请按系统要求仅输出一个 JSON（含 meta 与 days；days 条数须与 task_pool 课节条数一致）。`;

  const r = await client.chat.createAndPoll({
    bot_id: botId,
    user_id: 'e2e-plan',
    additional_messages: [
      { role: RoleType.User, content: msg, content_type: 'text' },
    ],
  });

  if (r.chat?.status !== ChatStatus.COMPLETED) {
    console.log('计划生成 status:', r.chat?.status, r.chat?.last_error);
  }
  const text = extractAnswers(r.messages);
  const parsed = JSON.parse(text);
  const ok =
    Array.isArray(parsed.days) &&
    parsed.days.length > 0 &&
    parsed.days[0]?.day_index != null;
  return {
    ok,
    preview: text.slice(0, 400) + '...',
    dayCount: parsed.days?.length,
  };
}

async function testImage(client, botId) {
  const imgPath = path.join(
    ROOT,
    'THINK1/think1作业问答/微信图片_20260330202239_986_322.jpg'
  );
  const up = await client.files.upload({ file: fs.createReadStream(imgPath) });
  const obj = [
    { type: 'text', text: '请批改这张作业照片，仅输出 JSON。' },
    { type: 'image', file_id: up.id },
  ];

  const r = await client.chat.createAndPoll({
    bot_id: botId,
    user_id: 'e2e-image',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify(obj),
        content_type: 'object_string',
      },
    ],
  });

  if (r.chat?.status !== ChatStatus.COMPLETED) {
    console.log('图片批改 status:', r.chat?.status, r.chat?.last_error);
  }
  const text = extractAnswers(r.messages);
  const data = JSON.parse(text);
  const n = data.items?.length ?? 0;
  return { ok: n > 0, itemCount: n, preview: text.slice(0, 500) + '...' };
}

/** 文本模拟转写（不依赖音频格式），验证 JSON 与语法反馈逻辑 */
async function testOralTextOnly(client, botId) {
  const transcript =
    'I like read books and I like play football every day.';
  const msg = `以下为口语转写文本（模拟 ASR），请按口语批改 JSON 输出。参考任务：介绍爱好，使用 like + gerund。\n\n${transcript}`;

  const r = await client.chat.createAndPoll({
    bot_id: botId,
    user_id: 'e2e-oral-text',
    additional_messages: [
      { role: RoleType.User, content: msg, content_type: 'text' },
    ],
  });

  const text = extractAnswers(r.messages);
  const data = JSON.parse(text);
  const hasGrammar = (data.language?.grammar_issues?.length ?? 0) > 0;
  const hasDims =
    Array.isArray(data.dimensions) && (data.dimensions?.length ?? 0) >= 5;
  return { ok: hasGrammar || hasDims, preview: text.slice(0, 600) + '...' };
}

async function testOralWavOptional(client, botId) {
  const wavPath = path.join(ROOT, 'tests/fixtures/oral_sample.wav');
  if (!fs.existsSync(wavPath)) {
    return { skipped: true, reason: '缺少 tests/fixtures/oral_sample.wav' };
  }

  const up = await client.files.upload({ file: fs.createReadStream(wavPath) });
  const obj = [
    {
      type: 'text',
      text: '请批改口语作业，输出 JSON。参考任务：介绍爱好，使用 like + gerund。',
    },
    { type: 'audio', file_id: up.id },
  ];

  const msgs = await streamChatThenListMessages(client, {
    bot_id: botId,
    user_id: 'e2e-oral-wav',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify(obj),
        content_type: 'object_string',
      },
    ],
  });

  const text = extractAnswers(msgs);
  JSON.parse(text);
  return { ok: true, preview: text.slice(0, 500) + '...' };
}

async function main() {
  const registry = loadRegistry();
  const client = new CozeAPI({
    token: process.env.COZE_API_TOKEN,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const idPlan = botIdByName(registry, '计划');
  const idImage = botIdByName(registry, '图片');
  const idOral = botIdByName(registry, '口语');

  console.log('=== 1. 学习计划（createAndPoll + THINK1 文本素材）===');
  const p = await testPlan(client, idPlan);
  console.log(JSON.stringify(p, null, 2));

  console.log('\n=== 2. 图片作业（createAndPoll + 上传 JPG）===');
  const i = await testImage(client, idImage);
  console.log(JSON.stringify(i, null, 2));

  console.log('\n=== 3a. 口语批改（createAndPoll + 模拟转写文本）===');
  const o = await testOralTextOnly(client, idOral);
  console.log(JSON.stringify(o, null, 2));

  console.log('\n=== 3b. 口语批改（stream + wav，可选）===');
  const ow = await testOralWavOptional(client, idOral);
  console.log(JSON.stringify(ow, null, 2));

  console.log('\n全部用例执行完毕。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
