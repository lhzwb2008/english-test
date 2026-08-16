/**
 * 从课程材料（教材 / 考试）解析练习难度。只看 textbook / curriculum，不看学习历史。
 */

function compact(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function asNonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** @typedef {{ id: string, cefr: string, label_zh: string, question_hint_zh: string }} MaterialLevel */

/** @type {Record<string, MaterialLevel>} */
const LEVELS = {
  KIDSBOX_LOW: {
    id: 'KIDSBOX_LOW',
    cefr: 'A1',
    label_zh: 'Kids Box 低阶（约 A1）',
    question_hint_zh: '极短句、高频词、现在时为主，不要复合句',
  },
  KIDSBOX_HIGH: {
    id: 'KIDSBOX_HIGH',
    cefr: 'A2',
    label_zh: 'Kids Box 高阶 / Flyers / Think Starter（约 A2）',
    question_hint_zh: '简单现在时/进行时/过去时，日常话题',
  },
  THINK1: {
    id: 'THINK1',
    cefr: 'A2',
    label_zh: 'Think 1 / 对标 KET 预备（A2）',
    question_hint_zh: '日常话题、简单复合句；词汇控制在 A2，不要 PET 长语境',
  },
  THINK2: {
    id: 'THINK2',
    cefr: 'B1',
    label_zh: 'Think 2 / 对标 PET 预备（B1）',
    question_hint_zh: '能给理由（because/when/if）；用本单元话题词；不要小学看图说话，也不要 B2 生僻词',
  },
  THINK3: {
    id: 'THINK3',
    cefr: 'B1+',
    label_zh: 'Think 3（B1+）',
    question_hint_zh: '稍长语境、对比与观点；仍低于 FCE',
  },
  THINK4: {
    id: 'THINK4',
    cefr: 'B2',
    label_zh: 'Think 4 / 对标 FCE 预备（B2）',
    question_hint_zh: '抽象话题、较复杂从句，词汇可到 B2',
  },
  KET: {
    id: 'KET',
    cefr: 'A2',
    label_zh: 'KET / A2 Key',
    question_hint_zh: '对标 A2 Key 口吻与词汇，短语境选择/填空',
  },
  PET: {
    id: 'PET',
    cefr: 'B1',
    label_zh: 'PET / B1 Preliminary',
    question_hint_zh: '对标 PET：语境选择、词义辨析、简短理由；B1 词汇与句式',
  },
};

/**
 * @param {Record<string, unknown>} body
 * @returns {{ textbook: string, unit_ref: string, curriculum: string }}
 */
export function normalizeMaterialFields(body = {}) {
  const nested =
    body.material && typeof body.material === 'object' && !Array.isArray(body.material)
      ? body.material
      : {};
  const textbook = asNonEmpty(
    body.textbook ?? body.book ?? body.course ?? nested.textbook,
  );
  const unitRef = asNonEmpty(
    body.unit_ref ??
      body.unitRef ??
      nested.unit_ref ??
      nested.unitRef ??
      (typeof body.unit === 'string' ? body.unit : ''),
  );
  const curriculum = asNonEmpty(body.curriculum ?? nested.curriculum);
  return {
    textbook,
    unit_ref: unitRef,
    curriculum,
  };
}

/**
 * @param {{ textbook?: string, unit_ref?: string, curriculum?: string }} fields
 * @returns {(MaterialLevel & { textbook: string, unit_ref: string, curriculum: string }) | null}
 */
export function resolveMaterialLevel(fields = {}) {
  const textbook = asNonEmpty(fields.textbook);
  const unitRef = asNonEmpty(fields.unit_ref);
  const curriculum = asNonEmpty(fields.curriculum);
  const key = compact(textbook) || compact(curriculum);
  if (!key) return null;

  let level = null;
  if (/THINK4/.test(key) || /FCE|B2FIRST/.test(key)) level = LEVELS.THINK4;
  else if (/THINK3/.test(key)) level = LEVELS.THINK3;
  else if (/THINK2/.test(key)) level = LEVELS.THINK2;
  else if (/THINKSTARTER/.test(key)) level = LEVELS.KIDSBOX_HIGH;
  else if (/THINK1/.test(key)) level = LEVELS.THINK1;
  else if (key === 'PET' || key.includes('B1PRELIMINARY') || key.includes('PRELIMINARY')) {
    level = LEVELS.PET;
  } else if (key === 'KET' || key.includes('A2KEY') || key.startsWith('KET')) {
    level = LEVELS.KET;
  } else if (/KIDSBOX/.test(key)) {
    const n = key.match(/KIDSBOX(\d)/);
    const num = n ? Number(n[1]) : 3;
    level = num <= 4 ? LEVELS.KIDSBOX_LOW : LEVELS.KIDSBOX_HIGH;
  }

  if (!level) return null;
  return {
    ...level,
    textbook,
    unit_ref: unitRef,
    curriculum,
  };
}
