/**
 * 知识点口播视频编排：drill 讲解 → 分镜 → 生图 → TTS → ffmpeg → 本地可访问 URL（48h）
 */
import fs from 'node:fs';
import path from 'node:path';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from './jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from './prompts.mjs';
import { synthesizeToFile } from './bailianTts.mjs';
import { generateImageToFile } from './bailianImage.mjs';
import { composeVerticalVideo } from './videoCompose.mjs';
import { updateJob, getJob } from './videoJobs.mjs';

/** @type {string[]} */
const queue = [];
let running = false;

/**
 * @param {string} jobId
 * @param {string} [publicBaseUrl]
 */
export function enqueueVideoJob(jobId, publicBaseUrl) {
  queue.push(JSON.stringify({ jobId, publicBaseUrl: publicBaseUrl || '' }));
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
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 3), 6) : 5;
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

  // 1) 讲解（复用 drill prompt；题目可生成但视频不用）
  const model = textModel();
  const drillPrompt = loadPrompt('grammar-drill.md');
  const drillUser = buildUserPayload({
    knowledge_point: knowledgePoint,
    student_profile: input.student_profile,
    focus_points: input.focus_points,
    question_count: 3,
    question_types: ['choice'],
  });
  const drillRes = await completeQwenText({
    model,
    systemPrompt: drillPrompt,
    userText: drillUser,
    json: true,
    temperature: 0.4,
  });
  const drillData = parseJsonFromModel(drillRes.fullText);
  const explanation = String(drillData.explanation_markdown || '').trim();
  if (!explanation) throw new Error('讲解生成失败：explanation_markdown 为空');
  fs.writeFileSync(
    path.join(workDir, 'drill.json'),
    JSON.stringify(drillData, null, 2),
  );

  // 2) 分镜脚本
  updateJob(jobId, { progress: 'script' });
  const scriptPrompt = loadPrompt('grammar-video-script.md');
  const scriptUser = buildUserPayload({
    knowledge_point: knowledgePoint,
    explanation_markdown: explanation,
    student_profile: input.student_profile,
    focus_points: input.focus_points,
    max_slides: maxSlides(),
  });
  const scriptRes = await completeQwenText({
    model,
    systemPrompt: scriptPrompt,
    userText: scriptUser,
    json: true,
    temperature: 0.5,
  });
  const script = parseJsonFromModel(scriptRes.fullText);
  let slides = Array.isArray(script.slides) ? script.slides : [];
  slides = slides.slice(0, maxSlides());
  if (slides.length < 3) {
    throw new Error(`分镜页数不足: ${slides.length}`);
  }
  fs.writeFileSync(
    path.join(workDir, 'script.json'),
    JSON.stringify(script, null, 2),
  );

  // cold_open 作为可选首段 TTS（叠到第一页前：单独短页）
  const coldOpen = String(script.cold_open || '').trim();

  /** @type {Array<{ imagePath: string, audioPath: string, subtitle: string }>} */
  const composeSlides = [];

  // 3) 生图
  updateJob(jobId, { progress: 'images' });
  const imagePaths = [];
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i] || {};
    const labels = Array.isArray(slide.on_image_text)
      ? slide.on_image_text.filter((x) => typeof x === 'string').slice(0, 5)
      : [];
    const visual =
      String(slide.visual_prompt || '').trim() ||
      `Simple educational whiteboard sketch about ${knowledgePoint}, clean flat illustration, vertical poster`;
    const prompt = [
      visual,
      'style: clean whiteboard hand-drawn teaching illustration, soft paper background, no photorealistic face, no watermark',
      labels.length ? `on-image labels (draw as handwritten Chinese notes): ${labels.join(' / ')}` : '',
    ]
      .filter(Boolean)
      .join('. ');
    const imgPath = path.join(workDir, `slide_${String(i).padStart(2, '0')}.png`);
    await generateImageToFile(prompt, imgPath);
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

  // 6) 「上传」：百炼临时 oss:// 不可浏览器播放；对外提供本服务 48h 文件 URL
  updateJob(jobId, { progress: 'upload' });
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const base = (publicBaseUrl || '').replace(/\/$/, '');
  const videoUrl = base
    ? `${base}/v1/grammar/video/${jobId}/file`
    : `/v1/grammar/video/${jobId}/file`;

  updateJob(jobId, {
    status: 'succeeded',
    progress: 'done',
    video_path: outMp4,
    video_url: videoUrl,
    expires_at: expiresAt,
    finished_at: new Date().toISOString(),
    error: null,
  });
}
