/**
 * 知识点口播视频编排：drill 讲解 → 分镜 → 生图 → TTS → ffmpeg → 本地可访问 URL（48h）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from './jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from './prompts.mjs';
import { synthesizeToFile } from './bailianTts.mjs';
import { generateImageToFile } from './bailianImage.mjs';
import {
  buildWhiteboardPrompt,
  completeCursorJson,
  cursorConfigured,
  cursorModelId,
} from './cursorClient.mjs';
import { composeVerticalVideo } from './videoCompose.mjs';
import { updateJob, getJob } from './videoJobs.mjs';
import { ossConfigured, uploadGrammarVideo } from './ossUpload.mjs';

/** @type {string[]} */
const queue = [];
let running = false;
let resumed = false;

/**
 * 进程启动后把磁盘上未完成的任务重新入队（pm2 重启场景）
 * @param {string} [publicBaseUrl]
 */
export function resumeInterruptedJobs(publicBaseUrl = '') {
  if (resumed) return;
  resumed = true;
  try {
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../data/video-jobs',
    );
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const job = getJob(name.replace(/\.json$/, ''));
      if (!job) continue;
      if (job.status === 'queued' || job.status === 'running') {
        console.log('[grammar-video] resume job', job.job_id, job.status);
        updateJob(job.job_id, {
          status: 'queued',
          progress: 'queued',
          error: null,
        });
        enqueueVideoJob(job.job_id, publicBaseUrl || process.env.PUBLIC_BASE_URL || '');
      }
    }
  } catch (err) {
    console.warn('[grammar-video] resume failed', err?.message || err);
  }
}

/**
 * @param {string} jobId
 * @param {string} [publicBaseUrl]
 */
export function enqueueVideoJob(jobId, publicBaseUrl) {
  const payload = JSON.stringify({ jobId, publicBaseUrl: publicBaseUrl || '' });
  if (queue.includes(payload)) return;
  // 避免同一 job 重复入队
  if (queue.some((x) => {
    try {
      return JSON.parse(x).jobId === jobId;
    } catch {
      return false;
    }
  })) {
    return;
  }
  queue.push(payload);
  kick();
}

function kick() {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = true;
  const { jobId, publicBaseUrl } = JSON.parse(next);
  runPipeline(jobId, publicBaseUrl)
    .catch((err) => {
      console.error('[grammar-video] job failed', jobId, err);
      updateJob(jobId, {
        status: 'failed',
        error: err?.message || String(err),
        finished_at: new Date().toISOString(),
      });
    })
    .finally(() => {
      running = false;
      kick();
    });
}

function maxSlides() {
  const n = Number(process.env.GRAMMAR_VIDEO_MAX_SLIDES || 5);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 3), 5) : 5;
}

