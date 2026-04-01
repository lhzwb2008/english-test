import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
export const PROMPTS_DIR = path.join(ROOT, 'prompts');
const REGISTRY_FILE = path.join(PROMPTS_DIR, 'registry.json');

async function ensureDirs() {
  await fs.mkdir(PROMPTS_DIR, { recursive: true });
}

export async function readRegistry() {
  await ensureDirs();
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') {
      const empty = { version: 1, agents: [] };
      await fs.writeFile(REGISTRY_FILE, JSON.stringify(empty, null, 2), 'utf8');
      return empty;
    }
    throw e;
  }
}

export async function writeRegistry(data) {
  await ensureDirs();
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function promptPath(botId) {
  const safe = String(botId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROMPTS_DIR, `${safe}.md`);
}

export async function readPromptFile(botId) {
  const p = promptPath(botId);
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
}

export async function writePromptFile(botId, content) {
  await ensureDirs();
  await fs.writeFile(promptPath(botId), content ?? '', 'utf8');
}
