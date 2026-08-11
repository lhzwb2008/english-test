/**
 * PET（B1 Preliminary）官方量表换算（2020 改革后）。
 * 锚点来自《PET 评分规则总结》；中间分用相邻锚点线性插值，总分四舍五入取整。
 */

/** @typedef {'reading' | 'writing' | 'listening' | 'speaking'} PetSkill */

/** @type {Record<PetSkill, { maxRaw: number; anchors: [number, number][] }>} */
export const PET_SKILL_TABLES = {
  reading: {
    maxRaw: 32,
    // 原始分 → 剑桥量表分
    anchors: [
      [13, 120],
      [23, 140],
      [27, 153],
      [29, 160],
      [32, 170],
    ],
  },
  writing: {
    maxRaw: 40,
    anchors: [
      [16, 120],
      [24, 140],
      [31, 153],
      [34, 160],
      [40, 170],
    ],
  },
  listening: {
    maxRaw: 25,
    anchors: [
      [11, 120],
      [18, 140],
      [21, 153],
      [23, 160],
      [25, 170],
    ],
  },
  speaking: {
    maxRaw: 30,
    anchors: [
      [12, 120],
      [18, 140],
      [24, 153],
      [27, 160],
      [30, 170],
    ],
  },
};

/**
 * 口语原始分：4 个分项各 0–5 + 整体表现 0–5（权重×2），满分 30。
 * @param {{ grammar_vocabulary?: number, grammarVocabulary?: number, discourse_management?: number, discourseManagement?: number, pronunciation?: number, interactive_communication?: number, interactiveCommunication?: number, global_achievement?: number, globalAchievement?: number }} dims
 * @returns {number}
 */
export function speakingRawFromDimensions(dims = {}) {
  const g =
    dims.grammar_vocabulary ?? dims.grammarVocabulary ?? 0;
  const d =
    dims.discourse_management ?? dims.discourseManagement ?? 0;
  const p = dims.pronunciation ?? 0;
  const i =
    dims.interactive_communication ?? dims.interactiveCommunication ?? 0;
  const overall = dims.global_achievement ?? dims.globalAchievement ?? 0;
  return Number(g) + Number(d) + Number(p) + Number(i) + Number(overall) * 2;
}

/**
 * @param {number} raw
 * @param {[number, number][]} anchors 按原始分升序
 * @returns {number} 量表分（可带小数，便于再平均）
 */
export function rawToScale(raw, anchors) {
  const x = Number(raw);
  if (!Number.isFinite(x)) {
    throw new Error(`无效原始分: ${raw}`);
  }
  if (!anchors?.length) {
    throw new Error('缺少换算锚点');
  }

  if (x <= anchors[0][0]) {
    // 低于最低锚点：按最低两点斜率外推，并夹到合理下限
    if (anchors.length < 2) return anchors[0][1];
    const [x0, y0] = anchors[0];
    const [x1, y1] = anchors[1];
    const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    return Math.max(0, y);
  }

  const last = anchors[anchors.length - 1];
  if (x >= last[0]) {
    return last[1];
  }

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      if (x1 === x0) return y0;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }

  return last[1];
}

/**
 * 单项技能等级（跟踪表口径：优秀 / 通过 / 不通过）
 * @param {number} scale
 * @returns {{ label_zh: string, cambridge_grade: string | null, cefr: string | null }}
 */
export function skillGradeFromScale(scale) {
  const s = Number(scale);
  if (s >= 160) {
    return { label_zh: '卓越', cambridge_grade: 'Grade A', cefr: 'B2' };
  }
  if (s >= 153) {
    return { label_zh: '优秀', cambridge_grade: 'Grade B', cefr: 'B1' };
  }
  if (s >= 140) {
    return { label_zh: '通过', cambridge_grade: 'Grade C', cefr: 'B1' };
  }
  if (s >= 120) {
    return { label_zh: '不通过', cambridge_grade: null, cefr: 'A2' };
  }
  return { label_zh: '不通过', cambridge_grade: null, cefr: null };
}

/**
 * 综合总分等级（证书口径）
 * @param {number} totalScale 四舍五入后的总分
 */
