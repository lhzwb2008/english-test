/**
 * 分镜规范化：兼容模型漏写口播、字段名不一致。
 */

const TYPE_ALIASES = {
  'title-card': 'intro',
  title: 'intro',
  hook: 'intro',
  compare: 'trap',
  mistake: 'trap',
  contrast: 'trap',
  summary: 'answer',
  recap: 'answer',
  checklist: 'answer',
  outro: 'ending',
  close: 'ending',
  bye: 'ending',
};

function clipSpeech(text, max = 120) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/[，。；、\s]+$/u, '')}。`;
}

function firstLineEn(lines) {
  const en = String(lines?.[0]?.en || '').trim();
  if (!en) return '';
  const cut = en.split(/(?<=[.!?])\s+/)[0] || en;
  return cut.slice(0, 90);
}

function pushSeg(segs, voice, text) {
  const t = clipSpeech(text);
  if (t) segs.push({ voice: voice === 'en' ? 'en' : 'zh', text: t });
}

/**
 * 模型常把口播落成空数组 / 字符串 / 其它字段名。没有则按画面文案补一段。
 */
export function fallbackNarration(scene, mnemonic = '') {
  const type = String(scene?.type || 'step');
  const title = String(scene?.title || scene?.step_title || '').trim();
  const tip = String(scene?.tip || '').trim();
  const sub = String(scene?.subtitle || '').trim();
  const lines = Array.isArray(scene?.lines) ? scene.lines : [];
  const segs = [];

  if (type === 'intro') {
    pushSeg(
      segs,
      'zh',
      [title, sub || mnemonic, '划重点，跟我过一遍。'].filter(Boolean).join('。'),
    );
  } else if (type === 'trap') {
    const why = String(scene?.wrong?.why || scene?.right?.why || '').trim();
    pushSeg(
      segs,
      'zh',
      why || `${title || '小心这个坑'}。左边是错的，右边才对。`,
    );
  } else if (type === 'answer') {
    const zhs = lines
      .map((l) => String(l?.zh || '').trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' ');
    pushSeg(segs, 'zh', zhs || title || '对照这几条记住。');
  } else if (type === 'ending') {
    pushSeg(segs, 'zh', mnemonic || title || '记住口诀，下一题见。');
  } else {
    pushSeg(
      segs,
      'zh',
      [title, lines[0]?.zh, tip].filter(Boolean).join('。') || '看这一页的例子。',
    );
    const en = firstLineEn(lines);
    if (en) pushSeg(segs, 'en', en);
  }
  if (!segs.length) pushSeg(segs, 'zh', '看这一页。');
  return segs;
}

export function normalizeNarration(raw, scene = {}, mnemonic = '') {
  const segs = [];

  if (typeof raw === 'string') {
    pushSeg(segs, 'zh', raw);
  } else if (Array.isArray(raw)) {
    for (const seg of raw) {
      if (typeof seg === 'string') {
        pushSeg(segs, 'zh', seg);
        continue;
      }
      if (!seg || typeof seg !== 'object') continue;
      const text = String(
        seg.text || seg.content || seg.zh || seg.narration || '',
      ).trim();
      const en = String(seg.en || '').trim();
      const voice = String(
        seg.voice || (en && !text ? 'en' : 'zh'),
      ).toLowerCase();
      if (text) pushSeg(segs, voice === 'en' ? 'en' : 'zh', text);
      else if (en) pushSeg(segs, 'en', en);
    }
  } else if (raw && typeof raw === 'object') {
    if (raw.zh) pushSeg(segs, 'zh', raw.zh);
    if (raw.en) pushSeg(segs, 'en', raw.en);
    if (raw.text) pushSeg(segs, raw.voice === 'en' ? 'en' : 'zh', raw.text);
  }

  if (segs.length) return segs;
  return fallbackNarration(scene, mnemonic);
}

export function countEmptyRawNarration(raw) {
  const scenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
  return scenes.filter((s) => {
    const n = s?.narration;
    if (n == null || n === '') return true;
    if (Array.isArray(n) && n.length === 0) return true;
    if (Array.isArray(n) && n.every((seg) => {
      if (typeof seg === 'string') return !seg.trim();
      if (!seg || typeof seg !== 'object') return true;
      return !String(seg.text || seg.content || seg.zh || seg.en || '').trim();
    })) return true;
    return false;
  }).length;
}

export function assertScenesHaveNarration(script) {
  const scenes = script?.scenes || [];
  for (const scene of scenes) {
    const n = scene?.narration;
    if (!Array.isArray(n) || n.length === 0 || !n[0]?.text) {
      throw new Error(`场景 ${scene?.id || scene?.type || '?'} 无口播`);
    }
  }
}

function looksEnglish(text) {
  const t = String(text || '');
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return letters >= 3 && letters >= t.replace(/\s/g, '').length * 0.35;
}

function stripContrastMarks(text) {
  return String(text || '')
    .replace(/[❌✅]/g, '')
    .replace(/[（(]\s*(错误|正确|wrong|right|incorrect|correct)\s*[)）]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asLineList(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    const t = stripContrastMarks(raw);
    if (!t) return [];
    return looksEnglish(t) ? [{ n: 1, en: t, zh: '' }] : [{ n: 1, en: '', zh: t }];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item, i) => {
        if (typeof item === 'string') {
          const t = stripContrastMarks(item);
          if (!t) return null;
          return looksEnglish(t)
            ? { n: i + 1, en: t, zh: '' }
            : { n: i + 1, en: '', zh: t };
        }
        if (!item || typeof item !== 'object') return null;
        const en = stripContrastMarks(
          item.en || item.text || item.sentence || item.example || '',
        );
        const zh = stripContrastMarks(item.zh || item.note || '');
        if (!en && !zh) return null;
        return {
          n: item.n || i + 1,
          speaker: item.speaker,
          en,
          zh,
        };
      })
      .filter(Boolean);
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.lines)) return asLineList(raw.lines);
    const en = stripContrastMarks(raw.en || raw.text || raw.sentence || '');
    const zh = stripContrastMarks(raw.zh || '');
    if (en || zh) return [{ n: raw.n || 1, speaker: raw.speaker, en, zh }];
  }
  return [];
}

function isWrongMarked(line) {
  const blob = `${line?.en || ''} ${line?.zh || ''} ${line?.mark || ''}`;
  if (/❌/.test(blob)) return true;
  if (/✅/.test(blob)) return false;
  return /错误|incorrect|\bwrong\b/i.test(blob);
}

function isRightMarked(line) {
  const blob = `${line?.en || ''} ${line?.zh || ''} ${line?.mark || ''}`;
  if (/✅/.test(blob)) return true;
  if (/❌/.test(blob)) return false;
  return /正确|correct|\bright\b/i.test(blob);
}

function splitContrastLines(lines) {
  const wrong = [];
  const right = [];
  for (const line of lines || []) {
    if (isWrongMarked(line) && !isRightMarked(line)) wrong.push({ ...line, en: stripContrastMarks(line.en), zh: stripContrastMarks(line.zh) });
    else if (isRightMarked(line)) right.push({ ...line, en: stripContrastMarks(line.en), zh: stripContrastMarks(line.zh) });
  }
  return { wrong, right };
}

function sideWhy(existing) {
  return String(existing || '').trim();
}

/**
 * 模型常把对错例句写成 wrong_lines、scene.lines+❌✅，画面只认 wrong.lines。
 */
export function normalizeTrapScene(scene, narration = []) {
  const src = scene && typeof scene === 'object' ? scene : {};
  let wrongLines = asLineList(
    src.wrong?.lines ?? src.wrong_lines ?? src.incorrect_lines ?? src.incorrect,
  );
  let rightLines = asLineList(
    src.right?.lines ?? src.right_lines ?? src.correct_lines ?? src.correct,
  );
  if (!wrongLines.length) wrongLines = asLineList(src.wrong);
  if (!rightLines.length) rightLines = asLineList(src.right);

  if (!wrongLines.length || !rightLines.length) {
    const split = splitContrastLines(asLineList(src.lines));
    if (!wrongLines.length) wrongLines = split.wrong;
    if (!rightLines.length) rightLines = split.right;
  }

  if (!wrongLines.length || !rightLines.length) {
    const ens = (Array.isArray(narration) ? narration : [])
      .filter((s) => s?.voice === 'en' && s?.text)
      .map((s) => String(s.text).trim());
    if (ens.length >= 2) {
      if (!wrongLines.length) wrongLines = [{ n: 1, en: ens[0], zh: '' }];
      if (!rightLines.length) rightLines = [{ n: 1, en: ens[ens.length - 1], zh: '' }];
    }
  }

  const whyWrong = sideWhy(src.wrong?.why ?? src.wrong_why);
  const whyRight = sideWhy(src.right?.why ?? src.right_why);

  return {
    wrong: { lines: wrongLines, why: whyWrong },
    right: { lines: rightLines, why: whyRight },
  };
}

export function assertTrapHasContrast(script) {
  const traps = (script?.scenes || []).filter((s) => s?.type === 'trap');
  for (const scene of traps) {
    const w = scene?.wrong?.lines?.length || 0;
    const r = scene?.right?.lines?.length || 0;
    if (!w || !r) {
      throw new Error(
        `场景 ${scene?.id || 'trap'} 缺少对错例句（wrong=${w} right=${r}）`,
      );
    }
  }
}

export function normalizeStoryboard(raw, fallbackTitle) {
  const title = String(raw?.title || fallbackTitle || '错题讲解').trim();
  const mnemonic = String(raw?.mnemonic || '').trim();
  let scenes = Array.isArray(raw?.scenes)
    ? raw.scenes.filter((s) => s && typeof s === 'object')
    : [];
  scenes = scenes.slice(0, 7);
  if (scenes.length < 4) {
    throw new Error(`分镜页数不足（需要≥4）: ${scenes.length}`);
  }
  const canonType = (s) => {
    const rawType = String(s?.type || 'step').trim();
    return TYPE_ALIASES[rawType] || rawType || 'step';
  };
  const types = new Set(scenes.map(canonType));
  if (!types.has('trap')) {
    throw new Error('分镜缺少 trap（易错对比）场景');
  }
  if (!types.has('answer') && !types.has('ending')) {
    throw new Error('分镜缺少 answer 或 ending');
  }
  const normalized = {
    title,
    mnemonic,
    scenes: scenes.map((s, i) => {
      const rawType = String(s.type || 'step').trim();
      const type = TYPE_ALIASES[rawType] || rawType || 'step';
      const scene = { ...s, type };
      delete scene.visual;
      if (type === 'ending' && !scene.mnemonic && mnemonic) {
        scene.mnemonic = mnemonic;
      }
      if (type === 'intro' && !scene.subtitle && mnemonic) {
        scene.subtitle = mnemonic;
      }
      const narration = normalizeNarration(s.narration, scene, mnemonic);
      const extra =
        type === 'trap' ? normalizeTrapScene(scene, narration) : {};
      return {
        ...scene,
        ...extra,
        id: String(s.id || `s${i + 1}`),
        type,
        narration,
      };
    }),
  };
  assertScenesHaveNarration(normalized);
  assertTrapHasContrast(normalized);
  return normalized;
}
