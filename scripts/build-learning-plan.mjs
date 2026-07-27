/**
 * 将 learning-plan-head.md 同步为 learning-plan.md（扣子「学习计划」智能体发布的完整 Prompt）。
 *
 * 题库由客户端每次请求注入 system_task_pool，不再把 builtin-tasks-from-excels.md
 * 合并进发布 Prompt（该文件仍保留在仓库，供教研导出/对照，不进 Bot 上下文）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HEAD = path.join(ROOT, 'coze/prompts/learning-plan-head.md');
const OUT = path.join(ROOT, 'coze/prompts/learning-plan.md');

async function main() {
  const head = await fs.readFile(HEAD, 'utf8');
  const md = `${head.trimEnd()}\n`;
  await fs.writeFile(OUT, md, 'utf8');
  const bytes = Buffer.byteLength(md, 'utf8');
  const lines = md.split(/\r?\n/).length;
  console.log('Written', OUT, `(${lines} lines, ${bytes} bytes)`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
