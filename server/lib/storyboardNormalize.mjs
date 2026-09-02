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
      return {
        ...scene,
        id: String(s.id || `s${i + 1}`),
        type,
        narration: normalizeNarration(s.narration, scene, mnemonic),
      };
    }),
  };
  assertScenesHaveNarration(normalized);
  return normalized;
}
