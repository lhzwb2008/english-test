/**
 * 用法：node scripts/push-prompt.mjs <bot_id> <path/to/prompt.md>
 * 例：node scripts/push-prompt.mjs 7627028747031642150 coze/prompts/oral-smoke-test.md
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const botId = process.argv[2];
const rel = process.argv[3];
if (!botId || !rel) {
  console.error('用法: node scripts/push-prompt.mjs <bot_id> <prompt.md 相对路径>');
  process.exit(1);
}

const promptPath = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN');

  const prompt = await fs.readFile(promptPath, 'utf8');
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  await client.bots.update({ bot_id: botId, prompt_info: { prompt } });
  console.log('已更新 Prompt:', botId, '<-', rel);

  await client.bots.publish({ bot_id: botId, connector_ids: ['1024'] });
  console.log('已发布 API 1024');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
