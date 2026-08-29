/**
 * 错题讲解视频：分镜 JSON → 模板 PNG → 中英分轨 TTS → ffmpeg → OSS
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from './jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from './prompts.mjs';
import {
  enRate,
  enVoice,
  synthesizeToFile,
  zhRate,
  zhVoice,
} from './bailianTts.mjs';
import { sceneToSvg } from './homeworkScenes.mjs';
import { renderSvgToPng } from './svgRender.mjs';
import {
  composeSlideshow,
  concatAudioFiles,
  writeSilence,
} from './videoCompose.mjs';
import { updateJob, getJob } from './videoJobs.mjs';
import { ossConfigured, uploadGrammarVideo } from './ossUpload.mjs';

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

function pauseAfter(voice) {
  return voice === 'en' ? 0.16 : 0.2;
}

function normalizeNarration(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return null;
      const text = String(seg.text || '').trim();
      if (!text) return null;
      const voice = String(seg.voice || 'zh').toLowerCase() === 'en' ? 'en' : 'zh';
      return { voice, text };
    })
    .filter(Boolean);
}

function normalizeStoryboard(raw, fallbackTitle) {
  const title = String(raw?.title || fallbackTitle || '错题讲解').trim();
  const mnemonic = String(raw?.mnemonic || '').trim();
  let scenes = Array.isArray(raw?.scenes) ? raw.scenes.filter((s) => s && typeof s === 'object') : [];
  scenes = scenes.slice(0, 7);
  if (scenes.length < 4) {
    throw new Error(`分镜页数不足（需要≥4）: ${scenes.length}`);
  }
  const types = new Set(scenes.map((s) => String(s.type || '')));
  if (!types.has('trap')) {
    throw new Error('分镜缺少 trap（易错对比）场景');
  }
  if (!types.has('answer') && !types.has('ending')) {
    throw new Error('分镜缺少 answer 或 ending');
  }
  return {
    title,
    mnemonic,
    scenes: scenes.map((s, i) => ({
      ...s,
      id: String(s.id || `s${i + 1}`),
      type: String(s.type || 'step'),
      narration: normalizeNarration(s.narration),
    })),
  };
}

async function buildStoryboard(input, title) {
  if (input.storyboard && typeof input.storyboard === 'object') {
    return normalizeStoryboard(input.storyboard, title);
  }
  const prompt = loadPrompt('homework-video-script.md');
  const { fullText } = await completeQwenText({
    model: textModel(),
    systemPrompt: prompt,
    userText: buildUserPayload({
      question: input.question,
      student_profile: input.student_profile,
      duration_target: '60-90 seconds, brisk pacing',
    }),
    json: true,
    temperature: 0.3,
  });
  return normalizeStoryboard(parseJsonFromModel(fullText), title);
}

async function synthSceneAudio(scene, workDir, index) {
  const segs = scene.narration;
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
    try {
      await synthesizeToFile(seg.text, mp3, {
        voice: seg.voice === 'en' ? enVoice() : zhVoice(),
        rate: seg.voice === 'en' ? enRate() : zhRate(),
      });
    } catch (err) {
      if (seg.voice !== 'en') throw err;
      console.warn(
        '[homework-video] 英文音色失败，回退中文音色:',
        err?.message || err,
      );
      await synthesizeToFile(seg.text, mp3, {
        voice: zhVoice(),
        rate: enRate(),
      });
    }
    parts.push(mp3);
    if (i < segs.length - 1) {
      const sil = path.join(silDir, `sil_${pauseAfter(seg.voice)}.mp3`);
      if (!fs.existsSync(sil)) writeSilence(pauseAfter(seg.voice), sil);
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
