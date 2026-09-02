/**
 * 视频管线稳定性：离线兜底 × 多次、Qwen 分镜 × 多次、成片 × 3。
 *
 *   npm run video:stability
 *   npm run video:stability -- --offline   # 只跑规范化 + 出图
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeQwenText } from '../server/qwen/client.mjs';
import { parseJsonFromModel } from '../server/lib/jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from '../server/lib/prompts.mjs';
import {
  assertScenesHaveNarration,
  countEmptyRawNarration,
  normalizeNarration,
  normalizeStoryboard,
} from '../server/lib/storyboardNormalize.mjs';
import { sceneToSvg } from '../server/lib/homeworkScenes.mjs';
import { renderSvgToPng } from '../server/lib/svgRender.mjs';
import { createJob, getJob } from '../server/lib/videoJobs.mjs';
import { runHomeworkVideoJob } from '../server/lib/grammarVideoPipeline.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const offlineOnly = process.argv.includes('--offline');
let failed = 0;
let passed = 0;

function say(msg) {
  fs.writeSync(process.stdout.fd, `${msg}\n`);
}

function ok(name) {
  passed += 1;
  say(`  PASS  ${name}`);
}

function fail(name, err) {
  failed += 1;
  fs.writeSync(process.stderr.fd, `  FAIL  ${name}: ${err?.message || err}\n`);
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log = (...args) => say(args.map(String).join(' '));
console.warn = (...args) =>
  fs.writeSync(process.stderr.fd, `${args.map(String).join(' ')}\n`);
console.error = (...args) =>
  fs.writeSync(process.stderr.fd, `${args.map(String).join(' ')}\n`);

const emptyRaw = JSON.parse(
  fs.readFileSync(
    path.join(root, 'server/data/cases/empty-narration-knowledge.json'),
    'utf8',
  ),
);
const homeworkCase = JSON.parse(
  fs.readFileSync(
    path.join(root, 'server/data/cases/dialogue-order-q5.json'),
    'utf8',
  ),
);

const allenKnowledge = {
  video_kind: 'knowledge',
  knowledge_point: '口语基础语法：名词复数、主谓一致与过去时',
  focus_points: [
    '可数名词泛指时加复数',
    '代词与人物性别一致',
    '描述过去经历用一般过去时',
    'on phones / on mobile devices 等固定搭配',
  ],
  student_profile: {
    current_score: '130',
    grade: '五年级',
    study_history: 'THINK1已学完，KET130分通过',
    target_score: '150',
  },
  textbook: 'THINK2',
  unit_ref: 'Unit4',
};

console.log('\n== 1. 离线：Allen 失败分镜（空 narration）规范化 8 次 ==');
for (let i = 1; i <= 8; i += 1) {
  try {
    expect(countEmptyRawNarration(emptyRaw) === 7, 'fixture 应 7 页空口播');
    const script = normalizeStoryboard(emptyRaw, emptyRaw.title);
    assertScenesHaveNarration(script);
    expect(script.scenes.length === 7, `期望 7 页，得到 ${script.scenes.length}`);
    expect(script.scenes[0].id === 's1', '第一页应为 s1');
    expect(
      script.scenes.every((s) => s.narration[0].text.length >= 2),
      '每页口播过短',
    );
    expect(script.scenes[6].mnemonic, 'ending 应带上口诀');
    ok(`empty-narration normalize #${i}（${script.scenes.length} 页皆有口播）`);
  } catch (err) {
    fail(`empty-narration normalize #${i}`, err);
  }
}

console.log('\n== 2. 离线：畸形口播字段 ==');
const malformed = [
  ['string', '先找开头再看答句。'],
  ['string-array', ['第一步找开头。', '这是第一句。']],
  ['zh-en-object', { zh: '代词要跟性别走。', en: 'She likes music.' }],
  ['alt-keys', [{ content: '昨天用过去时。', voice: 'zh' }]],
  ['empty-array', []],
  ['null', null],
  ['missing', undefined],
  ['blank-objects', [{ text: '  ' }, { zh: '' }]],
];
const stepScene = {
  type: 'step',
  title: '可数名词加复数',
  lines: [{ en: 'I like books.', zh: '我喜欢书。' }],
};
for (const [name, raw] of malformed) {
  try {
    const segs = normalizeNarration(raw, stepScene, '口诀一句');
    expect(segs.length >= 1 && segs[0].text, `${name} 仍无口播`);
    ok(`malformed ${name} → ${segs.length} 段`);
  } catch (err) {
    fail(`malformed ${name}`, err);
  }
}

console.log('\n== 3. 离线：类型别名 + 空口播分镜出图 ==');
try {
  const aliased = JSON.parse(JSON.stringify(emptyRaw));
  aliased.scenes[0].type = 'title-card';
  aliased.scenes[4].type = 'compare';
  aliased.scenes[5].type = 'summary';
  aliased.scenes[6].type = 'outro';
  const script = normalizeStoryboard(aliased, emptyRaw.title);
  expect(script.scenes[0].type === 'intro', 'title-card → intro');
  expect(script.scenes[4].type === 'trap', 'compare → trap');
  expect(script.scenes[5].type === 'answer', 'summary → answer');
  expect(script.scenes[6].type === 'ending', 'outro → ending');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-stab-'));
  for (let i = 0; i < script.scenes.length; i += 1) {
    const png = path.join(dir, `s${i}.png`);
    renderSvgToPng(sceneToSvg(script.scenes[i]), png);
    expect(fs.statSync(png).size > 1000, `${script.scenes[i].id} 图片过小`);
  }
  ok(`类型别名 + SVG→PNG ${script.scenes.length} 页`);
} catch (err) {
  fail('alias + SVG render', err);
}

if (!offlineOnly) {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ok('本机 ffmpeg 可用');
  } catch (err) {
    fail('ffmpeg', new Error('未找到 ffmpeg'));
  }

  async function llmStoryboard(kind, fields, title, n) {
    const prompt = loadPrompt(
      kind === 'knowledge'
        ? 'knowledge-video-script.md'
        : 'homework-video-script.md',
    );
    for (let i = 1; i <= n; i += 1) {
      let lastErr;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        say(`    … ${kind} 分镜 #${i} 第 ${attempt}/4 次`);
        try {
          const { fullText } = await completeQwenText({
            model: textModel(),
            systemPrompt: prompt,
            userText: buildUserPayload(fields),
            json: true,
            temperature: attempt === 1 ? 0.2 : 0.32,
          });
          const parsed = parseJsonFromModel(fullText);
          const emptyN = countEmptyRawNarration(parsed);
          const script = normalizeStoryboard(parsed, title);
          assertScenesHaveNarration(script);
          const tag = emptyN ? `，模型漏写 ${emptyN} 页已兜底` : '';
          ok(`${kind} LLM 分镜 #${i}（${script.scenes.length} 页${tag}）`);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `    retry ${attempt}/4 ${kind} #${i}:`,
            err?.message || err,
          );
        }
      }
      if (lastErr) fail(`${kind} LLM 分镜 #${i}`, lastErr);
    }
  }

  console.log('\n== 4. Qwen 知识点分镜 × 3（Allen 入参，含重试） ==');
  await llmStoryboard(
    'knowledge',
    {
      knowledge_point: allenKnowledge.knowledge_point,
      focus_points: allenKnowledge.focus_points,
      student_profile: allenKnowledge.student_profile,
      duration_target: '60-90 seconds, brisk pacing',
    },
    allenKnowledge.knowledge_point,
    3,
  );

  console.log('\n== 5. Qwen 错题分镜 × 2 ==');
  await llmStoryboard(
    'homework',
    {
      question: homeworkCase.question,
      duration_target: '60-90 seconds, brisk pacing',
    },
    homeworkCase.question.title,
    2,
  );

  async function fullJob(label, input, title) {
    const job = createJob(input, title);
    say(`    … ${label} job=${job.job_id}`);
    try {
      await runHomeworkVideoJob(job.job_id, process.env.PUBLIC_BASE_URL || '');
      const done = getJob(job.job_id);
      expect(done?.status === 'succeeded', done?.error || done?.status);
      expect(done?.video_path && fs.existsSync(done.video_path), '缺少 mp4');
      const bytes = fs.statSync(done.video_path).size;
      expect(bytes > 80_000, `成片过小 ${bytes} bytes`);
      ok(`${label} 成片 ${job.job_id}（${Math.round(bytes / 1024)}KB）`);
      return done;
    } catch (err) {
      fail(label, err);
      return null;
    }
  }

  console.log('\n== 6. 端到成片 × 3（空口播回放 + 错题 + Allen 真 LLM） ==');
  await fullJob(
    'knowledge/empty-narration 回放',
    {
      ...allenKnowledge,
      storyboard: emptyRaw,
    },
    allenKnowledge.knowledge_point,
  );
  await fullJob(
    'homework/dialogue-order',
    {
      question: homeworkCase.question,
      storyboard: homeworkCase.storyboard,
    },
    homeworkCase.question.title,
  );
  await fullJob(
    'knowledge/Allen 真 LLM',
    allenKnowledge,
    allenKnowledge.knowledge_point,
  );
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
