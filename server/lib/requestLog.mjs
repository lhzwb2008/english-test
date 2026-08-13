/**
 * 业务请求落盘：按日 JSONL，便于从服务器复现口语/总结等问题。
 * 不写音频二进制；密钥字段脱敏；过长 body 截断。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { genId } from './ids.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SKIP_PATHS = new Set(['/health']);
const SENSITIVE_KEY =
  /^(authorization|cookie|set-cookie|token|api[_-]?key|secret|password|passwd|access[_-]?key)$/i;

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
  const n = Number(process.env.REQUEST_LOG_MAX_BODY_CHARS || 120000);
  return Number.isFinite(n) && n > 2000 ? n : 120000;
}

function retentionDays() {
  const n = Number(process.env.REQUEST_LOG_RETENTION_DAYS || 14);
  return Number.isFinite(n) && n >= 1 ? n : 14;
}

function redactValue(key, value) {
  if (SENSITIVE_KEY.test(String(key))) return '[redacted]';
  return value;
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 8) return '[max-depth]';
  if (Buffer.isBuffer(value)) {
    return { _type: 'buffer', bytes: value.length };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(k, sanitize(v, depth + 1));
    }
    return out;
  }
  if (typeof value === 'string' && value.length > maxBodyChars()) {
    return `${value.slice(0, maxBodyChars())}\n…[truncated ${value.length} chars]`;
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

function dayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureDir() {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let writesSincePrune = 0;

function pruneOldLogs() {
  const dir = logDir();
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - retentionDays() * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
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
    if (writesSincePrune === 1 || writesSincePrune % 40 === 0) pruneOldLogs();
  } catch (err) {
    console.warn('[request-log] 写入失败:', err?.message || err);
  }
}

/**
 * 给 SSE 等无法用 res.json 捕获的响应补字段。
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
 * Express 中间件：记录入参与出参（跳过 /health）。
 * @returns {import('express').RequestHandler}
 */
export function requestLogMiddleware() {
  return (req, res, next) => {
    if (!enabled() || SKIP_PATHS.has(req.path)) return next();

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
      writeRequestLog({
        id,
        ts: new Date().toISOString(),
        duration_ms: Date.now() - started,
        method: req.method,
        path: req.originalUrl || req.url,
        ip: req.ip || req.socket?.remoteAddress || '',
        headers: pickHeaders(req.headers),
        request: requestBodySnapshot(req),
        status: res.statusCode,
        response: req._requestLog?.responseJson ?? extra.response ?? null,
        extra: Object.keys(extra).length ? extra : undefined,
      });
    });

    next();
  };
}
