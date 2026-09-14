/**
 * 图片批改回归：半截填空不得脑补。默认用 WELCOME P4 原图。
 * 用法: node scripts/debug-image-homework.mjs [image_path]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType } from '@coze/api';
import { writeHomeworkSample } from '../server/lib/requestLog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BOT_ID = '7627028840921219091';

const DEFAULT_IMAGE =
  '/Users/Wezhang/.cursor/projects/Users-Wezhang-workspace-english-test/assets/2861003ca196a5fe09c9984e693cbc4e-6901cca2-829b-4cce-b32f-7fc6f04a2184.jpg';

const imagePath = path.resolve(process.argv[2] || DEFAULT_IMAGE);

const USER_TEXT = `请仅输出 JSON。
本次作业要求如下：
必做：P4：第1-3题`;

function sliceJsonObject(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未能从助手回复中截取 JSON 对象片段');
  }
  return s.slice(start, end + 1);
}

function looksCompleteWatchingTv(s) {
  return /do you like watching tv/i.test(String(s || ''));
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');
  if (!fs.existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`);

  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const uploaded = await client.files.upload({
    file: fs.createReadStream(imagePath),
  });
  const fileId = uploaded?.id || uploaded?.data?.id;
  if (!fileId) throw new Error(`上传失败: ${JSON.stringify(uploaded)}`);

  const content = JSON.stringify([
    { type: 'text', text: USER_TEXT },
    { type: 'image', file_id: fileId },
  ]);

  const result = await client.chat.createAndPoll({
    bot_id: BOT_ID,
    user_id: process.env.COZE_DEBUG_USER_ID || 'debug-image-homework',
    additional_messages: [
      { role: RoleType.User, content, content_type: 'object_string' },
    ],
  });

  const messages = result?.messages || [];
  const raw = messages
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .filter(Boolean)
    .join('');
  if (!raw) {
    console.error('无 answer', JSON.stringify(result?.chat || result, null, 2).slice(0, 3000));
    process.exit(1);
  }

  const plan = JSON.parse(sliceJsonObject(raw));
  const logged = writeHomeworkSample({
    kind: 'image_homework',
    bot_id: BOT_ID,
    user_text: USER_TEXT,
    answer: plan,
    files: [{ filename: path.basename(imagePath), buffer: fs.readFileSync(imagePath) }],
  });
  console.log('已落盘', logged);

  const items = plan.items || [];
  const target =
    items.find((it) => String(it.id) === 'P4-2-3') ||
    items.find((it) => /P4-2-3/i.test(String(it.id))) ||
    items.find(
      (it) =>
        /reality shows/i.test(String(it.original_question || '')) ||
        /watching TV/i.test(String(it.standard_answer || '')),
    );

  console.log('target item:', JSON.stringify(target, null, 2));
  const errors = [];
  if (!target) {
    errors.push('未找到 P4-2-3 / reality shows 对应 item');
    console.log(
      'item ids:',
      items.map((it) => `${it.id} sa=${it.student_answer} std=${it.standard_answer}`).join('\n'),
    );
  } else {
    const sa = String(target.student_answer || '').trim();
    if (looksCompleteWatchingTv(sa) && !/^do you\??$/i.test(sa)) {
      errors.push(`student_answer 被补全: ${JSON.stringify(sa)}`);
    }
    if (target.is_correct === true && looksCompleteWatchingTv(sa)) {
      errors.push('半截答案被判对');
    }
    if (/do you like watching tv/i.test(sa) && target.is_correct === true) {
      errors.push('假正确：完整句 + is_correct true');
    }
  }

  console.log('errors:', errors);
  if (errors.length) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
