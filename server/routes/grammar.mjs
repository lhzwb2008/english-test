import { Router } from 'express';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from '../lib/jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from '../lib/prompts.mjs';
import { scorePetTest } from '../lib/petScoring.mjs';

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

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : undefined;
}

function isPetCurriculum(value) {
  const s = asNonEmptyString(value).toLowerCase();
  if (!s) return false;
  return (
    s === 'pet' ||
    s.includes('pet') ||
    s.includes('b1 preliminary') ||
    s.includes('preliminary english')
  );
}

/**
 * @param {Record<string, unknown>} source
 * @returns {boolean}
 */
function looksLikePetUnitReview(source) {
  if (
    isPetCurriculum(source.curriculum) ||
    isPetCurriculum(source.course) ||
    isPetCurriculum(source.exam) ||
    isPetCurriculum(source.exam_standard) ||
    isPetCurriculum(source.material) ||
    isPetCurriculum(source.教材)
  ) {
    return true;
  }
  if (source.pet_scores || source.petScores) return true;
  const unit = asNonEmptyString(source.unit);
  return /^test\s*\d+/i.test(unit);
}

/**
 * 从 homework / 对象里取原始分。
 * @param {Record<string, unknown> | null | undefined} obj
 * @returns {number | undefined}
 */
function pickRawScore(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  return (
    asFiniteNumber(obj.rawScore) ??
    asFiniteNumber(obj.raw_score) ??
    asFiniteNumber(obj.score) ??
    asFiniteNumber(obj.totalScore) ??
    asFiniteNumber(obj.total_score)
  );
}

/**
 * @param {Record<string, unknown>} source
 * @returns {{ reading?: number, writing?: number, listening?: number, speaking?: number, speaking_dimensions?: Record<string, number> } | null}
 */
function extractPetRawScores(source) {
  const bag =
    (source.pet_scores && typeof source.pet_scores === 'object'
      ? source.pet_scores
      : null) ||
    (source.petScores && typeof source.petScores === 'object'
      ? source.petScores
      : null) ||
    (source.scores && typeof source.scores === 'object' ? source.scores : null) ||
    {};

  /** @type {Record<string, number | undefined>} */
  const out = {
    reading: asFiniteNumber(bag.reading ?? source.reading),
    writing: asFiniteNumber(bag.writing ?? source.writing),
    listening: asFiniteNumber(bag.listening ?? source.listening),
    speaking: asFiniteNumber(bag.speaking ?? source.speaking),
  };

  const dims =
    bag.speaking_dimensions ||
    bag.speakingDimensions ||
    source.speaking_dimensions ||
    source.speakingDimensions;
  if (dims && typeof dims === 'object') {
    out.speaking_dimensions = dims;
  }

  const taskTypes = Array.isArray(source.taskTypes) ? source.taskTypes : [];
  for (const t of taskTypes) {
    if (!t || typeof t !== 'object') continue;
    const type = asNonEmptyString(t.type).toLowerCase();
    const label = asNonEmptyString(t.typeLabel).toLowerCase();
    const hw = t.homework && typeof t.homework === 'object' ? t.homework : null;
    const raw = pickRawScore(hw) ?? pickRawScore(t);

    const isReading = type.includes('read') || label.includes('阅读');
    const isWriting = type.includes('writ') || label.includes('写作') || label.includes('作文');
    const isListening = type.includes('listen') || label.includes('听力');
    const isSpeaking =
      type.includes('oral') ||
      type.includes('speak') ||
      label.includes('口语');

    if (isReading && out.reading === undefined && raw !== undefined) out.reading = raw;
    if (isWriting && out.writing === undefined && raw !== undefined) out.writing = raw;
    if (isListening && out.listening === undefined && raw !== undefined) {
      out.listening = raw;
    }
    if (isSpeaking) {
      if (out.speaking === undefined && raw !== undefined) out.speaking = raw;
      const hwDims = hw?.speaking_dimensions || hw?.speakingDimensions || hw?.exam_rubric;
      if (!out.speaking_dimensions && hwDims && typeof hwDims === 'object') {
        // exam_rubric.dimensions[] → flat map if needed
        if (Array.isArray(hwDims.dimensions)) {
          const flat = {};
          for (const d of hwDims.dimensions) {
            if (!d || typeof d !== 'object') continue;
            const id = asNonEmptyString(d.id);
            const score = asFiniteNumber(d.score_0_to_5 ?? d.score);
            if (id && score !== undefined) flat[id] = score;
          }
          if (Object.keys(flat).length) out.speaking_dimensions = flat;
        } else {
          out.speaking_dimensions = hwDims;
        }
      }
    }
  }

  if (
    out.reading === undefined &&
    out.writing === undefined &&
    out.listening === undefined &&
    out.speaking === undefined &&
    !out.speaking_dimensions
  ) {
    return null;
  }

  return out;
}

/**
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown> | null}
 */
function maybeBuildPetScoreReport(source) {
  if (!looksLikePetUnitReview(source)) return null;
  const raw = extractPetRawScores(source);
  if (!raw) return null;
  try {
    return scorePetTest(raw);
  } catch (err) {
    console.warn('[grammar assess] PET 算分跳过:', err.message);
    return null;
  }
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
      const curriculum =
        asNonEmptyString(c.curriculum) ||
        asNonEmptyString(c.course) ||
        asNonEmptyString(c.exam) ||
        asNonEmptyString(c.exam_standard) ||
        asNonEmptyString(c.material) ||
        asNonEmptyString(c.教材) ||
        undefined;

      const petScoreReport = maybeBuildPetScoreReport(c);

      return {
        unit,
        totalTaskCount: c.totalTaskCount,
        taskTypes,
        ...(curriculum ? { curriculum } : {}),
        // 服务端预计算；模型必须当作事实使用，不得自行改算
        ...(petScoreReport ? { pet_score_report: petScoreReport } : {}),
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
 * PET Test：若入参可识别且含四项原始分，服务端先算量表分并注入 prompt / 回传 data.pet_score_report
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
    if (unitReview.pet_score_report) {
      // 以服务端算分为准，覆盖模型可能改写的同名字段
      data.pet_score_report = unitReview.pet_score_report;
      if (data.summary && typeof data.summary === 'object') {
        data.summary.pet_overall_scale =
          unitReview.pet_score_report.overall?.scale ?? null;
        data.summary.pet_overall_label_zh =
          unitReview.pet_score_report.overall?.label_zh ?? null;
      }
    }
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