/** 生图并发：默认等于页数（全部并行）；可用 GRAMMAR_VIDEO_IMAGE_CONCURRENCY 限流 */
function imageConcurrency(slideCount) {
  const raw = process.env.GRAMMAR_VIDEO_IMAGE_CONCURRENCY;
  if (raw === undefined || raw === '') {
    return Math.max(1, slideCount);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(1, slideCount);
  return Math.min(Math.max(Math.floor(n), 1), Math.max(1, slideCount));
}

/**
 * 生图：百炼万相（稳定）；全部并行时每页独立请求
 * @param {string} prompt
 * @param {string} outPath
 */
async function generateSlideImage(prompt, outPath) {
  console.log(
    `[grammar-video] image via Bailian ${process.env.DASHSCOPE_IMAGE_MODEL || 'wan2.5-t2i-preview'}`,
  );
  await generateImageToFile(prompt, outPath);
}

/**
 * 简单并发池（不依赖 Cursor Agent）
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapPool(items, concurrency, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * 口播文案：优先 Cursor Cloud Grok；未配置时回退 Qwen
 * @param {string} systemPrompt
 * @param {Record<string, unknown>} fields
 */
async function completeVideoJson(systemPrompt, fields) {
  const userPayload = buildUserPayload(fields);
  if (cursorConfigured()) {
    console.log(`[grammar-video] text via Cursor ${cursorModelId()}`);
    return completeCursorJson(systemPrompt, userPayload);
  }
  console.warn('[grammar-video] CURSOR 未配置，回退 Qwen 文本');
  const { fullText } = await completeQwenText({
    model: textModel(),
    systemPrompt,
    userText: userPayload,
    json: true,
    temperature: 0.4,
  });
  return parseJsonFromModel(fullText);
}

/**
 * @param {string} jobId
 * @param {string} publicBaseUrl
 */
async function runPipeline(jobId, publicBaseUrl) {
  const job = getJob(jobId);
  if (!job) throw new Error(`任务不存在: ${jobId}`);

  updateJob(jobId, {
    status: 'running',
    progress: 'script',
    started_at: new Date().toISOString(),
    error: null,
  });

  const input = job.input || {};
  const knowledgePoint = job.knowledge_point;
  const workDir = job.work_dir;
  fs.mkdirSync(workDir, { recursive: true });

  // 1) 讲解+分镜一次完成（Cursor / 回退 Qwen）
  const scriptPrompt = loadPrompt('grammar-video-script.md');
  const script = await completeVideoJson(scriptPrompt, {
    knowledge_point: knowledgePoint,
    explanation_style: input.explanation_style,
    student_profile: input.student_profile,
    focus_points: input.focus_points,
    // 有学生特点时模型必须贴合；显式写出便于 prompt 侧自检
    has_student_traits: Boolean(
      input.student_profile &&
        (input.student_profile.traits || input.student_profile.study_history),
    ),
    max_slides: maxSlides(),
    duration_target: 'about 1 minute',
  });
  let slides = Array.isArray(script.slides) ? script.slides : [];
  slides = slides.slice(0, maxSlides());
  if (slides.length < 3) {
    throw new Error(`分镜页数不足（需要≥3）: ${slides.length}`);
  }
  fs.writeFileSync(
    path.join(workDir, 'script.json'),
    JSON.stringify(
      {
        ...script,
        explanation_style:
          script.explanation_style || input.explanation_style || 'fun',
      },
      null,
      2,
    ),
  );

  const title = String(script.title || knowledgePoint).trim();

  /** @type {Array<{ imagePath: string, audioPath: string, subtitle: string }>} */
  const composeSlides = [];

  // 2) 生图：百炼万相，全部并行
  updateJob(jobId, { progress: 'images' });
  const imageTasks = slides.map((slide, i) => {
    const labels = Array.isArray(slide?.on_image_text)
      ? slide.on_image_text.filter((x) => typeof x === 'string').slice(0, 5)
      : [];
    const visual =
      String(slide?.visual_prompt || '').trim() ||
      `English grammar teaching diagram about ${knowledgePoint}`;
    const prompt = buildWhiteboardPrompt({
      imagePrompt: visual,
      onImageText: labels,
      pageIndex: i + 1,
      totalPages: slides.length,
      chapterTitle: title,
    });
    const stem = `slide_${String(i).padStart(2, '0')}`;
    return {
      prompt,
      imgPath: path.join(workDir, `${stem}.png`),
    };
  });

  const conc = imageConcurrency(imageTasks.length);
  console.log(
    `[grammar-video] bailian images: ${imageTasks.length} slides, concurrency=${conc}`,
  );
  const imagePaths = await mapPool(imageTasks, conc, async (task) => {
    await generateSlideImage(task.prompt, task.imgPath);
    return task.imgPath;
  });

  // 3) TTS
  updateJob(jobId, { progress: 'tts' });
  for (let i = 0; i < slides.length; i += 1) {
    const narration = String(slides[i]?.narration || '').trim();
    if (!narration) continue;
    const audioPath = path.join(workDir, `tts_${String(i).padStart(2, '0')}.mp3`);
    await synthesizeToFile(narration, audioPath);
    composeSlides.push({
      imagePath: imagePaths[i],
      audioPath,
      subtitle: narration,
    });
  }
  if (!composeSlides.length) throw new Error('无有效口播音频');

  // 4) 合成
  updateJob(jobId, { progress: 'compose' });
  const outMp4 = path.join(workDir, 'output.mp4');
  composeVerticalVideo(composeSlides, outMp4);

  // 5) 上传 OSS
  updateJob(jobId, { progress: 'upload' });
  let videoUrl = '';
  /** @type {string | null} */
  let expiresAt = null;
  /** @type {string | null} */
  let ossKey = null;

  if (ossConfigured()) {
    const uploaded = await uploadGrammarVideo(jobId, outMp4);
    videoUrl = uploaded.url;
    expiresAt = uploaded.expires_at;
    ossKey = uploaded.key;
  } else {
    expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const base = (publicBaseUrl || '').replace(/\/$/, '');
    videoUrl = base
      ? `${base}/v1/grammar/video/${jobId}/file`
      : `/v1/grammar/video/${jobId}/file`;
  }

  updateJob(jobId, {
    status: 'succeeded',
    progress: 'done',
    video_path: outMp4,
    video_url: videoUrl,
    expires_at: expiresAt,
    finished_at: new Date().toISOString(),
    error: null,
    ...(ossKey ? { oss_key: ossKey } : {}),
  });
}
