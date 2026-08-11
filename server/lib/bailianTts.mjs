/**
 * 百炼 CosyVoice HTTP TTS（参考 AIVideo tts_client）
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

function voice() {
  // 默认温柔女声（龙小夏）；可用 DASHSCOPE_TTS_VOICE 覆盖
  return process.env.DASHSCOPE_TTS_VOICE || 'longxiaoxia_v2';
}

function sampleRate() {
  return Number(process.env.DASHSCOPE_TTS_SAMPLE_RATE || 24000);
}

/**
 * @param {string} text
 * @param {string} outPath
 * @returns {Promise<string>}
 */
export async function synthesizeToFile(text, outPath) {
  const t = String(text || '').trim();
  if (!t) throw new Error('TTS 文本为空');

  const body = {
    model: model(),
    input: {
      text: t,
      voice: voice(),
      format: 'mp3',
      sample_rate: sampleRate(),
      rate: 1.0,
    },
  };

  const resp = await fetch(synthEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
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

  const audioResp = await fetch(url);
  if (!audioResp.ok) {
    throw new Error(`下载 TTS 音频失败 HTTP ${audioResp.status}`);
  }
  const buf = Buffer.from(await audioResp.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}
