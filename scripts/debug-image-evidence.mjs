/**
 * 复现/校验图片批改 bot 的 evidence_quote 是否为原文连续子串。
 * 用法: node scripts/debug-image-evidence.mjs [image_path]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI, RoleType } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BOT_ID = '7627028840921219091';

const imagePath = path.resolve(
  process.argv[2] || path.join(ROOT, 'tmp/listening-repro.png'),
);

function sliceJsonObject(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未能从助手回复中截取 JSON 对象片段');
  }
  return s.slice(start, end + 1);
}

/** 归一化空白后检查 quote 是否为 passage 连续子串；并检测省略号。 */
function analyzeEvidence(passageText, quote) {
  const issues = [];
  if (!quote || !String(quote).trim()) {
    return { ok: false, issues: ['evidence_quote 为空'] };
  }
  const q = String(quote);
  if (/\.\.\.|…/.test(q)) issues.push('含省略号 .../…');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const pN = norm(passageText || '');
  const qN = norm(q);
  if (!pN) {
    issues.push('passage_text 为空，无法校验');
    return { ok: false, issues };
  }
  if (!pN.includes(qN)) {
    issues.push('归一化后不是 passage_text 的连续子串');
  }
  return { ok: issues.length === 0, issues, quote: q, quoteNorm: qN };
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');
  if (!fs.existsSync(imagePath)) throw new Error(`图片不存在: ${imagePath}`);

  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  console.log('上传图片:', imagePath);
  const uploaded = await client.files.upload({
    file: fs.createReadStream(imagePath),
  });
  const fileId = uploaded?.id || uploaded?.data?.id;
  if (!fileId) throw new Error(`上传失败: ${JSON.stringify(uploaded)}`);
  console.log('file_id:', fileId);

  const content = JSON.stringify([
    { type: 'text', text: '请仅输出 JSON。' },
    { type: 'image', file_id: fileId },
  ]);

  console.log('调用图片批改 bot...');
  const result = await client.chat.createAndPoll({
    bot_id: BOT_ID,
    user_id: process.env.COZE_DEBUG_USER_ID || 'debug-image-evidence',
    additional_messages: [
      {
        role: RoleType.User,
        content,
        content_type: 'object_string',
      },
    ],
  });

  const messages = result?.messages || result?.data?.messages || [];
  const answer = messages.find(
    (m) => m.role === 'assistant' && (m.type === 'answer' || !m.type),
  );
  const raw = answer?.content;
  if (!raw) {
    console.error('无 answer 消息，完整结果:', JSON.stringify(result, null, 2).slice(0, 4000));
    process.exit(1);
  }

  const jsonText = sliceJsonObject(raw);
  const parsed = JSON.parse(jsonText);
  const outPath = path.join(ROOT, 'tmp/listening-repro-result.json');
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
  console.log('已写入:', outPath);

  const passages = parsed.passages || [];
  const byId = Object.fromEntries(passages.map((p) => [p.passage_id, p]));
  console.log('\n=== passages ===');
  for (const p of passages) {
    console.log(`[${p.passage_id}] len=${(p.passage_text || '').length}`);
    console.log((p.passage_text || '').slice(0, 200) + '...');
  }

  console.log('\n=== evidence_quote 校验 ===');
  let fail = 0;
  for (const item of parsed.items || []) {
    const pass = byId[item.passage_ref] || passages[0];
    const analysis = analyzeEvidence(pass?.passage_text, item.evidence_quote);
    const status = analysis.ok ? 'OK' : 'FAIL';
    if (!analysis.ok) fail += 1;
    console.log(
      `\n[${status}] item ${item.id} type=${item.item_type} passage_ref=${item.passage_ref || ''}`,
    );
    console.log('  evidence_quote:', JSON.stringify(item.evidence_quote));
    if (analysis.issues?.length) console.log('  issues:', analysis.issues.join('; '));
  }
  console.log(`\n汇总: ${fail} 项未通过原文连续子串校验`);
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
