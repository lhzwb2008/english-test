import { Router } from 'express';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from '../lib/jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from '../lib/prompts.mjs';

const router = Router();

const ALLOWED_QUESTION_TYPES = new Set(['choice', 'blank', 'translation']);

function mapUsage(usage) {
  if (!usage) {
    return { token_count: 0, input_count: 0, output_count: 0 };
  }
  return {
    token_count: usage.total_tokens ?? 0,
    input_count: usage.prompt_tokens ?? 0,
    output_count: usage.completion_tokens ?? 0,
  };
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asScore(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).trim();
  return s || undefined;
}

/**
 * 规范化单元复盘入参：支持顶层直接传 Allen 的 unit_review，
 * 或包在 unit_review / input 字段里。
 * @param {Record<string, unknown>} body
 * @returns {Record<string, unknown> | null}
 */
function normalizeUnitReview(body) {
  const candidates = [body.unit_review, body.input, body];
  for (const c of candidates) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
    const unit = asNonEmptyString(c.unit);
    const taskTypes = c.taskTypes;
    if (unit && Array.isArray(taskTypes) && taskTypes.length > 0) {
      return {
        unit,
        totalTaskCount: c.totalTaskCount,
        taskTypes,
      };
    }
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | undefined}
 */
function normalizeStudentProfile(raw) {
  if (!raw) return undefined;
  if (typeof raw === 'string' && raw.trim()) {
    return { study_history: raw.trim() };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const grade = asNonEmptyString(raw.grade);
  const studyHistory = asNonEmptyString(raw.study_history ?? raw.studyHistory);
  const traits = asNonEmptyString(raw.traits ?? raw.characteristics ?? raw.student_traits);
  const currentScore = asScore(raw.current_score ?? raw.currentScore);
  const targetScore = asScore(raw.target_score ?? raw.targetScore);

  if (!grade && !studyHistory && !traits && currentScore === undefined && targetScore === undefined) {
    return undefined;
  }

  return {
    grade: grade || undefined,
    current_score: currentScore,
    target_score: targetScore,
    study_history: studyHistory || undefined,
    traits: traits || undefined,
  };
}

/**
 * POST /v1/grammar/assess
 * 单元学习数据 → 总评 + 知识点列表
 */
router.post('/assess', async (req, res) => {
  const body = req.body || {};
  const unitReview = normalizeUnitReview(body);

  if (!unitReview) {
    return res.status(400).json({
      code: 4000,
      msg: '请提供单元学习数据：需含 unit 与非空 taskTypes（可直接放在 body，或放在 unit_review / input 下）',
    });
  }

  const model = textModel();
  const systemPrompt = loadPrompt('grammar-assess.md');
  const userText = buildUserPayload(unitReview);

  try {
    const { fullText, usage } = await completeQwenText({
      model,
      systemPrompt,
      userText,
      json: true,
      temperature: 0.3,
    });
    const data = parseJsonFromModel(fullText);
    return res.json({
      ok: true,
      model,
      data,
      usage: mapUsage(usage),
    });
  } catch (err) {
    console.error('[grammar assess error]', err);
    return res.status(500).json({
      code: 5000,
      msg: err.message || '语法总评生成失败',
    });
  }
});

/**
 * POST /v1/grammar/drill
 * 知识点 + 学生情况 → 讲解 + 结构化出题
 */
router.post('/drill', async (req, res) => {
  const body = req.body || {};
  const knowledgePoint = asNonEmptyString(
    body.knowledge_point ?? body.knowledgePoint,
  );
  if (!knowledgePoint) {
    return res.status(400).json({
      code: 4000,
      msg: 'knowledge_point 必填',
    });
  }

  const studentProfile = normalizeStudentProfile(
    body.student_profile ?? body.studentProfile ?? body.student,
  );

  let questionTypes = Array.isArray(body.question_types)
    ? body.question_types.filter((t) => ALLOWED_QUESTION_TYPES.has(t))
    : Array.isArray(body.questionTypes)
      ? body.questionTypes.filter((t) => ALLOWED_QUESTION_TYPES.has(t))
      : [];
  if (questionTypes.length === 0) {
    questionTypes = ['choice', 'blank', 'translation'];
  }

  let questionCount = Number(body.question_count ?? body.questionCount);
  if (!Number.isFinite(questionCount) || questionCount < 1) {
    questionCount = 6;
  }
  questionCount = Math.min(Math.floor(questionCount), 20);

  const focusRaw = body.focus_points ?? body.focusPoints;
  const focusPoints = Array.isArray(focusRaw)
    ? focusRaw.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : [];

  const model = textModel();
  const systemPrompt = loadPrompt('grammar-drill.md');
  const userText = buildUserPayload({
    knowledge_point: knowledgePoint,
    student_profile: studentProfile,
    focus_points: focusPoints.length ? focusPoints : undefined,
    question_count: questionCount,
    question_types: questionTypes,
  });

  try {
    const { fullText, usage } = await completeQwenText({
      model,
      systemPrompt,
      userText,
      json: true,
      temperature: 0.4,
    });
    const data = parseJsonFromModel(fullText);
    return res.json({
      ok: true,
      model,
      data,
      usage: mapUsage(usage),
    });
  } catch (err) {
    console.error('[grammar drill error]', err);
    return res.status(500).json({
      code: 5000,
      msg: err.message || '知识点讲解与出题失败',
    });
  }
});

export default router;
