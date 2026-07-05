import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY_PATH = path.join(ROOT, 'coze/qwen-bots.registry.json');

let cached = null;

function loadRegistry() {
  if (cached) return cached;
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  cached = JSON.parse(raw);
  return cached;
}

export function getBot(botId) {
  const registry = loadRegistry();
  const bot = registry.bots.find((b) => b.bot_id === botId);
  if (!bot) return null;

  const modelEnv = bot.model_env || 'QWEN_ORAL_MODEL';
  const defaultModel =
    registry.defaults?.[modelEnv] ||
    process.env[modelEnv] ||
    'qwen3.5-omni-flash';
  const model = process.env[modelEnv] || defaultModel;

  let systemPrompt = null;
  if (bot.engine === 'fixed-prompt' && bot.prompt_file) {
    const promptPath = path.join(ROOT, bot.prompt_file);
    systemPrompt = fs.readFileSync(promptPath, 'utf8');
  }

  return { ...bot, model, systemPrompt };
}

export function listBots() {
  return loadRegistry().bots;
}
