/**
 * Cursor Cloud Agents 客户端
 * 文案 / 生图编排默认 grok-4.5（fast=false）。本仓库不引入 AiHubMix。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonFromModel } from './jsonParse.mjs';

function env(name, fallback = '') {
  return (process.env[name] || fallback).trim();
}

function authHeader() {
  const key = env('CURSOR_API_KEY');
  if (!key) throw new Error('缺少 CURSOR_API_KEY');
  const token = Buffer.from(`${key}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function baseUrl() {
  return env('CURSOR_BASE_URL', 'https://api.cursor.com').replace(/\/$/, '');
}

export function cursorModelId() {
  return env('CURSOR_MODEL_ID', 'grok-4.5');
}

/** 生图编排模型（底层 GenerateImage 同一工具；默认与文案同为 grok-4.5） */
export function cursorImageModelId() {
  return env('CURSOR_IMAGE_MODEL', cursorModelId());
}

/**
 * @param {string} [modelId]
 * @returns {{ id: string, params?: Array<{ id: string, value: string }> }}
 */
function modelSelection(modelId) {
  const id = (modelId || cursorModelId()).trim();
  if (id.startsWith('grok')) {
    return {
      id,
      params: [
        { id: 'effort', value: env('CURSOR_MODEL_EFFORT', 'high') },
        { id: 'fast', value: 'false' },
      ],
    };
  }
  if (id.startsWith('composer')) {
    return {
      id,
      params: [{ id: 'fast', value: 'false' }],
    };
  }
  return { id };
}

function sandboxRepoUrl() {
  const url = env('CURSOR_SANDBOX_REPO_URL');
  if (!url) throw new Error('缺少 CURSOR_SANDBOX_REPO_URL');
  return url;
}

const RETRY_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * @param {string} method
 * @param {string} reqPath
 * @param {object} [body]
 */
async function http(method, reqPath, body) {
  const maxAttempts = Math.max(1, Number(env('CURSOR_HTTP_MAX_RETRIES', '6')));
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await fetch(`${baseUrl()}${reqPath}`, {
        method,
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await resp.text();
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      if (RETRY_CODES.has(resp.status) && attempt < maxAttempts) {
        const wait = resp.status === 429 ? 60 : Math.min(120, 2 * attempt);
        console.warn(
          `[cursor] ${method} ${reqPath} → ${resp.status}，${wait}s 后重试 (${attempt})`,
        );
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      return { status: resp.status, data: parsed, raw };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(30, 0.5 * attempt) * 1000));
        continue;
      }
      throw new Error(`Cursor HTTP ${method} ${reqPath} 失败: ${err.message}`);
    }
  }
  throw new Error(`Cursor HTTP 失败: ${lastErr?.message || 'unknown'}`);
}

/**
 * @param {string} prompt
 * @param {string} [modelId]
 */
async function createAgent(prompt, modelId) {
  const { status, data, raw } = await http('POST', '/v1/agents', {
    prompt: { text: prompt },
    model: modelSelection(modelId),
    repos: [{ url: sandboxRepoUrl() }],
    autoCreatePR: false,
  });
  if ((status !== 200 && status !== 201) || !data?.agent?.id) {
    throw new Error(`createAgent 失败 ${status}: ${raw.slice(0, 500)}`);
  }
  return { agentId: data.agent.id, runId: data.run.id };
}

async function createRun(agentId, prompt) {
  for (let i = 0; i < 30; i += 1) {
    const { status, data, raw } = await http('POST', `/v1/agents/${agentId}/runs`, {
      prompt: { text: prompt },
    });
    if ((status === 200 || status === 201) && data?.run?.id) return data.run.id;
    if ((status === 200 || status === 201) && data?.id) return data.id;
    if (status === 409) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    throw new Error(`createRun 失败 ${status}: ${raw.slice(0, 500)}`);
  }
  throw new Error(`createRun: agent ${agentId} 一直 busy`);
}

async function getRun(agentId, runId) {
  const { status, data, raw } = await http(
    'GET',
    `/v1/agents/${agentId}/runs/${runId}`,
  );
  if (status !== 200 || !data) {
    throw new Error(`getRun 失败 ${status}: ${raw.slice(0, 400)}`);
  }
  return data;
}

