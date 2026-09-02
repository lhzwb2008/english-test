import OpenAI from 'openai';

let client = null;

function getClient() {
  if (client) return client;
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置');
  }
  client = new OpenAI({
    apiKey,
    baseURL:
      process.env.DASHSCOPE_BASE_URL ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    timeout: Number(process.env.QWEN_TIMEOUT_MS || 240_000),
    maxRetries: 0,
  });
  return client;
}

/**
 * 调用 Qwen-Omni，仅输出文本
 * @param {{
 *   model: string,
 *   systemPrompt?: string | null,
 *   userText: string,
 *   audioBuffer: Buffer,
 *   audioFormat: string,
 *   onDelta?: (text: string) => void,
 * }} params
 */
export async function streamQwenText(params) {
  const openai = getClient();
  const base64 = params.audioBuffer.toString('base64');

  /** @type {import('openai').ChatCompletionMessageParam[]} */
  const messages = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  messages.push({
    role: 'user',
    content: [
      {
        type: 'input_audio',
        input_audio: {
          data: `data:;base64,${base64}`,
          format: params.audioFormat,
        },
      },
      { type: 'text', text: params.userText || '请根据音频内容完成任务。' },
    ],
  });

  const stream = await openai.chat.completions.create({
    model: params.model,
    messages,
    modalities: ['text'],
    stream: true,
    stream_options: { include_usage: true },
  });

  let fullText = '';
  /** @type {import('openai').CompletionUsage | null} */
  let usage = null;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      fullText += delta;
      params.onDelta?.(delta);
    }
    if (chunk.usage) usage = chunk.usage;
  }

  return { fullText, usage };
}

/**
 * 调用文本 Qwen（非 Omni），一次性返回完整文本。
 * @param {{
 *   model: string,
 *   systemPrompt?: string | null,
 *   userText: string,
 *   json?: boolean,
 *   temperature?: number,
 * }} params
 */
export async function completeQwenText(params) {
  const openai = getClient();

  /** @type {import('openai').ChatCompletionMessageParam[]} */
  const messages = [];
  if (params.systemPrompt) {
    messages.push({ role: 'system', content: params.systemPrompt });
  }
  messages.push({ role: 'user', content: params.userText });

  /** @type {import('openai').ChatCompletionCreateParamsNonStreaming} */
  const body = {
    model: params.model,
    messages,
    temperature: params.temperature ?? 0.4,
  };
  if (params.json) {
    body.response_format = { type: 'json_object' };
  }
  if (params.maxTokens) {
    body.max_tokens = params.maxTokens;
  } else {
    body.max_tokens = 4096;
  }
  // qwen3 默认可能开思考链，非流式会空等数分钟。两处都关，兼容不同网关字段。
  body.enable_thinking = false;
  body.extra_body = { enable_thinking: false };

  const timeoutMs = Number(
    params.timeoutMs || process.env.QWEN_TIMEOUT_MS || 180_000,
  );
  const completion = await openai.chat.completions.create(body, {
    timeout: timeoutMs,
    maxRetries: 0,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const fullText = completion.choices?.[0]?.message?.content ?? '';
  return { fullText, usage: completion.usage ?? null };
}
