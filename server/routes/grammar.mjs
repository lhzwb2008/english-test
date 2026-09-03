import fs from 'node:fs';
import { Router } from 'express';
import { completeQwenText } from '../qwen/client.mjs';
import { parseJsonFromModel } from '../lib/jsonParse.mjs';
import { buildUserPayload, loadPrompt, textModel } from '../lib/prompts.mjs';
import { PET_SKILL_TABLES, scorePetTest } from '../lib/petScoring.mjs';
import {
  normalizeMaterialFields,
  resolveMaterialLevel,
} from '../lib/materialLevel.mjs';
import { buildTraitVoice, inferStyleFromTraits } from '../lib/traitVoice.mjs';
import {
  cleanupExpiredJobs,
  createJob,
  getJob,
  publicJobView,
} from '../lib/videoJobs.mjs';
import { enqueueVideoJob } from '../lib/grammarVideoPipeline.mjs';

const router = Router();

const ALLOWED_QUESTION_TYPES = new Set(['choice', 'blank', 'translation']);
const EXPLANATION_STYLES = new Set(['logical', 'fun', 'visual', 'exam']);

const EXPLANATION_STYLE_ALIASES = {
  logical: 'logical',
  logic: 'logical',
  简洁逻辑: 'logical',
  简洁逻辑型: 'logical',
  fun: 'fun',
  interesting: 'fun',
  story: 'fun',
  有趣吸引: 'fun',
  有趣吸引型: 'fun',
  visual: 'visual',
  chart: 'visual',
  diagram: 'visual',
  视觉图表: 'visual',
  视觉图表型: 'visual',
  exam: 'exam',
  test: 'exam',
  考试速记: 'exam',
  考试速记型: 'exam',
};

/**
 * 解析讲解风格：显式入参优先，否则从 traits / study_history 推断，默认 fun。
 * @param {Record<string, unknown>} body
 * @param {Record<string, unknown> | undefined} studentProfile
 * @returns {'logical'|'fun'|'visual'|'exam'}
 */
function resolveExplanationStyle(body, studentProfile) {
  const candidates = [
    body.explanation_style,
    body.explanationStyle,
    body.teach_style,
    body.teachStyle,
    studentProfile?.explanation_style,
    studentProfile?.explanationStyle,
    studentProfile?.teach_style,
    studentProfile?.teachStyle,
  ];
  for (const c of candidates) {
    const key = asNonEmptyString(c).toLowerCase().replace(/\s+/g, '');
    if (!key) continue;
    if (EXPLANATION_STYLES.has(key)) return /** @type {'logical'|'fun'|'visual'|'exam'} */ (key);
    const aliased = EXPLANATION_STYLE_ALIASES[key] || EXPLANATION_STYLE_ALIASES[asNonEmptyString(c)];
    if (aliased) return /** @type {'logical'|'fun'|'visual'|'exam'} */ (aliased);
  }

  const fromTraits = inferStyleFromTraits(
    asNonEmptyString(studentProfile?.traits),
    asNonEmptyString(studentProfile?.study_history),
  );
  return fromTraits || 'fun';
}

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

function questionFromBody(src) {
  const raw = src?.question ?? src?.item ?? src?.wrong_question ?? src?.wrongQuestion;
  if (typeof raw === 'string' && raw.trim()) {
    const stem = raw.trim();
    return { stem, original_question: stem };
  }
  if (raw && typeof raw === 'object') return raw;
  return null;
}

function questionStemOf(q, src) {
  return asNonEmptyString(
    q?.stem ||
      q?.original_question ||
      q?.originalQuestion ||
      q?.title ||
      (typeof q?.question === 'string' ? q.question : '') ||
      q?.content ||
      q?.text ||
      src?.stem ||
      (typeof src?.question === 'string' ? src.question : ''),
  );
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
  return s === 'pet' || /(^|[^a-z])pet([^a-z]|$)/i.test(s) || s.includes('b1 preliminary');
}

/**
 * 仅当 curriculum 显式为 PET 时启用成绩换算（Allen 会统一显式传入）。
 * @param {Record<string, unknown>} source
 */
function isPetMode(source) {
  return (
    isPetCurriculum(source.curriculum) ||
    isPetCurriculum(source.course)
  );
}

/**
 * 明确的 PET 原始分字段（不含易与 1–5 分混淆的 `score`）。
 * @param {Record<string, unknown> | null | undefined} obj
 * @returns {number | undefined}
 */
