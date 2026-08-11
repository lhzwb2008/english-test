/**
 * 百炼万相文生图（异步任务轮询）
 * 默认 wan2.6-t2i（质量优先）；可用 DASHSCOPE_IMAGE_MODEL 覆盖
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

function imageModel() {
  // 质量优先：wan2.6-t2i；退而求其次可用 wan2.2-t2i-plus
  return process.env.DASHSCOPE_IMAGE_MODEL || 'wan2.6-t2i';
}

function imageSize() {
  // 竖屏 9:16；wan2.5/2.6 推荐 960*1696
  return process.env.DASHSCOPE_IMAGE_SIZE || '960*1696';
}

function promptMaxChars() {
  const n = Number(process.env.DASHSCOPE_IMAGE_PROMPT_MAX || 1800);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 200), 2000) : 1800;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} prompt
 * @returns {Promise<string>} 图片公网 URL
 */
export async function generateImageUrl(prompt) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('生图 prompt 为空');

  const createUrl = `${dashscopeRoot()}/api/v1/services/aigc/text2image/image-synthesis`;
  const createResp = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: imageModel(),
      input: {
        prompt: p.slice(0, promptMaxChars()),
        negative_prompt:
          'low quality, blurry, watermark, logo, photorealistic face, deformed, extra limbs, adult content',
      },
      parameters: {
        size: imageSize(),
        n: 1,
        prompt_extend: true,
      },
    }),
  });
  const createRaw = await createResp.text();
  if (!createResp.ok) {
    throw new Error(`生图创建失败 HTTP ${createResp.status}: ${createRaw.slice(0, 500)}`);
  }
  const created = JSON.parse(createRaw);
  const taskId = created?.output?.task_id;
  if (!taskId) {
    throw new Error(`生图未返回 task_id: ${createRaw.slice(0, 400)}`);
  }

  const pollUrl = `${dashscopeRoot()}/api/v1/tasks/${taskId}`;
  const deadline = Date.now() + Number(process.env.DASHSCOPE_IMAGE_TIMEOUT_MS || 180000);
  while (Date.now() < deadline) {
    await sleep(2000);
    const pollResp = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    const pollRaw = await pollResp.text();
    if (!pollResp.ok) {
      throw new Error(`生图轮询失败 HTTP ${pollResp.status}: ${pollRaw.slice(0, 400)}`);
    }
    const polled = JSON.parse(pollRaw);
    const status = polled?.output?.task_status;
    if (status === 'SUCCEEDED') {
      const results = polled?.output?.results || [];
      const url = results[0]?.url;
      if (!url) throw new Error(`生图成功但无 url: ${pollRaw.slice(0, 400)}`);
      return url;
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new Error(`生图任务失败: ${pollRaw.slice(0, 500)}`);
    }
  }
  throw new Error(`生图超时 task_id=${taskId}`);
}

/**
 * @param {string} prompt
 * @param {string} outPath
 * @returns {Promise<string>}
 */
export async function generateImageToFile(prompt, outPath) {
  const url = await generateImageUrl(prompt);
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!resp.ok) throw new Error(`下载生图失败 HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      return outPath;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await sleep(1000 * attempt);
    }
  }
  throw new Error(`下载生图失败: ${lastErr?.message || 'unknown'}`);
}

export function bailianImageConfigured() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}
