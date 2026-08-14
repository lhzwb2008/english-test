/**
 * 口语批改：根据用户 text 判定 KET/PET，并回填 exam_rubric 原始分/量表分。
 */
import {
  PET_SKILL_TABLES,
  rawToScale,
  skillGradeFromScale,
  speakingRawFromDimensions,
} from './petScoring.mjs';

/**
 * @param {string} userText
 * @returns {'KET'|'PET'|null}
 */
export function detectOralExamStandard(userText) {
  const t = String(userText || '');
  const hasPet = /PET|B1\s*Preliminary|PET\s*口语|按照\s*PET|PET\s*标准/i.test(t);
  const hasKet = /KET|A2\s*Key|KET\s*口语|按照\s*KET/i.test(t);
  if (hasPet) return 'PET';
  if (hasKet) return 'KET';
  return null;
}

/**
 * @param {'KET'|'PET'} standard
 * @returns {string}
 */
export function examStandardForcePrompt(standard) {
  if (standard === 'PET') {
    return [
      '',
      '# 最高优先级（服务端注入）：本次已判定为 PET 口语',
      '用户 text 含 PET。必须输出非空 exam_rubric，exam_standard="PET"。',
      'exam_rubric.dimensions 必须含 grammar_vocabulary / discourse_management / pronunciation / interactive_communication / global_achievement，每项 score_0_to_5 为 0–5（允许 0.5）。',
      'raw_score = 四项之和 + 总体表现×2（满分 30）；scale_score 按 PET 口语锚点插值取整。',
      '禁止 exam_rubric: null。',
      '禁止输出顶层 dimensions（不得出现 fluency/accuracy/completeness/interaction）。',
      '对照内部锚点：偏低通过≈3/3.5（raw 19）；中档≈3.5；高档≈4.5（I like listen 仍 4.5）。能完成且能懂不得严于偏低通过档（各维≥3、raw≥19）。禁止因 like listen 打到 3 或以下。',
      '评语只写本学生表现。禁止出现样卷考生姓名，禁止写「参考某某表现 / 符合某某水平」等对照语。',
    ].join('\n');
  }
  return [
    '',
    '# 最高优先级（服务端注入）：本次已判定为 KET 口语',
    '用户 text 含 KET。必须输出非空 exam_rubric，exam_standard="KET"。',
    'dimensions 仅在 exam_rubric 内：grammar_vocabulary / pronunciation / interactive_communication / global_achievement。',
    '禁止 exam_rubric: null。禁止顶层 dimensions（fluency/accuracy 等）。',
    '尺度：3 分=基本达标（不是很差）。转写大体能懂且答了多数题时，各维至少 3。禁止因语法小错或停顿打到 1–2。',
  ].join('\n');
}

/**
 * 对齐剑桥官方 0.5 分档。
 * @param {number} n
 * @returns {number}
 */
function snapHalf(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return x;
  return Math.min(5, Math.max(0, Math.round(x * 2) / 2));
}

function flatDimsFromRubric(examRubric) {
  const flat = {};
  if (!examRubric || typeof examRubric !== 'object') return flat;
  const dims = examRubric.dimensions;
  if (!Array.isArray(dims)) return flat;
  for (const d of dims) {
    if (!d || typeof d !== 'object') continue;
    const id = String(d.id || '').trim();
    const score = Number(d.score_0_to_5 ?? d.score_1_to_5 ?? d.score);
    if (id && Number.isFinite(score)) flat[id] = score;
  }
  return flat;
}

/**
 * 解析助手 JSON 文本；失败返回 null。
 * @param {string} rawText
 * @returns {Record<string, unknown> | null}
 */
export function parseOralJson(rawText) {
  const s = String(rawText || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SAMPLE_NAME_RE =
  /\b(Laura|Claudia|Andrea|Cristina|Lucia|Yaheli|Fernanda|Pascual|Corinne|Kenza|Mohammed)\b/i;
const KEEP_TEXT_KEYS = new Set([
  'transcript',
  'reference_text',
  'standard_response_en',
]);

/**
 * 评语里若泄漏样卷考生名，删掉该句；转写/示范句不动。
 * @param {unknown} value
 * @param {string} [key]
 * @returns {unknown}
 */
function stripSampleNameLeaks(value, key) {
  if (typeof value === 'string') {
    if (KEEP_TEXT_KEYS.has(key)) return value;
    return value
      .split(/(?<=[。！？；!?;\n])/)
      .filter((part) => part.trim() && !SAMPLE_NAME_RE.test(part))
      .join('')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }
  if (Array.isArray(value)) return value.map((item) => stripSampleNameLeaks(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = stripSampleNameLeaks(v, k);
    }
    return out;
  }
  return value;
}

function finalizeOralJson(obj) {
  return JSON.stringify(stripSampleNameLeaks(obj));
}

/**
 * 若已有 PET exam_rubric 分项，补齐 raw_score / scale_score / hint；并删除旧版顶层 dimensions。
 * @param {string} rawText
 * @param {'KET'|'PET'|null} examHint
 * @returns {string}
 */
export function enrichOralExamRubricText(rawText, examHint) {
  const obj = parseOralJson(rawText);
  if (!obj || typeof obj !== 'object') return rawText;

  // 一律去掉旧版顶层 dimensions，避免与 exam_rubric 双轨
  if ('dimensions' in obj) delete obj.dimensions;

  if (examHint !== 'PET') {
    return finalizeOralJson(obj);
  }

  let rubric = obj.exam_rubric;
  if (!rubric || typeof rubric !== 'object' || Array.isArray(rubric)) {
    return finalizeOralJson(obj);
  }

  rubric = { ...rubric, exam_standard: rubric.exam_standard || 'PET' };
  if (Array.isArray(rubric.dimensions)) {
    rubric.dimensions = rubric.dimensions.map((d) => {
      if (!d || typeof d !== 'object') return d;
      const score = Number(d.score_0_to_5 ?? d.score_1_to_5 ?? d.score);
      if (!Number.isFinite(score)) return d;
      return { ...d, score_0_to_5: snapHalf(score) };
    });
  }
  const flat = flatDimsFromRubric(rubric);
  const needed = [
    'grammar_vocabulary',
    'discourse_management',
    'pronunciation',
    'interactive_communication',
    'global_achievement',
  ];
  if (!needed.every((k) => flat[k] !== undefined)) {
    obj.exam_rubric = rubric;
    return finalizeOralJson(obj);
  }

  const raw = speakingRawFromDimensions(flat);
  const scale = Math.round(rawToScale(raw, PET_SKILL_TABLES.speaking.anchors));
  const grade = skillGradeFromScale(scale);
  const hintParts = [
    grade.cambridge_grade
      ? `${grade.label_zh} ${grade.cambridge_grade}`
      : grade.label_zh,
    grade.cefr ? `CEFR ${grade.cefr}` : null,
    `原始分 ${raw}/30`,
    `量表分 ${scale}`,
  ].filter(Boolean);

  rubric.raw_score = raw;
  rubric.scale_score = scale;
  if (!rubric.overall_grade_hint_zh) {
    rubric.overall_grade_hint_zh = hintParts.join(' · ');
  }
  obj.exam_rubric = rubric;
  return finalizeOralJson(obj);
}
