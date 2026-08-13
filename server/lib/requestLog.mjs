/**
 * 业务请求落盘：文本 JSONL 全记；图片/音频每天最多留 10 份完整文件便于复现。
 * 密钥脱敏；JSON 截断；日志与媒体最多保留 7 天。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genId } from './ids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SKIP_EXACT = new Set(['/health']);
const MEDIA_KEY =
  /^(file|files|image|images|img|photo|photos|audio|buffer|binary|data)$/i;
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|token|api[_-]?key|secret|password|passwd|access[_-]?key)$/i;
const DATA_URL_RE = /^data:(image|audio|video)\/([a-z0-9.+-]+);base64,/i;

function enabled() {
  const v = (process.env.REQUEST_LOG_ENABLED || '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

function logDir() {
  return (
    process.env.REQUEST_LOG_DIR ||
    path.join(ROOT, 'server/data/request-logs')
  );
}

function maxBodyChars() {
  const n = Number(process.env.REQUEST_LOG_MAX_BODY_CHARS || 24000);
  return Number.isFinite(n) && n > 1000 ? n : 24000;
}

function retentionDays() {
  const n = Number(process.env.REQUEST_LOG_RETENTION_DAYS || 7);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 7) : 7;
}

function maxMediaPerDay() {
  const n = Number(process.env.REQUEST_LOG_MAX_MEDIA_PER_DAY || 10);
  return Number.isFinite(n) && n >= 1 ? n : 10;
}

function maxMediaBytes() {
  const n = Number(process.env.REQUEST_LOG_MAX_MEDIA_BYTES || 15 * 1024 * 1024);
  return Number.isFinite(n) && n > 1024 ? n : 15 * 1024 * 1024;
}

function shouldSkipPath(urlPath) {
  const p = String(urlPath || '').split('?')[0];
  if (SKIP_EXACT.has(p)) return true;
  if (/^\/v1\/grammar\/video\/[^/]+\/file$/.test(p)) return true;
  return false;
}

function dayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureDir(dir = logDir()) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function quotaPath(day) {
  return path.join(logDir(), `${day}.media-quota.json`);
}

/** @type {{ date: string, count: number, ids: string[] } | null} */
let memQuota = null;

function loadQuota(day) {
  try {
    const raw = fs.readFileSync(quotaPath(day), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.date === day && Number.isFinite(parsed.count)) {
      return {
        date: day,
        count: parsed.count,
        ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      };
    }
  } catch {
    /* 无文件 */
  }
  return { date: day, count: 0, ids: [] };
}

function saveQuota(quota) {
  ensureDir();
  fs.writeFileSync(quotaPath(quota.date), `${JSON.stringify(quota)}\n`, 'utf8');
}

/**
 * 当天图片/音频完整样本名额（默认 10）。
 * @param {string} reqId
 * @returns {boolean}
 */
function claimMediaSlot(reqId) {
  const day = dayStamp();
  if (!memQuota || memQuota.date !== day) memQuota = loadQuota(day);
  if (memQuota.count >= maxMediaPerDay()) return false;
  memQuota.count += 1;
  memQuota.ids.push(reqId);
  saveQuota(memQuota);
  return true;
}

function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\-()+]+/g, '_');
  return base.slice(0, 80) || 'file';
}

