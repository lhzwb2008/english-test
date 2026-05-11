/**
 * 将 coze/prompts/knowledge-explainer.md 推送到「英语学习-知识点讲解」智能体。
 *
 * 首次使用前请先在 coze/bots.registry.json 的 bots 中加入：
 *   { "name": "英语学习-知识点讲解", "bot_id": "<新建后的 bot_id>",
 *     "prompt_file": "coze/prompts/knowledge-explainer.md" }
 * 或通过 npm run coze:create 自动创建并写入。
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PROMPT_FILE = path.join(ROOT, 'coze/prompts/knowledge-explainer.md');
const REGISTRY_FILE = path.join(ROOT, 'coze/bots.registry.json');
const BOT_NAME = '英语学习-知识点讲解';

async function resolveBotId() {
  if (process.env.COZE_BOT_ID) return process.env.COZE_BOT_ID;
  const registry = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf8'));
  const hit = (registry.bots || []).find((b) => b.name === BOT_NAME);
  if (!hit?.bot_id) {
    throw new Error(
      `未在 ${REGISTRY_FILE} 中找到「${BOT_NAME}」。\n` +
        '请先 npm run coze:create 或在控制台手动创建，并把 bot_id 填入 registry；' +
        '也可通过环境变量 COZE_BOT_ID=xxx 直接覆盖。',
    );
  }
  return hit.bot_id;
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const botId = await resolveBotId();
  const prompt = await fs.readFile(PROMPT_FILE, 'utf8');
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  await client.bots.update({ bot_id: botId, prompt_info: { prompt } });
  console.log('已更新 Prompt:', botId);

  await client.bots.publish({ bot_id: botId, connector_ids: ['1024'] });
  console.log('已发布 API 渠道 1024');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
