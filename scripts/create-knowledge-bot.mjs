/**
 * 仅创建「英语学习-知识点讲解」一个 Bot，并把 bot_id 写回 coze/bots.registry.json。
 * 用法：npm run coze:create-knowledge
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const REGISTRY_FILE = path.join(ROOT, 'coze/bots.registry.json');
const PROMPT_FILE = path.join(ROOT, 'coze/prompts/knowledge-explainer.md');

const BOT_NAME = '英语学习-知识点讲解';
const BOT_DESC =
  '输入知识点名称（及可选教学上下文），输出面向中小学生的中文讲解 Markdown + TTS 朗读脚本（JSON）。';
const PROMPT_REL = 'coze/prompts/knowledge-explainer.md';

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8'));
  const exist = (registry.bots || []).find((b) => b.name === BOT_NAME);
  if (exist?.bot_id) {
    console.log(`已存在：${BOT_NAME} bot_id=${exist.bot_id}（跳过创建）`);
    return;
  }

  const spaceId = process.env.COZE_SPACE_ID || registry.space_id;
  if (!spaceId) throw new Error('缺少 space_id（registry 或 COZE_SPACE_ID）');

  const prompt = await fs.readFile(PROMPT_FILE, 'utf8');
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const res = await client.bots.create({
    space_id: spaceId,
    name: BOT_NAME,
    description: BOT_DESC,
    prompt_info: { prompt },
    onboarding_info: {
      prologue:
        '告诉我一个英语知识点名称（如「现在完成时」），可附学生年级或上下文。我会按系统格式输出讲解 JSON。',
      suggested_questions: [
        '知识点：现在完成时',
        '知识点：for 与 since 的区别（小学五年级）',
        '知识点：一般过去时被动语态',
      ],
    },
    ...(process.env.COZE_MODEL_ID
      ? {
          model_info_config: {
            model_id: process.env.COZE_MODEL_ID,
            temperature: 0.3,
            response_format: 'json',
          },
        }
      : {}),
    suggest_reply_info: { reply_mode: 'disable' },
  });

  const botId = res.bot_id;
  console.log('已创建：', BOT_NAME, 'bot_id=', botId);

  try {
    await client.bots.publish({ bot_id: botId, connector_ids: ['1024'] });
    console.log('  已发布 API 渠道 (1024)');
  } catch (e) {
    console.warn('  发布失败（可稍后在控制台发布）:', e.message || e);
  }

  registry.bots = registry.bots || [];
  registry.bots.push({ name: BOT_NAME, bot_id: botId, prompt_file: PROMPT_REL });
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  console.log('已写回 registry：', REGISTRY_FILE);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