function extFromMime(mimetype = '', fallback = '.bin') {
  const map = {
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[String(mimetype).toLowerCase()] || fallback;
}

function parseDataUrl(s) {
  const m = String(s || '').match(DATA_URL_RE);
  if (!m) return null;
  const mime = `${m[1]}/${m[2]}`;
  const b64 = s.slice(m[0].length);
  try {
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return null;
    return { mime, buffer: buf };
  } catch {
    return null;
  }
}

function looksLikeMediaString(s) {
  if (typeof s !== 'string') return false;
  if (DATA_URL_RE.test(s)) return true;
  return false;
}

/**
 * @param {string} reqId
 * @param {string} filename
 * @param {Buffer} buffer
 * @returns {string} relative path from logDir
 */
function writeMediaFile(reqId, filename, buffer) {
  const day = dayStamp();
  const dir = path.join(logDir(), 'media', day);
  ensureDir(dir);
  const dest = path.join(dir, `${reqId}_${safeName(filename)}`);
  fs.writeFileSync(dest, buffer);
  return path.relative(logDir(), dest);
}

function redactValue(key, value) {
  if (SENSITIVE_KEY.test(String(key))) return '[redacted]';
  if (MEDIA_KEY.test(String(key))) {
    if (Buffer.isBuffer(value)) return { omitted: 'media', bytes: value.length };
    if (typeof value === 'string') {
      return { omitted: 'media', chars: value.length, prefix: value.slice(0, 24) };
    }
    if (Array.isArray(value)) return { omitted: 'media_list', count: value.length };
    if (value && typeof value === 'object') return { omitted: 'media_object' };
  }
  return value;
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return '[max-depth]';
  if (Buffer.isBuffer(value)) return { omitted: 'buffer', bytes: value.length };
  if (Array.isArray(value)) {
    const cap = 40;
    const items = value.slice(0, cap).map((item) => sanitize(item, depth + 1));
    if (value.length > cap) {
      items.push({ omitted: 'array_tail', skipped: value.length - cap });
    }
    return items;
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(k, sanitize(v, depth + 1));
    }
    return out;
  }
  if (typeof value === 'string') {
    if (looksLikeMediaString(value)) {
      return { omitted: 'media_string', chars: value.length };
    }
    const max = Math.min(8000, maxBodyChars());
    if (value.length > max) {
      return `${value.slice(0, max)}\n…[truncated ${value.length} chars]`;
    }
  }
  return value;
}

function clipJson(value) {
  const sanitized = sanitize(value);
  const raw = JSON.stringify(sanitized);
  if (raw.length <= maxBodyChars()) return sanitized;
  return {
    _truncated: true,
    preview: `${raw.slice(0, maxBodyChars())}…`,
    original_chars: raw.length,
  };
}