function pickExplicitRawScore(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  return (
    asFiniteNumber(obj.rawScore) ??
    asFiniteNumber(obj.raw_score) ??
    asFiniteNumber(obj.petRaw) ??
    asFiniteNumber(obj.pet_raw) ??
    asFiniteNumber(obj.totalScore) ??
    asFiniteNumber(obj.total_score)
  );
}

/**
 * 模糊分数字段：可能是 1–5，也可能已是原始分。
 * @param {Record<string, unknown> | null | undefined} obj
 * @returns {number | undefined}
 */
function pickLooseNumericScore(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  return (
    asFiniteNumber(obj.score) ??
    asFiniteNumber(obj.averageScore) ??
    asFiniteNumber(obj.average_score) ??
    asFiniteNumber(obj.holistic_score_1_to_5) ??
    asFiniteNumber(obj.holisticScore) ??
    asFiniteNumber(obj.holistic_score)
  );
}

/**
 * 从对题数 / 总题数换算到该科官方满分刻度（每题等分）。
 * raw = round(correctCount / total * maxRaw)
 * @param {Record<string, unknown> | null | undefined} obj
 * @param {number} maxRaw
 * @returns {number | undefined}
 */
function rawFromCorrectRatio(obj, maxRaw) {
  if (!obj || typeof obj !== 'object' || !Number.isFinite(maxRaw) || maxRaw <= 0) {
    return undefined;
  }
  const correct = asFiniteNumber(obj.correctCount ?? obj.correct_count);
  if (correct === undefined) return undefined;

  let total =
    asFiniteNumber(obj.totalQuestions) ??
    asFiniteNumber(obj.total_questions) ??
    asFiniteNumber(obj.totalWords) ??
    asFiniteNumber(obj.total_words) ??
    asFiniteNumber(obj.totalSentences) ??
    asFiniteNumber(obj.total_sentences) ??
    asFiniteNumber(obj.totalCount) ??
    asFiniteNumber(obj.total_count);

  if (total === undefined) {
    const wrong = asFiniteNumber(obj.wrongCount ?? obj.wrong_count);
    if (wrong !== undefined) total = correct + wrong;
  }
  // 仅有 correct + wrongQuestions 列表时，用列表长度估总数
  if (total === undefined && Array.isArray(obj.wrongQuestions)) {
    total = correct + obj.wrongQuestions.length;
  }
  if (total === undefined || total <= 0) return undefined;

  const cappedCorrect = Math.min(Math.max(correct, 0), total);
  return Math.round((cappedCorrect / total) * maxRaw);
}

/**
 * 正确率 → 原始分。支持 0–1 或 0–100。
 * @param {Record<string, unknown> | null | undefined} obj
 * @param {number} maxRaw
 * @returns {number | undefined}
 */
function rawFromAccuracy(obj, maxRaw) {
  if (!obj || typeof obj !== 'object' || !Number.isFinite(maxRaw) || maxRaw <= 0) {
    return undefined;
  }
  let rate = asFiniteNumber(
    obj.accuracy ??
      obj.accuracyRate ??
      obj.accuracy_rate ??
      obj.correctRate ??
      obj.correct_rate ??
      obj.percentCorrect,
  );
  if (rate === undefined) return undefined;
  if (rate > 1) rate /= 100;
  if (rate < 0 || rate > 1) return undefined;
  return Math.round(rate * maxRaw);
}

/**
 * 1–5 分（averageScore / holistic / 口语维度均值）→ 该科满分刻度。
 * 例：口语 averageScore=3 → round(3/5*30)=18。
 * @param {number} avg
 * @param {number} maxRaw
 * @returns {number | undefined}
 */
function scaleFivePointToRaw(avg, maxRaw) {
  if (!Number.isFinite(avg) || !Number.isFinite(maxRaw) || maxRaw <= 0) return undefined;
  const capped = Math.min(Math.max(avg, 0), 5);
  return Math.round((capped / 5) * maxRaw);
}

/**
 * 从 dimensions / exam_rubric.dimensions 取 0–5 分均值再映射。
 * @param {Record<string, unknown> | null | undefined} obj
 * @param {number} maxRaw
 * @returns {number | undefined}
 */
