import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(__dirname, '../prompts');

const cache = new Map();

/**
 * @param {string} filename
 * @returns {string}
 */
export function loadPrompt(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const full = path.join(PROMPT_DIR, filename);
  const text = readFileSync(full, 'utf8');
  cache.set(filename, text);
  return text;
}

/**
 * @returns {string}
 */
export function textModel() {
  return process.env.QWEN_TEXT_MODEL || 'qwen3.8-max';
}

/**
 * @param {Record<string, unknown>} fields
 * @returns {string}
 */
export function buildUserPayload(fields) {
  const lines = ['请根据以下 JSON 输入完成任务，只输出要求的 JSON 结果：', ''];
  lines.push(JSON.stringify(fields, null, 2));
  return lines.join('\n');
}
