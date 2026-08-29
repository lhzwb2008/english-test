/**
 * 从零跑通一道对话排序错题讲解视频。
 * 默认用案例里的分镜（节奏已按老师意见压过）；加 --llm 则让 Qwen 重新写分镜。
 *
 *   npm run video:case
 *   npm run video:case -- --llm
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJob, getJob } from '../server/lib/videoJobs.mjs';
import { runHomeworkVideoJob } from '../server/lib/grammarVideoPipeline.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const caseFile = path.join(root, 'server/data/cases/dialogue-order-q5.json');
const useLlm = process.argv.includes('--llm');

const data = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
const question = data.question;
const title = question.title || question.stem || '错题讲解';

const input = {
  question,
  storyboard: useLlm ? undefined : data.storyboard,
};

console.log(
  `[video:case] ${useLlm ? 'Qwen 生成分镜' : '使用案例分镜'} · ${title}`,
);

const job = createJob(input, title);
console.log(`[video:case] job_id=${job.job_id}`);
console.log(`[video:case] work_dir=${job.work_dir}`);

try {
  await runHomeworkVideoJob(job.job_id, process.env.PUBLIC_BASE_URL || '');
} catch (err) {
  if (!useLlm) throw err;
  console.warn('[video:case] LLM 分镜失败，回退案例分镜:', err?.message || err);
  const fallback = createJob(
    { question, storyboard: data.storyboard },
    title,
  );
  await runHomeworkVideoJob(fallback.job_id, process.env.PUBLIC_BASE_URL || '');
  printDone(fallback.job_id);
  process.exit(0);
}

printDone(job.job_id);

function printDone(jobId) {
  const done = getJob(jobId);
  const preview = path.join(root, 'tmp', 'homework-explainer-case.mp4');
  if (done?.video_path && fs.existsSync(done.video_path)) {
    fs.mkdirSync(path.dirname(preview), { recursive: true });
    fs.copyFileSync(done.video_path, preview);
  }
  console.log(
    JSON.stringify(
      {
        job_id: done?.job_id,
        status: done?.status,
        progress: done?.progress,
        title: done?.title,
        error: done?.error,
        video_path: done?.video_path,
        preview_copy: fs.existsSync(preview) ? preview : null,
        video_url: done?.video_url,
      },
      null,
      2,
    ),
  );
}