function rawFromDimensionScores(obj, maxRaw) {
  if (!obj || typeof obj !== 'object') return undefined;
  /** @type {unknown[]} */
  let list = [];
  if (Array.isArray(obj.dimensions)) list = obj.dimensions;
  const rubric = obj.exam_rubric ?? obj.examRubric;
  if (!list.length && rubric && typeof rubric === 'object' && Array.isArray(rubric.dimensions)) {
    list = rubric.dimensions;
  }
  if (!list.length) return undefined;

  const scores = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const s = asFiniteNumber(
      d.score_0_to_5 ?? d.score_1_to_5 ?? d.score ?? d.value,
    );
    if (s !== undefined) scores.push(s);
  }
  if (!scores.length) return undefined;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return scaleFivePointToRaw(avg, maxRaw);
}

/**
 * 模糊分：≤5 当 1–5 刻度；>5 且 ≤maxRaw 当已是原始分。
 * @param {Record<string, unknown> | null | undefined} obj
 * @param {number} maxRaw
 * @returns {number | undefined}
 */
function rawFromLooseScore(obj, maxRaw) {
  const n = pickLooseNumericScore(obj);
  if (n === undefined) return undefined;
  if (n <= 5) return scaleFivePointToRaw(n, maxRaw);
  if (n <= maxRaw) return Math.round(n);
  // 偶发把百分制写进 score
  if (n <= 100) return Math.round((n / 100) * maxRaw);
  return undefined;
}

/**
 * @param {Record<string, unknown> | null | undefined} hw
 * @param {Record<string, unknown>} task
 * @param {number} maxRaw
 * @param {'reading'|'writing'|'listening'|'speaking'} [skill]
 */
function resolveSkillRaw(hw, task, maxRaw, skill) {
  // 优先级：明确原始分 → 对题比例 → 正确率 → 分项均分 → 1–5/模糊 score
  return (
    pickExplicitRawScore(hw) ??
    pickExplicitRawScore(task) ??
    rawFromCorrectRatio(hw, maxRaw) ??
    rawFromCorrectRatio(task, maxRaw) ??
    rawFromAccuracy(hw, maxRaw) ??
    rawFromAccuracy(task, maxRaw) ??
    (skill === 'speaking' || skill === 'writing'
      ? rawFromDimensionScores(hw, maxRaw) ?? rawFromDimensionScores(task, maxRaw)
      : undefined) ??
    rawFromLooseScore(hw, maxRaw) ??
    rawFromLooseScore(task, maxRaw)
  );
}

/**
 * @param {string} type
 * @param {string} label
 * @returns {'reading'|'writing'|'listening'|'speaking'|null}
 */
function classifyPetSkill(type, label) {
  if (type.includes('read') || label.includes('阅读')) return 'reading';
  // Allen 侧阅读常落在书面作业 / 图片批改
  if (
    type.includes('image_free_upload') ||
    type.includes('image_homework') ||
    label.includes('书面') ||
    label.includes('阅读理解')
  ) {
    return 'reading';
  }
  if (type.includes('writ') || label.includes('写作') || label.includes('作文')) {
    return 'writing';
  }
  if (type.includes('listen') || label.includes('听力')) return 'listening';
  if (type.includes('oral') || type.includes('speak') || label.includes('口语')) {
    return 'speaking';
  }
  return null;
}

/**
 * 从 taskTypes 抽出 PET 四科原始分：优先显式分；否则用 correctCount/总题数按满分等比例换算。
 * @param {Record<string, unknown>} source
 */