function collectDataUrls(value, out = [], depth = 0) {
  if (!value || depth > 6 || out.length >= 8) return out;
  if (typeof value === 'string') {
    const parsed = parseDataUrl(value);
    if (parsed) out.push(parsed);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDataUrls(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectDataUrls(v, out, depth + 1);
  }
  return out;
}

/**
 * 有图片/音频则尝试写入当天样本（最多 10 份）。
 * @param {import('express').Request} req
 * @param {string} reqId
 */
export function maybeSaveMedia(req, reqId) {
  /** @type {{ filename: string, buffer: Buffer }[]} */
  const candidates = [];
  if (req.file?.buffer?.length) {
    candidates.push({
      filename: req.file.originalname || `upload${extFromMime(req.file.mimetype, '.bin')}`,
      buffer: req.file.buffer,
    });
  }
  if (req.body && typeof req.body === 'object') {
    const urls = collectDataUrls(req.body);
    urls.forEach((u, i) => {
      candidates.push({
        filename: `embedded_${i}${extFromMime(u.mime, '.bin')}`,
        buffer: u.buffer,
      });
    });
  }
  if (!candidates.length) return { has_media: false };

  const tooLarge = candidates.find((c) => c.buffer.length > maxMediaBytes());
  if (tooLarge) {
    return {
      has_media: true,
      saved: false,
      reason: 'too_large',
      bytes: tooLarge.buffer.length,
    };
  }

  if (!claimMediaSlot(reqId)) {
    return {
      has_media: true,
      saved: false,
      reason: 'daily_quota',
      quota: maxMediaPerDay(),
    };
  }

  const saved_paths = [];
  for (const c of candidates) {
    saved_paths.push(writeMediaFile(reqId, c.filename, c.buffer));
  }
  return { has_media: true, saved: true, saved_paths };
}

let writesSincePrune = 0;

function keepDayNames() {
  const keep = new Set();
  const now = new Date();
  const days = retentionDays();
  for (let i = 0; i < days; i += 1) {
    keep.add(dayStamp(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return keep;
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/** 删除超过 7 天的 JSONL、配额文件、媒体目录。 */
export function pruneOldLogs() {
  const dir = logDir();
  if (!fs.existsSync(dir)) return;
  const keep = keepDayNames();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name.endsWith('.jsonl')) {
      const day = name.replace(/\.jsonl$/, '');
      if (!keep.has(day)) rmrf(full);
      continue;
    }
    if (name.endsWith('.media-quota.json')) {
      const day = name.replace(/\.media-quota\.json$/, '');
      if (!keep.has(day)) rmrf(full);
    }
  }
  const mediaRoot = path.join(dir, 'media');
  if (!fs.existsSync(mediaRoot)) return;
  for (const name of fs.readdirSync(mediaRoot)) {
    if (!keep.has(name)) rmrf(path.join(mediaRoot, name));
  }
}

/**
 * @param {Record<string, unknown>} entry
 */
export function writeRequestLog(entry) {
  if (!enabled()) return;
  try {
    const dir = ensureDir();
    const file = path.join(dir, `${dayStamp()}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify(clipJson(entry))}\n`, 'utf8');
    writesSincePrune += 1;
    if (writesSincePrune === 1 || writesSincePrune % 20 === 0) pruneOldLogs();
  } catch (err) {
    console.warn('[request-log] 写入失败:', err?.message || err);
  }
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} extra
 */
export function setRequestLogExtra(req, extra) {
  if (!req._requestLog) req._requestLog = {};
  req._requestLog.extra = {
    ...(req._requestLog.extra || {}),
    ...extra,
  };
}

function pickHeaders(headers = {}) {
  const keep = [
    'content-type',
    'user-agent',
    'x-request-id',
    'x-real-ip',
    'x-forwarded-for',
    'referer',
  ];
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of keep) {
    const v = headers[key];
    if (typeof v === 'string' && v) out[key] = v;
  }
  return out;
}

function requestBodySnapshot(req) {
  if (req.file) {
    return {
      multipart_file: {
        originalname: req.file.originalname || '',
        mimetype: req.file.mimetype || '',
        bytes: req.file.buffer?.length ?? req.file.size ?? 0,
      },
      fields: clipJson(req.body && typeof req.body === 'object' ? req.body : {}),
    };
  }
  if (req.body && typeof req.body === 'object') return clipJson(req.body);
  if (typeof req.body === 'string' && req.body) {
    return clipJson({ _raw: req.body });
  }
  return null;
}

/**
 * @returns {import('express').RequestHandler}
 */
export function requestLogMiddleware() {
  return (req, res, next) => {
    const urlPath = req.originalUrl || req.url || req.path;
    if (!enabled() || shouldSkipPath(req.path) || shouldSkipPath(urlPath)) {
      return next();
    }

    const started = Date.now();
    const id = genId('req_');
    req._requestLog = { extra: {} };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      req._requestLog.responseJson = clipJson(body);
      return originalJson(body);
    };

    res.on('finish', () => {
      const extra = req._requestLog?.extra || {};
      const media = maybeSaveMedia(req, id);
      writeRequestLog({
        id,
        ts: new Date().toISOString(),
        duration_ms: Date.now() - started,
        method: req.method,
        path: urlPath,
        ip: req.ip || req.socket?.remoteAddress || '',
        headers: pickHeaders(req.headers),
        request: requestBodySnapshot(req),
        status: res.statusCode,
        response: req._requestLog?.responseJson ?? extra.response ?? null,
        extra: Object.keys(extra).length ? extra : undefined,
        media,
      });
    });

    next();
  };
}
