/**
 * 将 learning-plan-head.md 与 builtin-tasks-from-excels.md 合并为 learning-plan.md
 *（扣子「学习计划」智能体发布的完整 Prompt）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HEAD = path.join(ROOT, 'coze/prompts/learning-plan-head.md');
const BUILTIN = path.join(ROOT, 'coze/prompts/builtin-tasks-from-excels.md');
const OUT = path.join(ROOT, 'coze/prompts/learning-plan.md');

async function main() {
  const [head, builtin] = await Promise.all([
    fs.readFile(HEAD, 'utf8'),
    fs.readFile(BUILTIN, 'utf8'),
  ]);
  const md = `${head.trimEnd()}\n\n${builtin.trimStart()}`;
  await fs.writeFile(OUT, md, 'utf8');
  const lines = md.split(/\r?\n/).length;
  console.log('Written', OUT, `(${lines} lines)`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