function extractPetRawScores(source) {
  /** @type {Record<string, number | undefined> & { speaking_dimensions?: Record<string, number> }} */
  const out = {
    reading: undefined,
    writing: undefined,
    listening: undefined,
    speaking: undefined,
  };

  const taskTypes = Array.isArray(source.taskTypes) ? source.taskTypes : [];
  for (const t of taskTypes) {
    if (!t || typeof t !== 'object') continue;
    const type = asNonEmptyString(t.type).toLowerCase();
    const label = asNonEmptyString(t.typeLabel).toLowerCase();
    const hw = t.homework && typeof t.homework === 'object' ? t.homework : null;
    const skill = classifyPetSkill(type, label);
    if (!skill) continue;

    const maxRaw = PET_SKILL_TABLES[skill].maxRaw;
    const raw = resolveSkillRaw(hw, t, maxRaw, skill);

    if (out[skill] === undefined && raw !== undefined) out[skill] = raw;

    if (skill === 'speaking') {
      const hwDims =
        hw?.speaking_dimensions ||
        hw?.speakingDimensions ||
        hw?.exam_rubric ||
        hw?.examRubric;
      if (!out.speaking_dimensions && hwDims && typeof hwDims === 'object') {
        if (Array.isArray(hwDims.dimensions)) {
          const flat = {};
          for (const d of hwDims.dimensions) {
            if (!d || typeof d !== 'object') continue;
            const id = asNonEmptyString(d.id);
            const score = asFiniteNumber(
              d.score_0_to_5 ?? d.score_1_to_5 ?? d.score,
            );
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
  if (!isPetMode(source)) return null;
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
      const curriculumRaw =
        asNonEmptyString(c.curriculum) ||
        asNonEmptyString(c.course) ||
        '';
      // 未传时默认 think（与产品约定一致）；Allen 侧会显式传入
      const curriculum = curriculumRaw || 'think';
      const petScoreReport = maybeBuildPetScoreReport({ ...c, curriculum });

      return {
        unit,
        curriculum,
        totalTaskCount: c.totalTaskCount,
        taskTypes,
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
    const q = questionFromBody(body);
    if (q) {
      return res.status(400).json({
        code: 4000,
        msg: '这是知识点出题接口 /v1/grammar/drill，需要 knowledge_point。错题讲解视频请 POST /v1/grammar/video，question 可直接传题干字符串',
      });
    }
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

  const explanationStyle = resolveExplanationStyle(body, studentProfile);
  const traitVoice = buildTraitVoice(studentProfile);
  const materialFields = normalizeMaterialFields(body);
  const material = resolveMaterialLevel(materialFields);

  const model = textModel();
  const systemPrompt = loadPrompt('grammar-drill.md');
  const userText = buildUserPayload({
    knowledge_point: knowledgePoint,
    explanation_style: explanationStyle,
    material: material || undefined,
    student_profile: studentProfile,
    has_student_traits: Boolean(traitVoice),
    trait_voice: traitVoice || undefined,
    focus_points: focusPoints.length ? focusPoints : undefined,
    question_count: questionCount,
    question_types: questionTypes,
    difficulty_rule: material
      ? `出题必须对标 ${material.label_zh}（CEFR ${material.cefr}）。禁止因年级或 study_history 降到更低教材。${material.question_hint_zh}`
      : undefined,
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
    data.explanation_style = explanationStyle;
    if (traitVoice) {
      data.voice_tags = traitVoice.tags;
    }
    if (material) {
      data.material = {
        textbook: material.textbook,
        unit_ref: material.unit_ref,
        cefr: material.cefr,
        label_zh: material.label_zh,
      };
    }
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

/**
 * 解析 drill / video 共用入参
 * @param {Record<string, unknown>} body
 */
function parseDrillLikeInput(body) {
  const knowledgePoint = asNonEmptyString(
    body.knowledge_point ?? body.knowledgePoint,
  );
  if (!knowledgePoint) return { error: 'knowledge_point 必填' };

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

  const explanationStyle = resolveExplanationStyle(body, studentProfile);
  const materialFields = normalizeMaterialFields(body);
  const material = resolveMaterialLevel(materialFields);
  const traitVoice = buildTraitVoice(studentProfile);

  return {
    knowledgePoint,
    input: {
      knowledge_point: knowledgePoint,
      explanation_style: explanationStyle,
      material: material || undefined,
      student_profile: studentProfile,
      trait_voice: traitVoice || undefined,
      has_student_traits: Boolean(traitVoice),
      focus_points: focusPoints.length ? focusPoints : undefined,
      question_count: questionCount,
      question_types: questionTypes,
    },
  };
}

function requestPublicBase(req) {
  const envBase = asNonEmptyString(process.env.PUBLIC_BASE_URL);
  if (envBase) return envBase.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return '';
  return `${proto}://${host}`;
}

/**
 * 错题讲解视频入参：题干 / 对错 / 标答（可带对话 lines）
 * @param {Record<string, unknown>} body
 */
function parseHomeworkVideoInput(body) {
  const src = body && typeof body === 'object' ? body : {};
  const q = questionFromBody(src) || (src.item && typeof src.item === 'object' ? src.item : src);

  const stem = questionStemOf(q, src);
  const standardAnswer = asNonEmptyString(
    q.standard_answer ||
      q.standardAnswer ||
      q.correct_answer ||
      q.correctAnswer,
  );
  if (!stem && !standardAnswer) {
    return {
      error:
        '请传 knowledge_point（知识点视频）或 question（错题讲解：题干字符串，或 { stem / original_question / standard_answer }）',
    };
  }

  const lines = Array.isArray(q.lines)
    ? q.lines.filter((x) => x && typeof x === 'object')
    : [];

  const studentProfile = normalizeStudentProfile(
    src.student_profile ?? src.studentProfile ?? src.student,
  );
  const title =
    asNonEmptyString(q.title || src.title) ||
    stem.slice(0, 40) ||
    '错题讲解';

  const isCorrect = q.is_correct ?? q.isCorrect;

  return {
    title,
    input: {
      question: {
        id: asNonEmptyString(q.id || q.item_id || q.itemId) || undefined,
        item_type:
          asNonEmptyString(q.item_type || q.itemType || q.type) || undefined,
        stem: stem || undefined,
        original_question:
          asNonEmptyString(q.original_question || q.originalQuestion) ||
          stem ||
          undefined,
        student_answer:
          asNonEmptyString(q.student_answer || q.studentAnswer) || undefined,
        standard_answer: standardAnswer || undefined,
        is_correct: typeof isCorrect === 'boolean' ? isCorrect : undefined,
        explanation_zh:
          asNonEmptyString(
            q.explanation_zh || q.explanationZh || q.explanation,
          ) || undefined,
        lines: lines.length ? lines : undefined,
      },
      student_profile: studentProfile,
      storyboard:
        src.storyboard && typeof src.storyboard === 'object'
          ? src.storyboard
          : undefined,
    },
  };
}

/**
 * 知识点视频（旧入参）或错题讲解（question）
 * @param {Record<string, unknown>} body
 */
export function parseVideoInput(body) {
  const src = body && typeof body === 'object' ? body : {};
  const knowledgePoint = asNonEmptyString(
    src.knowledge_point ?? src.knowledgePoint,
  );
  const q = questionFromBody(src);
  const homeworkStem = q ? questionStemOf(q, src) : questionStemOf(src, src);
  const homeworkAnswer = asNonEmptyString(
    q?.standard_answer ||
      q?.standardAnswer ||
      q?.correct_answer ||
      src.standard_answer,
  );
  const questionHasContent = Boolean(homeworkStem || homeworkAnswer);

  if (questionHasContent) {
    return parseHomeworkVideoInput(src);
  }
  if (knowledgePoint) {
    const drill = parseDrillLikeInput(src);
    if (drill.error) return { error: drill.error };
    return {
      title: drill.knowledgePoint,
      input: {
        ...drill.input,
        video_kind: 'knowledge',
      },
    };
  }
  return parseHomeworkVideoInput(src);
}

/**
 * POST /v1/grammar/video
 * 知识点短视频（knowledge_point）或错题讲解（question），立即返回 job_id
 */
router.post('/video', (req, res) => {
  cleanupExpiredJobs();
  const parsed = parseVideoInput(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ code: 4000, msg: parsed.error });
  }

  const job = createJob(parsed.input, parsed.title);
  const base = requestPublicBase(req);
  enqueueVideoJob(job.job_id, base);

  return res.status(202).json({
    ok: true,
    job_id: job.job_id,
    status: job.status,
    poll_url: `/v1/grammar/video/${job.job_id}`,
  });
});

/**
 * GET /v1/grammar/video/:jobId
 * 查询任务状态与成片 URL（约 48h 有效）
 */
router.get('/video/:jobId', (req, res) => {
  cleanupExpiredJobs();
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ code: 4040, msg: '任务不存在或已过期清理' });
  }
  const view = publicJobView(job);
  if (view.video_url && view.video_url.startsWith('/')) {
    const base = requestPublicBase(req);
    if (base) view.video_url = `${base}${view.video_url}`;
  }
  return res.json(view);
});

/**
 * GET /v1/grammar/video/:jobId/file
 * 下载/播放成片（本地临时文件，约 48h）
 */
router.get('/video/:jobId/file', (req, res) => {
  cleanupExpiredJobs();
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ code: 4040, msg: '任务不存在或已过期清理' });
  }
  if (job.status !== 'succeeded' || !job.video_path) {
    return res.status(409).json({
      code: 4090,
      msg: '视频尚未就绪',
      status: job.status,
      progress: job.progress,
    });
  }
  if (job.expires_at && Date.parse(job.expires_at) < Date.now()) {
    return res.status(410).json({ code: 4100, msg: '视频已过期（约 48 小时）' });
  }
  if (!fs.existsSync(job.video_path)) {
    return res.status(404).json({ code: 4040, msg: '视频文件缺失' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${job.job_id}.mp4"`,
  );
  fs.createReadStream(job.video_path).pipe(res);
});

export default router;
export { extractPetRawScores, maybeBuildPetScoreReport };
