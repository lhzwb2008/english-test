/**
 * 将 coze/prompts/image-homework.md 推送到「英语学习-图片批改」智能体。
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const BOT_ID = '7627028840921219091';
const PROMPT_FILE = path.join(ROOT, 'coze/prompts/image-homework.md');

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const prompt = await fs.readFile(PROMPT_FILE, 'utf8');
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  await client.bots.update({ bot_id: BOT_ID, prompt_info: { prompt } });
  console.log('已更新 Prompt:', BOT_ID);

  await client.bots.publish({ bot_id: BOT_ID, connector_ids: ['1024'] });
  console.log('已发布 API 渠道 1024');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
