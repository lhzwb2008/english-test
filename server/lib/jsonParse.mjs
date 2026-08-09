/**
 * 从模型输出中提取 JSON 对象（容忍偶发 Markdown 围栏）。
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonFromModel(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('模型返回为空');
  }

  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  throw new Error('模型返回不是合法 JSON');
}
