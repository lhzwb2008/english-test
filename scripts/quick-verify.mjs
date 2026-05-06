/**
 * 短输入快速验证三个 Bot 是否可用（总耗时常 2～6 分钟）。
 * 用法：node scripts/quick-verify.mjs
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType, ChatStatus, ChatEventType } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const reg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'coze/bots.registry.json'), 'utf8')
);
const by = (s) => reg.bots.find((b) => b.name.includes(s))?.bot_id;

function answersText(messages) {
  return (messages || [])
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .join('');
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const out = { ok: true, cases: [] };

  // 1 计划（短文本）
  const planId = by('计划');
  const r1 = await client.chat.createAndPoll({
    bot_id: planId,
    user_id: 'verify-plan',
    additional_messages: [
      {
        role: RoleType.User,
        content: `student_profile: 三年级，在学 THINK1 Welcome 段，每天可学英语约30分钟。目标：半年后 KET。请排默认周期。

请输出 JSON（含 meta 与 days）。`,
        content_type: 'text',
      },
    ],
  });
  const t1 = answersText(r1.messages);
  out.cases.push({
    name: '学习计划',
    bot_id: planId,
    status: r1.chat?.status,
    json_ok: (() => {
      try {
        JSON.parse(t1);
        return true;
      } catch {
        return false;
      }
    })(),
    reply_preview: t1.slice(0, 280),
  });
  if (r1.chat?.status !== ChatStatus.COMPLETED) out.ok = false;

  // 2 图片
  const imgId = by('图片');
  const jpg = path.join(
    ROOT,
    'THINK1/think1作业问答/微信图片_20260330202239_986_322.jpg'
  );
  const up = await client.files.upload({ file: fs.createReadStream(jpg) });
  const obj = [
    { type: 'text', text: '请批改并只输出 JSON。' },
    { type: 'image', file_id: up.id },
  ];
  const r2 = await client.chat.createAndPoll({
    bot_id: imgId,
    user_id: 'verify-img',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify(obj),
        content_type: 'object_string',
      },
    ],
  });
  const t2 = answersText(r2.messages);
  out.cases.push({
    name: '图片作业',
    bot_id: imgId,
    status: r2.chat?.status,
    json_ok: (() => {
      try {
        JSON.parse(t2);
        return true;
      } catch {
        return false;
      }
    })(),
    reply_preview: t2.slice(0, 280),
  });
  if (r2.chat?.status !== ChatStatus.COMPLETED) out.ok = false;

  // 3 口语（仅音频 + stream，与 API 文档一致）
  const oralId = by('口语');
  const wavPath = path.join(ROOT, 'tests/fixtures/oral_sample.wav');
  if (fs.existsSync(wavPath)) {
    try {
      const aup = await client.files.upload({ file: fs.createReadStream(wavPath) });
      const obj3 = [
        { type: 'text', text: '参考：介绍爱好，使用 like + gerund。请只输出 JSON。' },
        { type: 'audio', file_id: aup.id },
      ];
      let convId;
      let chatId;
      for await (const evt of client.chat.stream({
        bot_id: oralId,
        user_id: 'verify-oral',
        additional_messages: [
          {
            role: RoleType.User,
            content: JSON.stringify(obj3),
            content_type: 'object_string',
          },
        ],
      })) {
        if (evt.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
          convId = evt.data.conversation_id;
          chatId = evt.data.id;
        }
      }
      if (!convId || !chatId) throw new Error('stream 未返回 conversation/chat id');
      const msgs3 = await client.chat.messages.list(convId, chatId);
      const t3 = answersText(msgs3);
      out.cases.push({
        name: '口语评测(音频+wav)',
        bot_id: oralId,
        json_ok: (() => {
          try {
            JSON.parse(t3);
            return true;
          } catch {
            return false;
          }
        })(),
        reply_preview: t3.slice(0, 280),
      });
    } catch (e) {
      out.cases.push({
        name: '口语评测(音频+wav)',
        bot_id: oralId,
        json_ok: false,
        error: String(e.message || e),
      });
      out.ok = false;
    }
  } else {
    out.cases.push({
      name: '口语评测(音频+wav)',
      bot_id: oralId,
      status: 'skipped',
      json_ok: false,
      note: '缺少 tests/fixtures/oral_sample.wav',
    });
    out.ok = false;
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
