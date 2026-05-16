/**
 * 按 API.md 「学习计划」节调用学习计划 Bot，校验 system_task_pool 场景下每条 task.sourceRef。
 * 需 .env：`COZE_API_TOKEN`（可选 `COZE_BASE_URL`，默认 https://api.coze.cn）。
 */
import 'dotenv/config';
import { CozeAPI, RoleType } from '@coze/api';

const PLAN_BOT_ID = '7627028738093596712';

const SAMPLE_USER_MESSAGE = `student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系，THINK1 第一单元 Reading 阶段。
学习目标：稳住校内；每天可学英语 30 分钟左右。
start_date: 2026-05-08
period_hint: 只需排连续 5 个学习日（精简调试）。

system_task_pool:
ID: 100; 标题: 1单元单词复习; 描述: 1单元学习完成后，需要先复习单词
ID: 101; 标题: 1单元课文跟读; 描述: 跟读 Unit1 Reading 课文 3 遍
ID: 102; 标题: 1单元语法练习; 描述: Unit1 一般现在时填空 10 题
ID: 103; 标题: 1单元口语输出; 描述: like + 动名词介绍爱好 ≥30 秒

请仅输出 JSON 学习计划。schedule_mode=by_date，含 days[].date。days[].tasks 必须全部来自上述 system_task_pool，每项 sourceRef 必须是对应任务的 ID（字符串）。`;

const ALLOWED_SOURCE_REFS = new Set(['100', '101', '102', '103']);

function sliceJsonObject(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('未能从助手回复中截取 JSON 对象片段');
  }
  return s.slice(start, end + 1);
}

function validatePlan(plan, { allowedIds }) {
  const errors = [];
  const warns = [];

  if (!plan || typeof plan !== 'object') {
    errors.push('解析结果不是 object');
    return { errors, warns };
  }
  if (!Array.isArray(plan.days)) {
    errors.push('缺少或非法 days 数组');
    return { errors, warns };
  }

  let taskCount = 0;
  for (const day of plan.days) {
    const tasks = day?.tasks;
    if (!Array.isArray(tasks)) {
      errors.push(`day_index=${day?.day_index} 缺少 tasks 数组`);
      continue;
    }
    for (let i = 0; i < tasks.length; i += 1) {
      taskCount += 1;
      const t = tasks[i];
      const refCamel = t?.sourceRef;
      const refSnake = t?.source_ref;
      if (refSnake !== undefined && refSnake !== null && String(refSnake) !== '') {
        warns.push(
          `day_index=${day?.day_index} task#${i} 使用了旧字段 source_ref="${refSnake}"，请以 sourceRef 为准`,
        );
      }
      if (refCamel === undefined || refCamel === null || String(refCamel).trim() === '') {
        errors.push(`day_index=${day?.day_index} task#${i} sourceRef 为空（要求来自任务池）`);
        continue;
      }
      const id = String(refCamel).trim();
      if (!allowedIds.has(id)) {
        errors.push(`day_index=${day?.day_index} task#${i} sourceRef="${id}" 不在允许的任务池 ID 集合`);
      }
    }
  }

  if (taskCount === 0) errors.push('未找到任何 tasks 项');

  return { errors, warns, taskCount };
}

async function main() {
  const token = process.env.COZE_API_TOKEN;
  if (!token) throw new Error('缺少 COZE_API_TOKEN（见 .env）');

  const client = new CozeAPI({
    token,
    baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
  });

  console.log('调用学习计划 Bot createAndPoll…', PLAN_BOT_ID);
  const poll = await client.chat.createAndPoll({
    bot_id: PLAN_BOT_ID,
    user_id: process.env.COZE_DEBUG_USER_ID || 'debug-learning-plan-script',
    additional_messages: [
      {
        role: RoleType.User,
        content_type: 'text',
        content: SAMPLE_USER_MESSAGE,
      },
    ],
  });

  const messages = poll.messages ?? [];
  const answerParts = messages
    .filter((m) => m.type === 'answer')
    .map((m) => m.content)
    .filter(Boolean);
  const raw = answerParts.join('');
  if (!raw) {
    console.error('未收到 answer 消息，poll:', JSON.stringify(poll.chat ?? poll, null, 2));
    process.exit(1);
  }

  let plan;
  try {
    plan = JSON.parse(sliceJsonObject(raw));
  } catch (e) {
    console.error('JSON.parse 失败:', e?.message ?? e);
    console.error('---- raw (截断前 4000 字) ----\n', raw.slice(0, 4000));
    process.exit(1);
  }

  const { errors, warns, taskCount } = validatePlan(plan, {
    allowedIds: ALLOWED_SOURCE_REFS,
  });

  console.log('\n校验结果:');
  console.log('  任务总数:', taskCount);
  if (warns.length) {
    console.log('  警告:', warns.length);
    for (const w of warns) console.log('   - ', w);
  }
  if (errors.length) {
    console.log('  失败:', errors.length);
    for (const err of errors) console.log('   - ', err);
    console.log('\n（节选）规范化 JSON:', JSON.stringify(plan, null, 2).slice(0, 6000));
    process.exit(1);
  }

  console.log('  全部通过（sourceRef 均在任务池中）');
  console.log(JSON.stringify(plan, null, 2));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
