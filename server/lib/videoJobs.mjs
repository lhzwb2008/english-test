import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data/video-jobs');
const WORK_ROOT =
  process.env.GRAMMAR_VIDEO_WORK_DIR ||
  path.join('/tmp', 'grammar-video');

/** @typedef {'queued'|'running'|'succeeded'|'failed'} JobStatus */
/** @typedef {'queued'|'drill'|'script'|'images'|'tts'|'compose'|'upload'|'done'} JobProgress */

/**
 * @typedef {object} VideoJob
 * @property {string} job_id
 * @property {JobStatus} status
 * @property {JobProgress} progress
 * @property {string} knowledge_point
 * @property {Record<string, unknown>} input
 * @property {string|null} video_url
 * @property {string|null} video_path
 * @property {string|null} expires_at
 * @property {string|null} error
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string|null} started_at
 * @property {string|null} finished_at
 * @property {string} work_dir
 */

/** @type {Map<string, VideoJob>} */
const memory = new Map();

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(WORK_ROOT, { recursive: true });
}

function jobPath(jobId) {
  return path.join(DATA_DIR, `${jobId}.json`);
}

/**
 * @param {VideoJob} job
 */
function persist(job) {
  ensureDirs();
  fs.writeFileSync(jobPath(job.job_id), JSON.stringify(job, null, 2));
  memory.set(job.job_id, job);
}

/**
 * @param {string} jobId
 * @returns {VideoJob | null}
 */
export function getJob(jobId) {
  if (memory.has(jobId)) return memory.get(jobId);
  const p = jobPath(jobId);
  if (!fs.existsSync(p)) return null;
  try {
    const job = JSON.parse(fs.readFileSync(p, 'utf8'));
    memory.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} knowledgePoint
 * @returns {VideoJob}
 */
export function createJob(input, knowledgePoint) {
  ensureDirs();
  const jobId = `vid_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const now = new Date().toISOString();
  const workDir = path.join(WORK_ROOT, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  /** @type {VideoJob} */
  const job = {
    job_id: jobId,
    status: 'queued',
    progress: 'queued',
    knowledge_point: knowledgePoint,
    input,
    video_url: null,
    video_path: null,
    expires_at: null,
    error: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
    work_dir: workDir,
  };
  persist(job);
  return job;
}

/**
 * @param {string} jobId
 * @param {Partial<VideoJob>} patch
 * @returns {VideoJob | null}
 */
export function updateJob(jobId, patch) {
  const job = getJob(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updated_at: new Date().toISOString() });
  persist(job);
  return job;
}

/**
 * 对外查询视图（不含内部路径与完整 input）
 * @param {VideoJob} job
 */
export function publicJobView(job) {
  return {
    ok: true,
    job_id: job.job_id,
    status: job.status,
    progress: job.progress,
    knowledge_point: job.knowledge_point,
    video_url: job.video_url,
    expires_at: job.expires_at,
    error: job.error,
    created_at: job.created_at,
    updated_at: job.updated_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

/**
 * 过期清理：删除超过 expires_at 或超过 TTL 的产物
 */
export function cleanupExpiredJobs() {
  ensureDirs();
  const now = Date.now();
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (!name.endsWith('.json')) continue;
    const job = getJob(name.replace(/\.json$/, ''));
    if (!job) continue;
    const exp = job.expires_at ? Date.parse(job.expires_at) : NaN;
    const expired =
      (Number.isFinite(exp) && exp < now) ||
      (job.status === 'succeeded' &&
        job.finished_at &&
        now - Date.parse(job.finished_at) > 48 * 3600 * 1000);
    if (!expired) continue;
    try {
      if (job.work_dir && fs.existsSync(job.work_dir)) {
        fs.rmSync(job.work_dir, { recursive: true, force: true });
      }
      if (job.video_path && fs.existsSync(job.video_path)) {
        fs.unlinkSync(job.video_path);
      }
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(jobPath(job.job_id));
    } catch {
      /* ignore */
    }
    memory.delete(job.job_id);
  }
}

export function videoWorkRoot() {
  return WORK_ROOT;
}
