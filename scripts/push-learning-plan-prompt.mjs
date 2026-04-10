/**
 * 将 coze/prompts/learning-plan.md 全文推送到「英语学习-计划生成」智能体（bots.update + publish API 渠道）。
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const PLAN_BOT_ID = '7627028738093596712';
const PROMPT_FILE = path.join(ROOT, 'coze/prompts/learning-plan.md');

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const prompt = await fs.readFile(PROMPT_FILE, 'utf8');
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  await client.bots.update({
    bot_id: PLAN_BOT_ID,
    prompt_info: { prompt },
  });
  console.log('已更新 Prompt:', PLAN_BOT_ID);

  await client.bots.publish({
    bot_id: PLAN_BOT_ID,
    connector_ids: ['1024'],
  });
  console.log('已发布 API 渠道 1024');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