/**
 * @param {string} agentId
 * @param {string} runId
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
async function consumeAssistantSse(agentId, runId, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const chunks = [];
  try {
    const resp = await fetch(
      `${baseUrl()}/v1/agents/${agentId}/runs/${runId}/stream`,
      {
        headers: {
          Authorization: authHeader(),
          Accept: 'text/event-stream',
        },
        signal: ctrl.signal,
      },
    );
    if (!resp.ok || !resp.body) return '';
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      while (buf.includes('\n\n')) {
        const idx = buf.indexOf('\n\n');
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let eventName = 'message';
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let payload;
        try {
          payload = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (eventName === 'assistant' && typeof payload?.text === 'string') {
          chunks.push(payload.text);
        }
        if (eventName === 'result' && typeof payload?.result === 'string') {
          chunks.push(payload.result);
        }
        if (['done', 'error', 'result'].includes(eventName)) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          return chunks.join('');
        }
      }
    }
  } catch {
    /* abort / network */
  } finally {
    clearTimeout(timer);
  }
  return chunks.join('');
}

/**
 * @param {string} prompt
 * @param {{ requireText?: boolean, agentId?: string, modelId?: string }} [opts]
 * @returns {Promise<{ text: string, agentId: string, runId: string, status: string }>}
 */
export async function runCursorPrompt(prompt, opts = {}) {
  const requireText = opts.requireText !== false;
  const modelId = opts.modelId || cursorModelId();
  const stickyEnv = env('CURSOR_STICKY_AGENT_ID');
  const reuseEnv = env('AIVIDEO_CURSOR_REUSE_AGENT', '1') === '1';
  let agentId = opts.agentId || '';
  let runId;

  if (agentId) {
    runId = await createRun(agentId, prompt);
  } else if (reuseEnv && stickyEnv) {
    agentId = stickyEnv;
    runId = await createRun(agentId, prompt);
  } else {
    const created = await createAgent(prompt, modelId);
    agentId = created.agentId;
    runId = created.runId;
  }

  const timeoutMs = Number(env('CURSOR_AGENT_TIMEOUT_MS', '1500000'));
  const pollMs = Number(env('CURSOR_POLL_INTERVAL_MS', '4000'));
  const deadline = Date.now() + timeoutMs;
  const ssePromise = consumeAssistantSse(agentId, runId, timeoutMs);

  let finalStatus = 'TIMEOUT';
  let finalText = '';

  while (Date.now() < deadline) {
    try {
      const r = await getRun(agentId, runId);
      const st = r.status || r.run?.status || '';
      if (['FINISHED', 'ERROR', 'CANCELLED'].includes(st)) {
        finalStatus = st;
        finalText =
          r.result ||
          r.run?.result ||
          r.assistantMessage ||
          r.message ||
          '';
        if (typeof finalText !== 'string') {
          finalText = JSON.stringify(finalText);
        }
        break;
      }
    } catch (err) {
      console.warn('[cursor] poll error', err.message);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  const sseText = await Promise.race([
    ssePromise,
    new Promise((resolve) => setTimeout(() => resolve(''), 2000)),
  ]);
  if (!String(finalText).trim() && sseText) {
    finalText = sseText;
  }

  if (finalStatus !== 'FINISHED') {
    throw new Error(`Cursor Agent 未成功结束: ${finalStatus}`);
  }
  if (requireText && !String(finalText).trim()) {
    throw new Error('Cursor Agent 返回空结果');
  }
  return {
    text: String(finalText || ''),
    agentId,
    runId,
    status: finalStatus,
  };
}

/**
 * @param {string} systemPrompt
 * @param {string} userPayload
 */
export async function completeCursorJson(systemPrompt, userPayload) {
  const prompt = [
    systemPrompt.trim(),
    '',
    '----',
    '请根据以下 JSON 输入完成任务。',
    '只输出一个合法 JSON 对象：不要 Markdown 代码围栏，不要前后解释。',
    '',
    userPayload.trim(),
  ].join('\n');
  const { text } = await runCursorPrompt(prompt, {
    modelId: cursorModelId(),
  });
  return parseJsonFromModel(text);
}

/**
 * @param {string} agentId
 * @returns {Promise<Array<{ path: string, sizeBytes?: number }>>}
 */
async function listArtifacts(agentId) {
  const { status, data, raw } = await http('GET', `/v1/agents/${agentId}/artifacts`);
  if (status !== 200) {
    throw new Error(`listArtifacts 失败 ${status}: ${raw.slice(0, 400)}`);
  }
  const items = data?.artifacts || data?.items || data || [];
  return Array.isArray(items) ? items : [];
}

/**
 * @param {string} agentId
 * @param {string} artifactPath
 */
async function downloadArtifact(agentId, artifactPath) {
  const q = encodeURIComponent(artifactPath);
  const { status, data, raw } = await http(
    'GET',
    `/v1/agents/${agentId}/artifacts/download?path=${q}`,
  );
  if (status !== 200 || !data?.url) {
    throw new Error(`downloadArtifact 失败 ${status}: ${raw.slice(0, 400)}`);
  }
  const img = await fetch(data.url);
  if (!img.ok) throw new Error(`下载 artifact 失败 HTTP ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}

/**
 * 白板手绘教学竖图 prompt
 */
export function buildWhiteboardPrompt({
  imagePrompt,
  onImageText = [],
  pageIndex = 0,
  totalPages = 5,
  chapterTitle = '',
}) {
  const parts = [
    'Hand-drawn comic explainer panel on light beige graph paper, vertical portrait 9:16 aspect ratio.',
    'Black ballpoint pen line drawing, casual manga-narration illustration style, with subtle yellow and light purple highlighter accents.',
    'Crisp clean lines, comfortable empty white space, friendly educational mood for Chinese middle-school English learners.',
    'Keep meaningful text/icons away from top 18%, leftmost 8%, rightmost 12%, and bottom 25% (subtitle safe area).',
    imagePrompt ? `Page layout: ${String(imagePrompt).trim()}` : '',
  ];
  if (chapterTitle) {
    parts.push(
      `Small handwritten Chinese chapter tag "${String(chapterTitle).slice(0, 20)}" in upper-left safe area.`,
    );
  }
  if (pageIndex && totalPages) {
    parts.push(
      `Small page number "${String(pageIndex).padStart(2, '0')}/${totalPages}" in upper-right safe area.`,
    );
  }
  const labels = (onImageText || [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 6);
  if (labels.length) {
    const joined = labels.map((t) => `"${t}"`).join(', ');
    parts.push(
      `Render these EXACT Chinese handwritten labels as diagram annotations: ${joined}. Use ONLY these labels; spelling must match.`,
    );
  }
  parts.push(
    'Bottom 22% must stay clean empty graph paper (no drawing/text) for subtitles.',
  );
  parts.push('No frames, borders, watermarks, signatures, logos, or photorealistic faces.');
  return parts.filter(Boolean).join(' ');
}

/**
 * Cursor 内置生图 → artifacts 下载。可传入 agentId 复用同 Agent，避免每次冷启动。
 * @param {string} imagePrompt
 * @param {string} outPath
 * @param {{ artifactName?: string, agentId?: string, modelId?: string }} [opts]
 * @returns {Promise<{ outPath: string, agentId: string, elapsedMs: number }>}
 */
export async function generateCursorImageToFile(imagePrompt, outPath, opts = {}) {
  const artifactName =
    opts.artifactName ||
    `grammar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const artifactRel = artifactName.startsWith('artifacts/')
    ? artifactName
    : `artifacts/${artifactName}`;
  const modelId = opts.modelId || cursorImageModelId();
  const t0 = Date.now();
  const basename = path.basename(artifactRel);

  const prompt = [
    "You must use Cursor's built-in image generation tool exactly once (GenerateImage / image generation).",
    'Do NOT write code to call external image APIs. Do NOT create a pull request.',
    'Be quick: call the image tool immediately, save the file, then finish.',
    '',
    'Generate ONE vertical 9:16 teaching illustration with this exact prompt:',
    '"""',
    String(imagePrompt || '').slice(0, 3200),
    '"""',
    '',
    `After the image is created, copy or save the PNG to this exact workspace path: ${artifactRel}`,
    'If the tool saves under assets/, copy it into artifacts/ with that filename.',
    '',
    `When finished, reply with ONLY this JSON (no markdown): {"ok":true,"path":"${artifactRel}"}`,
  ].join('\n');

  console.log(
    `[cursor-image] via ${modelId} (fast=false)${opts.agentId ? ' reuse' : ' new'} → ${artifactRel}`,
  );
  const { agentId } = await runCursorPrompt(prompt, {
    requireText: false,
    agentId: opts.agentId,
    modelId,
  });

  let match = null;
  for (let i = 0; i < 15; i += 1) {
    const arts = await listArtifacts(agentId);
    match = arts.find((a) => {
      const p = String(a.path || a);
      return (
        p === artifactRel ||
        p.endsWith(`/${basename}`) ||
        p.endsWith(basename) ||
        p.includes(basename)
      );
    });
    if (!match && !opts.agentId) {
      match = arts.find((a) => {
        const p = String(a.path || a).toLowerCase();
        return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.webp');
      });
    }
    if (match) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!match) {
    throw new Error(`Cursor 生图完成但未找到 artifact（期望 ${artifactRel}）`);
  }
  const artPath = String(match.path || match);
  const buf = await downloadArtifact(agentId, artPath);
  if (!buf.length) throw new Error('Cursor artifact 为空');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  const elapsedMs = Date.now() - t0;
  console.log(`[cursor-image] done ${basename} ${elapsedMs}ms agent=${agentId}`);
  return { outPath, agentId, elapsedMs };
}

export function cursorConfigured() {
  return Boolean(env('CURSOR_API_KEY') && env('CURSOR_SANDBOX_REPO_URL'));
}