export function overallGradeFromScale(totalScale) {
  const s = Math.round(Number(totalScale));
  if (s >= 160) {
    return {
      label_zh: '卓越 Grade A',
      cambridge_grade: 'Grade A',
      cefr: 'B2',
      certificate: true,
    };
  }
  if (s >= 153) {
    return {
      label_zh: '优秀 Grade B',
      cambridge_grade: 'Grade B',
      cefr: 'B1',
      certificate: true,
    };
  }
  if (s >= 140) {
    return {
      label_zh: '通过 Grade C',
      cambridge_grade: 'Grade C',
      cefr: 'B1',
      certificate: true,
    };
  }
  if (s >= 120) {
    return {
      label_zh: 'Level A2',
      cambridge_grade: null,
      cefr: 'A2',
      certificate: true,
    };
  }
  return {
    label_zh: '无证书',
    cambridge_grade: null,
    cefr: null,
    certificate: false,
  };
}

/**
 * @param {PetSkill} skill
 * @param {number} raw
 */
export function scoreSkill(skill, raw) {
  const table = PET_SKILL_TABLES[skill];
  if (!table) throw new Error(`未知技能: ${skill}`);
  const rawNum = Number(raw);
  if (!Number.isFinite(rawNum)) {
    throw new Error(`${skill} 原始分无效`);
  }
  if (rawNum < 0 || rawNum > table.maxRaw) {
    throw new Error(`${skill} 原始分须在 0–${table.maxRaw}，收到 ${rawNum}`);
  }
  const scale = rawToScale(rawNum, table.anchors);
  const grade = skillGradeFromScale(scale);
  return {
    skill,
    raw: rawNum,
    max_raw: table.maxRaw,
    scale,
    scale_rounded: Math.round(scale),
    ...grade,
  };
}

/**
 * @param {{
 *   reading?: number,
 *   writing?: number,
 *   listening?: number,
 *   speaking?: number,
 *   speaking_dimensions?: Record<string, number>,
 * }} input
 */
export function scorePetTest(input = {}) {
  /** @type {PetSkill[]} */
  const skills = ['reading', 'writing', 'listening', 'speaking'];
  const provided = {};

  if (input.reading !== undefined && input.reading !== null && input.reading !== '') {
    provided.reading = Number(input.reading);
  }
  if (input.writing !== undefined && input.writing !== null && input.writing !== '') {
    provided.writing = Number(input.writing);
  }
  if (input.listening !== undefined && input.listening !== null && input.listening !== '') {
    provided.listening = Number(input.listening);
  }

  let speakingRaw = input.speaking;
  if (
    (speakingRaw === undefined || speakingRaw === null || speakingRaw === '') &&
    input.speaking_dimensions
  ) {
    speakingRaw = speakingRawFromDimensions(input.speaking_dimensions);
  }
  if (speakingRaw !== undefined && speakingRaw !== null && speakingRaw !== '') {
    provided.speaking = Number(speakingRaw);
  }

  const keys = skills.filter((k) => provided[k] !== undefined);
  if (keys.length === 0) {
    throw new Error('至少提供 reading / writing / listening / speaking 中的一项原始分');
  }

  const bySkill = {};
  for (const k of keys) {
    bySkill[k] = scoreSkill(k, provided[k]);
  }

  const allFour = skills.every((k) => bySkill[k]);
  let overall = null;
  if (allFour) {
    const avg =
      (bySkill.reading.scale +
        bySkill.writing.scale +
        bySkill.listening.scale +
        bySkill.speaking.scale) /
      4;
    const total = Math.round(avg);
    overall = {
      scale: total,
      average_exact: avg,
      ...overallGradeFromScale(total),
      formula_zh:
        '总分 = (阅读量表分 + 写作量表分 + 听力量表分 + 口语量表分) ÷ 4，四舍五入取整',
    };
  }

  return {
    exam: 'PET',
    skills: bySkill,
    overall,
    missing_skills: skills.filter((k) => !bySkill[k]),
    notes_zh: [
      '四项权重相等，各占 25%',
      '写作：两篇作文各 0–20（四维各 0–5），原始满分 40',
      '口语原始分 = 四项分项之和 + 整体表现×2，满分 30',
      '中间原始分按锚点线性插值；官方完整对照表未公开时与证书可能有 ±1 偏差',
    ],
  };
}
