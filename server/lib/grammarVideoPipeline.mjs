/**
 * 错题讲解视频：分镜 JSON → 模板 PNG → 中英分轨 TTS → ffmpeg → OSS
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from './jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from './prompts.mjs';
import { synthesizeToFile, ttsRate, ttsVoice } from './bailianTts.mjs';
import { sceneToSvg } from './homeworkScenes.mjs';
import { renderSvgToPng } from './svgRender.mjs';
import {
  composeSlideshow,
  concatAudioFiles,
  writeSilence,
} from './videoCompose.mjs';
import { updateJob, getJob } from './videoJobs.mjs';
import { ossConfigured, uploadGrammarVideo } from './ossUpload.mjs';
import {
  countEmptyRawNarration,
  fallbackNarration,
  normalizeStoryboard,
} from './storyboardNormalize.mjs';

/** @type {string[]} */
const queue = [];
let running = false;
let resumed = false;

/**
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
        console.log('[homework-video] resume job', job.job_id, job.status);
        updateJob(job.job_id, {
          status: 'queued',
          progress: 'queued',
          error: null,
        });
        enqueueVideoJob(job.job_id, publicBaseUrl || process.env.PUBLIC_BASE_URL || '');
      }
    }
  } catch (err) {
    console.warn('[homework-video] resume failed', err?.message || err);
  }
}

/**
 * @param {string} jobId
 * @param {string} [publicBaseUrl]
 */
export function enqueueVideoJob(jobId, publicBaseUrl) {
  const payload = JSON.stringify({ jobId, publicBaseUrl: publicBaseUrl || '' });
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
      console.error('[homework-video] job failed', jobId, err);
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

export function runHomeworkVideoJob(jobId, publicBaseUrl = '') {
  return runPipeline(jobId, publicBaseUrl);
}

function minDurationFor(type) {
  if (type === 'answer') return 8;
  if (type === 'trap') return 7.5;
  if (type === 'ending') return 5;
  return 0;
}

function pauseAfter() {
  return 0.22;
}

function isKnowledgeVideo(input) {
  return (
    input?.video_kind === 'knowledge' ||
    (Boolean(input?.knowledge_point) && !input?.question)
  );
}

async function buildStoryboard(input, title) {
  if (input.storyboard && typeof input.storyboard === 'object') {
    return normalizeStoryboard(input.storyboard, title);
  }
  const knowledge = isKnowledgeVideo(input);
  const prompt = loadPrompt(
    knowledge ? 'knowledge-video-script.md' : 'homework-video-script.md',
  );
  const fields = knowledge
    ? {
        knowledge_point: input.knowledge_point,
        focus_points: input.focus_points,
        explanation_style: input.explanation_style,
        material: input.material,
        student_profile: input.student_profile,
        trait_voice: input.trait_voice,
        duration_target: '60-90 seconds, brisk pacing',
      }
    : {
        question: input.question,
        answer: input.question?.student_answer,
        options: input.question?.options,
        student_profile: input.student_profile,
        trait_voice: input.trait_voice,
        duration_target: '60-90 seconds, brisk pacing',
      };

  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
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
      if (emptyN) {
        console.warn(
          `[homework-video] 模型漏写口播 ${emptyN} 页，已用画面文案补齐`,
        );
      }
      return normalizeStoryboard(parsed, title);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[homework-video] 分镜第 ${attempt}/4 次失败:`,
        err?.message || err,
      );
    }
  }
  throw lastErr || new Error('分镜生成失败');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function synthesizeWithRetry(text, outPath, opts, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await synthesizeToFile(text, outPath, opts);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[homework-video] TTS 第 ${i}/${attempts} 次失败:`,
        err?.message || err,
      );
      if (i < attempts) await sleep(400 * i);
    }
  }
  throw lastErr;
}

async function synthSceneAudio(scene, workDir, index) {
  let segs = Array.isArray(scene.narration) ? scene.narration.filter((s) => s?.text) : [];
  if (!segs.length) {
    segs = fallbackNarration(scene);
    console.warn(
      `[homework-video] 场景 ${scene.id || index} 口播为空，已用画面文案补齐`,
    );
  }
  if (!segs.length) {
    throw new Error(`场景 ${scene.id || index} 无口播`);
  }
  const parts = [];
  const silDir = path.join(workDir, 'silence');
  fs.mkdirSync(silDir, { recursive: true });

  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    const stem = `tts_${String(index).padStart(2, '0')}_${String(i).padStart(2, '0')}`;
    const mp3 = path.join(workDir, `${stem}.mp3`);
    await synthesizeWithRetry(seg.text, mp3, {
      voice: ttsVoice(),
      rate: ttsRate(),
    });
    parts.push(mp3);
    if (i < segs.length - 1) {
      const sil = path.join(silDir, `sil_${pauseAfter()}.mp3`);
      if (!fs.existsSync(sil)) writeSilence(pauseAfter(), sil);
      parts.push(sil);
    }
  }

  const out = path.join(workDir, `scene_${String(index).padStart(2, '0')}.mp3`);
  concatAudioFiles(parts, out);
  return out;
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
  const title = job.title || job.knowledge_point || '错题讲解';
  const workDir = job.work_dir;
  fs.mkdirSync(workDir, { recursive: true });

  const script = await buildStoryboard(input, title);
  fs.writeFileSync(path.join(workDir, 'script.json'), JSON.stringify(script, null, 2));

  updateJob(jobId, { progress: 'slides', title: script.title });

  const composeSlides = [];
  for (let i = 0; i < script.scenes.length; i += 1) {
    const scene = script.scenes[i];
    const svg = sceneToSvg(scene);
    const imgPath = path.join(workDir, `slide_${String(i).padStart(2, '0')}.png`);
    fs.writeFileSync(path.join(workDir, `slide_${String(i).padStart(2, '0')}.svg`), svg);
    renderSvgToPng(svg, imgPath);
    composeSlides.push({ imagePath: imgPath, scene });
  }

  updateJob(jobId, { progress: 'tts' });
  const withAudio = [];
  for (let i = 0; i < composeSlides.length; i += 1) {
    const audioPath = await synthSceneAudio(composeSlides[i].scene, workDir, i);
    withAudio.push({
      imagePath: composeSlides[i].imagePath,
      audioPath,
      minDuration: minDurationFor(composeSlides[i].scene.type),
    });
  }
  if (!withAudio.length) throw new Error('无有效口播音频');

  updateJob(jobId, { progress: 'compose' });
  const outMp4 = path.join(workDir, 'output.mp4');
  composeSlideshow(withAudio, outMp4);

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
    title: script.title,
    video_path: outMp4,
    video_url: videoUrl,
    expires_at: expiresAt,
    finished_at: new Date().toISOString(),
    error: null,
    ...(ossKey ? { oss_key: ossKey } : {}),
  });
}
