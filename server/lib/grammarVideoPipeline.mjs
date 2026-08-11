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
  generateCursorImageToFile,
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
  const n = Number(process.env.GRAMMAR_VIDEO_MAX_SLIDES || 8);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 5), 8) : 8;
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
 * 生图：优先 Cursor Cloud Grok 内置生图；未配置时回退百炼万相
 */
async function generateSlideImage(prompt, outPath, artifactName) {
  if (cursorConfigured()) {
    await generateCursorImageToFile(prompt, outPath, { artifactName });
    return;
  }
  console.warn('[grammar-video] CURSOR 未配置，回退百炼万相生图');
  await generateImageToFile(prompt, outPath);
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
    progress: 'drill',
    started_at: new Date().toISOString(),
    error: null,
  });

  const input = job.input || {};
  const knowledgePoint = job.knowledge_point;
  const workDir = job.work_dir;
  fs.mkdirSync(workDir, { recursive: true });

  // 1) 讲解（Cursor Grok / 回退 Qwen）；视频只用 explanation
  const drillPrompt = loadPrompt('grammar-drill.md');
  const drillData = await completeVideoJson(drillPrompt, {
    knowledge_point: knowledgePoint,
    student_profile: input.student_profile,
    focus_points: input.focus_points,
    question_count: 3,
    question_types: ['choice'],
  });
  const explanation = String(drillData.explanation_markdown || '').trim();
  if (!explanation) throw new Error('讲解生成失败：explanation_markdown 为空');
  fs.writeFileSync(
    path.join(workDir, 'drill.json'),
    JSON.stringify(drillData, null, 2),
  );

  // 2) 分镜脚本（1–3 分钟，高教学密度）
  updateJob(jobId, { progress: 'script' });
  const scriptPrompt = loadPrompt('grammar-video-script.md');
  const script = await completeVideoJson(scriptPrompt, {
    knowledge_point: knowledgePoint,
    explanation_markdown: explanation,
    student_profile: input.student_profile,
    focus_points: input.focus_points,
    max_slides: maxSlides(),
    duration_target: '1-3 minutes',
  });
  let slides = Array.isArray(script.slides) ? script.slides : [];
  slides = slides.slice(0, maxSlides());
  if (slides.length < 5) {
    throw new Error(`分镜页数不足（需要≥5）: ${slides.length}`);
  }
  fs.writeFileSync(
    path.join(workDir, 'script.json'),
    JSON.stringify(script, null, 2),
  );

  const coldOpen = String(script.cold_open || '').trim();
  const title = String(script.title || knowledgePoint).trim();

  /** @type {Array<{ imagePath: string, audioPath: string, subtitle: string }>} */
  const composeSlides = [];

  // 3) 生图（Cursor Grok 内置生图 / 回退万相）
  updateJob(jobId, { progress: 'images' });
  const imagePaths = [];
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i] || {};
    const labels = Array.isArray(slide.on_image_text)
      ? slide.on_image_text.filter((x) => typeof x === 'string').slice(0, 5)
      : [];
    const visual =
      String(slide.visual_prompt || '').trim() ||
      `English grammar teaching diagram about ${knowledgePoint}`;
    const prompt = buildWhiteboardPrompt({
      imagePrompt: visual,
      onImageText: labels,
      pageIndex: i + 1,
      totalPages: slides.length,
      chapterTitle: title,
    });
    const stem = `slide_${String(i).padStart(2, '0')}`;
    const imgPath = path.join(workDir, `${stem}.png`);
    await generateSlideImage(prompt, imgPath, `artifacts/${jobId}_${stem}.png`);
    imagePaths.push(imgPath);
  }

  // 4) TTS
  updateJob(jobId, { progress: 'tts' });
  if (coldOpen) {
    const coldAudio = path.join(workDir, 'cold_open.mp3');
    await synthesizeToFile(coldOpen, coldAudio);
    composeSlides.push({
      imagePath: imagePaths[0],
      audioPath: coldAudio,
      subtitle: coldOpen,
    });
  }

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

  // 5) 合成
  updateJob(jobId, { progress: 'compose' });
  const outMp4 = path.join(workDir, 'output.mp4');
  composeVerticalVideo(composeSlides, outMp4);

  // 6) 上传 OSS
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
