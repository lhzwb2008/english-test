/**
 * 把学生 traits 编成模型必须执行的口吻清单，避免只写成通用讲义。
 */

function asText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * 风格推断：显式入参仍由调用方处理。这里只根据文本猜。
 * traits 优先；学习历史里的 PET/KET 不得盖过「要趣味」。
 * @param {string} traits
 * @param {string} [studyHistory]
 * @returns {'logical'|'fun'|'visual'|'exam'|null}
 */
export function inferStyleFromTraits(traits, studyHistory = '') {
  const t = asText(traits);
  const h = asText(studyHistory);
  const pick = (text, { examFromPet } = {}) => {
    if (!text) return null;
    if (/图表|流程图|看图|视觉|表格速记|思维导图/.test(text)) return 'visual';
    if (/逻辑|框架|规则清晰|理性|条理|流程判断/.test(text)) return 'logical';
    if (
      /故事|例子|有趣|趣味|吸引|画面|比喻|人设|急躁|注意力短|注意力不集中|流行语|共鸣|青少年/.test(
        text,
      )
    ) {
      return 'fun';
    }
    if (/应试刷题|奔着得分|考试速记|要口诀/.test(text)) return 'exam';
    if (examFromPet && /应试|刷题|口诀|速记|模考/.test(text)) return 'exam';
    return null;
  };
  return pick(t) || pick(h, { examFromPet: true });
}

/**
 * 编译结果只含写法要求，不含档案原文。原文不得再送给模型，避免被写进给学生看的讲解。
 * @param {Record<string, unknown> | undefined} studentProfile
 * @returns {null | {
 *   tags: string[],
 *   must_do: string[],
 *   forbidden: string[],
 *   visible_check: string,
 * }}
 */
export function buildTraitVoice(studentProfile) {
  const traits = asText(studentProfile?.traits);
  if (!traits) return null;

  const tags = [];
  const must = [
    '特点只决定篇幅、场景和先讲什么；讲解、题目、解析、口播都写成普通老师本来就这么讲',
    '禁止向学生评价性格、基础、注意力或学习习惯，也禁止解释为什么今天这样讲',
  ];
  const forbidden = [
    '本节我们学习',
    '同学们大家好',
    '作为老师',
    '该题考查',
    '综上所述',
    '我知道你',
    '你性格',
    '性格偏',
    '基础有点弱',
    '基础比较弱',
    '容易走神',
    '根据你的情况',
    '针对你',
    '为你定制',
    '个性化',
  ];

  if (/趣味|有趣|吸引|流行语|共鸣|青少年|好玩/.test(traits)) {
    tags.push('teen_fun');
    must.push(
      '开篇第一句必须是学生口吻（「划重点：」「一句话记住：」「别踩坑：」），禁止教案腔',
    );
    must.push(
      '讲解里至少出现 4 处口语：搞定 / 别踩坑 / 划重点 / 记住就行 / 这坑太常见 / 直接上干货',
    );
    must.push('例句场景用手机、短视频、作业、球赛、同学，禁止小明去公园');
  }
  if (/注意力不集中|注意力差|注意力短|不能长时间|难以集中|急躁|拖拉|拖延/.test(traits)) {
    tags.push('short_attention');
    must.push('讲解全文不超过 900 字；每个 ## 先给结论再举例；每段最多 2 句');
    must.push('口诀或清单必须出现在讲解前 1/3');
  }
  if (/逻辑|条理|有条理|框架|理性/.test(traits)) {
    tags.push('logical');
    must.push('口播按「第一步…第二步…所以填/选…」；先给结论再补一句理由');
  }
  if (/亲和力|鼓励|多鼓励/.test(traits)) {
    tags.push('encourage');
    must.push('至少两处鼓励（「这很常见」「改过来就对了」），禁止训斥');
  }
  if (/例子|故事|画面/.test(traits) && !tags.includes('teen_fun')) {
    tags.push('story');
    must.push('每条规则至少 2 个生活化例句（英文+中文）');
  }
  if (/应试|刷题|得分|信号词/.test(traits)) {
    tags.push('exam_voice');
    must.push('每条规则配一句「题干出现 X → 选/用 Y」');
  }
  if (/流行语|青少年/.test(traits)) {
    must.push('题目解析也用同学口吻，禁止「该题考查…」');
  }
  if (!tags.length) {
    must.push('用周末、作业、同学这类生活场景举例；不要解释为什么选这些场景');
  }

  return {
    tags,
    must_do: must,
    forbidden,
    visible_check:
      '学生读完全文，不应发现这是按档案写的。出现「我知道你」「你性格」「基础弱」「走神」「所以咱们今天」这类评价或解释，必须删掉再重写。',
  };
}
