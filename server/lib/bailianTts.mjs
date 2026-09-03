/**
 * 百炼 CosyVoice HTTP TTS
 */
import fs from 'node:fs';
import path from 'node:path';

function apiKey() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('缺少 DASHSCOPE_API_KEY');
  return key;
}

function dashscopeRoot() {
  const raw = (
    process.env.DASHSCOPE_API_ROOT ||
    process.env.DASHSCOPE_BASE_URL ||
    'https://dashscope.aliyuncs.com'
  ).replace(/\/$/, '');
  for (const suffix of ['/compatible-mode/v1', '/compatible-mode', '/api/v1']) {
    if (raw.endsWith(suffix)) return raw.slice(0, -suffix.length);
  }
  return raw;
}

function synthEndpoint() {
  return `${dashscopeRoot()}/api/v1/services/audio/tts/SpeechSynthesizer`;
}

function model() {
  return process.env.DASHSCOPE_TTS_MODEL || 'cosyvoice-v2';
}

/** 全程同一把英式女声，保证英文发音；中文会带口音。 */
export function ttsVoice() {
  return (
    process.env.DASHSCOPE_TTS_VOICE ||
    process.env.DASHSCOPE_TTS_EN_VOICE ||
    'loongeva_v2'
  );
}

export function zhVoice() {
  return ttsVoice();
}

export function enVoice() {
  return ttsVoice();
}

function sampleRate() {
  return Number(process.env.DASHSCOPE_TTS_SAMPLE_RATE || 24000);
}

function clampRate(n, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(2, Math.max(0.5, x));
}

export function ttsRate() {
  return clampRate(
    process.env.DASHSCOPE_TTS_RATE || process.env.DASHSCOPE_TTS_EN_RATE,
    1,
  );
}

export function zhRate() {
  return ttsRate();
}

export function enRate() {
  return ttsRate();
}

/**
 * @param {string} text
 * @param {string} outPath
 * @param {{ voice?: string, rate?: number }} [opts]
 * @returns {Promise<string>}
 */
export async function synthesizeToFile(text, outPath, opts = {}) {
  const t = String(text || '').trim();
  if (!t) throw new Error('TTS 文本为空');
  const voice = opts.voice || ttsVoice();
  const rate = clampRate(opts.rate, ttsRate());

  const body = {
    model: model(),
    input: {
      text: t,
      voice,
      format: 'mp3',
      sample_rate: sampleRate(),
      rate,
    },
    parameters: {
      format: 'mp3',
      sample_rate: sampleRate(),
      rate,
    },
  };

  const resp = await fetch(synthEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.TTS_TIMEOUT_MS || 60_000)),
  });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`TTS HTTP ${resp.status}: ${raw.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`TTS 响应非 JSON: ${raw.slice(0, 300)}`);
  }
  const url = data?.output?.audio?.url;
  if (!url) {
    throw new Error(`TTS 缺少 audio.url: ${raw.slice(0, 400)}`);
  }

  const audioResp = await fetch(url, {
    signal: AbortSignal.timeout(Number(process.env.TTS_DOWNLOAD_TIMEOUT_MS || 30_000)),
  });
  if (!audioResp.ok) {
    throw new Error(`下载 TTS 音频失败 HTTP ${audioResp.status}`);
  }
  const buf = Buffer.from(await audioResp.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}
