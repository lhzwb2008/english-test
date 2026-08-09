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

/**
 * POST /v1/grammar/assess
 * 总评 + 知识点列表（草稿：Allen 结构化 input 到位后再微调 prompt）
 */
router.post('/assess', async (req, res) => {
  const body = req.body || {};
  const studentProfile = asNonEmptyString(body.student_profile);
  const weaknessNotes = asNonEmptyString(body.weakness_notes);
  const course = asNonEmptyString(body.course);
  const unit = asNonEmptyString(body.unit);
  const extraContext = asNonEmptyString(body.extra_context);
  // 兼容：业务也可直接塞一整段文本
  const rawInput = asNonEmptyString(body.input);

  if (!studentProfile && !weaknessNotes && !rawInput && !extraContext) {
    return res.status(400).json({
      code: 4000,
      msg: '请至少提供 student_profile / weakness_notes / input / extra_context 之一',
    });
  }

  const model = textModel();
  const systemPrompt = loadPrompt('grammar-assess.md');
  const userText = buildUserPayload({
    student_profile: studentProfile || undefined,
    course: course || undefined,
    unit: unit || undefined,
    weakness_notes: weaknessNotes || undefined,
    extra_context: extraContext || undefined,
    input: rawInput || undefined,
  });

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
 * 单知识点讲解 + 结构化出题（含答案）
 */
router.post('/drill', async (req, res) => {
  const body = req.body || {};
  const knowledgePoint = asNonEmptyString(body.knowledge_point);
  if (!knowledgePoint) {
    return res.status(400).json({
      code: 4000,
      msg: 'knowledge_point 必填',
    });
  }

  let questionTypes = Array.isArray(body.question_types)
    ? body.question_types.filter((t) => ALLOWED_QUESTION_TYPES.has(t))
    : [];
  if (questionTypes.length === 0) {
    questionTypes = ['choice', 'blank', 'translation'];
  }

  let questionCount = Number(body.question_count);
  if (!Number.isFinite(questionCount) || questionCount < 1) {
    questionCount = 6;
  }
  questionCount = Math.min(Math.floor(questionCount), 20);

  const focusPoints = Array.isArray(body.focus_points)
    ? body.focus_points.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : [];

  const model = textModel();
  const systemPrompt = loadPrompt('grammar-drill.md');
  const userText = buildUserPayload({
    knowledge_point: knowledgePoint,
    focus_points: focusPoints.length ? focusPoints : undefined,
    student_profile: asNonEmptyString(body.student_profile) || undefined,
    weakness_context: asNonEmptyString(body.weakness_context) || undefined,
    extra_context: asNonEmptyString(body.extra_context) || undefined,
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
