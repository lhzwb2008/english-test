/**
 * 在指定 Coze 团队空间创建「英语学习」三条智能体（仅 OpenAPI 可创建的部分）。
 * 工作流需在扣子控制台手动编排后，将 workflow_id 绑定到智能体。
 *
 * 用法：
 *   COZE_SPACE_ID=xxx node scripts/create-english-bots.mjs
 * 未设置 COZE_SPACE_ID 时，默认使用「共享空间」（与脚本内 DEFAULT_TEAM_SPACE_ID 一致，请按需改）。
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CozeAPI } from '@coze/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** 共享空间 workspace id（与 workspaces.list 中「共享空间」一致） */
const DEFAULT_TEAM_SPACE_ID = '7522025257893412902';

const BOTS = [
  {
    name: '英语学习-计划生成',
    description:
      '根据学生档案与原子任务池生成英文学习计划（JSON）。一期 MVP。',
    promptFile: 'coze/prompts/learning-plan.md',
  },
  {
    name: '英语学习-图片批改',
    description:
      '根据作业图片判断客观题对错并输出批改逻辑（JSON）。一期 MVP。',
    promptFile: 'coze/prompts/image-homework.md',
  },
  {
    name: '英语学习-口语批改',
    description:
      '英语口语作业：转写、粗分、语言纠错与建议（JSON）。一期 MVP。',
    promptFile: 'coze/prompts/oral-homework.md',
  },
];

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) {
    console.error('请设置 COZE_API_TOKEN');
    process.exit(1);
  }

  const spaceId = process.env.COZE_SPACE_ID || DEFAULT_TEAM_SPACE_ID;
  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  const out = { space_id: spaceId, created_at: new Date().toISOString(), bots: [] };

  for (const def of BOTS) {
    const promptPath = path.join(ROOT, def.promptFile);
    const prompt = await fs.readFile(promptPath, 'utf8');

    const res = await client.bots.create({
      space_id: spaceId,
      name: def.name,
      description: def.description,
      prompt_info: { prompt },
      onboarding_info: {
        prologue:
          '请直接粘贴学生档案、任务池或作业材料。我将按系统格式输出 JSON。',
        suggested_questions: [
          '生成未来四周学习计划（附上任务池表格）',
          '批改这张作业照片并输出 JSON',
          '这段口语录音的参考句是：... 请输出 JSON',
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
    console.log('已创建:', def.name, 'bot_id=', botId);

    try {
      await client.bots.publish({
        bot_id: botId,
        connector_ids: ['1024'],
      });
      console.log('  已发布 API 渠道 (1024)');
    } catch (e) {
      console.warn('  发布失败（可稍后在控制台发布）:', e.message || e);
    }

    out.bots.push({
      name: def.name,
      bot_id: botId,
      prompt_file: def.promptFile,
    });
  }

  const registryPath = path.join(ROOT, 'coze', 'bots.registry.json');
  await fs.writeFile(registryPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('\n已写入', registryPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
