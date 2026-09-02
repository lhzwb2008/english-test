/**
 * 错题讲解横屏模板（1920×1080）。画面文字来自分镜 JSON，不走生图。
 */
export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

const FONT =
  "'PingFang SC','Hiragino Sans GB','WenQuanYi Micro Hei','Noto Sans CJK SC',sans-serif";

const C = {
  primary: '#4F86F7',
  accent: '#FF9F43',
  success: '#2ECC71',
  purple: '#9B59B6',
  teal: '#1ABC9C',
  danger: '#E74C3C',
  bg: '#F7FAFF',
  card: '#FFFFFF',
  text: '#2C3E50',
  muted: '#5D6D7E',
  white: '#FFFFFF',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function charW(ch, size) {
  const code = ch.codePointAt(0) || 0;
  if (code > 0x2e80) return size;
  if (ch === ' ') return size * 0.32;
  return size * 0.56;
}

export function wrapText(text, maxWidth, fontSize) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const lines = [];
  let buf = '';
  let w = 0;
  for (const ch of t) {
    const cw = charW(ch, fontSize);
    if (buf && w + cw > maxWidth) {
      lines.push(buf);
      buf = ch;
      w = cw;
    } else {
      buf += ch;
      w += cw;
    }
    if (lines.length >= 5) break;
  }
  if (buf && lines.length < 6) lines.push(buf);
  return lines;
}

function texts(lines, x, y, { size = 32, fill = C.text, weight = 700, anchor = 'start', lh } = {}) {
  const step = lh || Math.round(size * 1.38);
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * step}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}">${esc(line)}</text>`,
    )
    .join('\n');
}

function sparkles(color = '#FFD93D') {
  const pts = [
    [150, 110, 9],
    [1780, 130, 7],
    [220, 980, 8],
    [1740, 940, 10],
    [320, 200, 6],
    [1620, 220, 6],
  ];
  return pts
    .map(
      ([x, y, r]) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.92"/>`,
    )
    .join('');
}

function shell(bg, inner) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">
  <rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${bg}"/>
  <defs>
    <filter id="sh" x="-8%" y="-8%" width="120%" height="130%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#2C3E50" flood-opacity="0.14"/>
    </filter>
  </defs>
  ${inner}
</svg>`;
}

function pill(cx, y, label, fill, { fontSize = 36, padX = 48, h = 72 } = {}) {
  const width = Math.min(1600, Math.max(280, label.length * fontSize * 0.7 + padX * 2));
  const x = cx - width / 2;
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${h}" rx="${h / 2}" fill="${fill}"/>
    <text x="${cx}" y="${y + h * 0.68}" text-anchor="middle" fill="${C.white}" font-size="${fontSize}" font-weight="700" font-family="${FONT}">${esc(label)}</text>
  `;
}

function speakerColor(speaker) {
  const s = String(speaker || '').toUpperCase();
  if (s.startsWith('B')) return C.purple;
  if (s.startsWith('A')) return C.primary;
  return C.teal;
}

function lineCard(line, x, y, w, h) {
  const color = speakerColor(line.speaker);
  const tag = line.n
    ? `第 ${line.n} 句  ${line.speaker || ''}`.trim()
    : String(line.speaker || '');
  const enLines = wrapText(line.en || '', w - 56, 28);
  const zhLines = wrapText(line.zh || '', w - 56, 22);
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${C.card}" filter="url(#sh)"/>
    <rect x="${x}" y="${y}" width="10" height="${h}" rx="6" fill="${color}"/>
    <rect x="${x + 28}" y="${y + 18}" width="${Math.min(220, 28 + tag.length * 16)}" height="36" rx="10" fill="${color}"/>
    <text x="${x + 40}" y="${y + 44}" fill="${C.white}" font-size="18" font-weight="700" font-family="${FONT}">${esc(tag)}</text>
    ${texts(enLines, x + 28, y + 88, { size: 28, fill: C.text, weight: 700 })}
    ${texts(zhLines, x + 28, y + 88 + enLines.length * 38 + 8, { size: 22, fill: C.muted, weight: 500 })}
  `;
}

function renderIntro(scene) {
  const title = String(scene.title || '错题讲解');
  const sub = String(scene.subtitle || scene.mnemonic || '');
  const titleLines = wrapText(title, 1500, 64);
  const subLines = wrapText(sub, 1200, 30);
  return shell(
    C.primary,
    `
    ${sparkles('#FFD93D')}
    ${texts(titleLines, 960, 430, { size: 64, fill: C.white, weight: 700, anchor: 'middle', lh: 84 })}
    <rect x="360" y="620" width="1200" height="${64 + subLines.length * 40}" rx="36" fill="rgba(255,255,255,0.18)"/>
    ${texts(subLines, 960, 668, { size: 30, fill: C.white, weight: 600, anchor: 'middle', lh: 42 })}
    `,
  );
}

function renderStep(scene) {
  const step = scene.step ? `第 ${scene.step} 步：${scene.step_title || scene.title || ''}` : String(scene.title || '解题');
  const lines = Array.isArray(scene.lines) ? scene.lines.slice(0, 3) : [];
  const tip = String(scene.tip || '');
  const n = Math.max(1, lines.length);
  const cardH = n === 1 ? 420 : n === 2 ? 280 : 210;
  const gap = 22;
  const top = 170;
  const cards = lines.map((line, i) => {
    const y = top + i * (cardH + gap);
    const stagger = i % 2 === 1 ? 80 : 0;
    return lineCard(line, 140 + stagger, y, 1640 - stagger, cardH);
  });
  const tipBar = tip
    ? `<rect x="140" y="960" width="1640" height="80" rx="18" fill="#EEF4FF"/>
       ${texts(wrapText(`提示：${tip}`, 1560, 26), 170, 1010, { size: 26, fill: C.primary, weight: 600 })}`
    : '';
  return shell(
    C.bg,
    `
    ${sparkles('#F5C542')}
    ${pill(960, 48, step, C.primary)}
    ${cards.join('\n')}
    ${tipBar}
    `,
  );
}

function miniLines(lines, x, y, w, enSize = 20) {
  const items = (lines || []).slice(0, 5);
  return items
    .map((line, i) => {
      const yy = y + i * 78;
      const color = speakerColor(line.speaker);
      const label = `${line.n || i + 1}`;
      const en = wrapText(
        `${line.speaker ? `${line.speaker}: ` : ''}${line.en || ''}`,
        w - 70,
        enSize,
      ).slice(0, 2);
      return `
        <circle cx="${x + 18}" cy="${yy + 8}" r="16" fill="${color}"/>
        <text x="${x + 18}" y="${yy + 14}" text-anchor="middle" fill="${C.white}" font-size="14" font-weight="700" font-family="${FONT}">${esc(label)}</text>
        ${texts(en, x + 44, yy + 14, { size: enSize, fill: C.text, weight: 650 })}
      `;
    })
    .join('');
}

function renderTrap(scene) {
  const title = String(scene.title || '小心陷阱');
  const wrong = scene.wrong || {};
  const right = scene.right || {};
  const colW = 820;
  const colY = 160;
  const colH = 780;
  const whyWrong = wrapText(wrong.why || '', 740, 22);
  const whyRight = wrapText(right.why || '', 740, 22);
  return shell(
    C.bg,
    `
    ${pill(960, 40, title, C.danger, { fontSize: 34 })}
    <rect x="80" y="${colY}" width="${colW}" height="${colH}" rx="24" fill="#FFF5F5" filter="url(#sh)"/>
    <text x="${80 + colW / 2}" y="${colY + 58}" text-anchor="middle" fill="${C.danger}" font-size="32" font-weight="700" font-family="${FONT}">错误排法</text>
    ${miniLines(wrong.lines, 110, colY + 110, 760, 20)}
    <rect x="110" y="${colY + colH - 150}" width="760" height="120" rx="16" fill="#FADBD8"/>
    ${texts(whyWrong, 130, colY + colH - 108, { size: 22, fill: C.danger, weight: 600, lh: 32 })}

    <rect x="1020" y="${colY}" width="${colW}" height="${colH}" rx="24" fill="#F0FFF4" filter="url(#sh)"/>
    <text x="${1020 + colW / 2}" y="${colY + 58}" text-anchor="middle" fill="${C.success}" font-size="32" font-weight="700" font-family="${FONT}">正确排法</text>
    ${miniLines(right.lines, 1050, colY + 110, 760, 20)}
    <rect x="1050" y="${colY + colH - 150}" width="760" height="120" rx="16" fill="#D5F5E3"/>
    ${texts(whyRight, 1070, colY + colH - 108, { size: 22, fill: '#1E8449', weight: 600, lh: 32 })}
    `,
  );
}

function renderAnswer(scene) {
  const title = String(scene.title || '完整答案');
  const lines = Array.isArray(scene.lines) ? scene.lines.slice(0, 8) : [];
  const badge = String(scene.badge || '');
  const rowH = lines.length > 6 ? 72 : 82;
  const startY = 150;
  const rows = lines
    .map((line, i) => {
      const y = startY + i * rowH;
      const color = speakerColor(line.speaker);
      const head = line.speaker ? `${line.speaker}: ` : '';
      const main = wrapText(`${head}${line.en || line.zh || ''}`, 1480, 24).slice(
        0,
        2,
      );
      const sub =
        line.en && line.zh
          ? wrapText(String(line.zh), 1480, 20).slice(0, 1)
          : [];
      return `
        <circle cx="200" cy="${y + 10}" r="22" fill="${color}"/>
        <text x="200" y="${y + 18}" text-anchor="middle" fill="${C.white}" font-size="18" font-weight="700" font-family="${FONT}">${esc(String(line.n || i + 1))}</text>
        ${texts(main, 240, y + 16, { size: 24, fill: C.text, weight: 650, lh: 32 })}
        ${sub.length ? texts(sub, 240, y + 16 + main.length * 32, { size: 20, fill: C.muted, weight: 500 }) : ''}
      `;
    })
    .join('');
  const footer = badge
    ? `<rect x="140" y="980" width="1640" height="64" rx="16" fill="#FFF6E0"/>
       ${texts(wrapText(badge, 1560, 24), 960, 1022, { size: 24, fill: C.accent, weight: 700, anchor: 'middle' })}`
    : '';
  return shell(
    C.bg,
    `
    ${sparkles('#F5C542')}
    ${pill(960, 40, title, C.accent, { fontSize: 34 })}
    <rect x="140" y="130" width="1640" height="820" rx="28" fill="${C.card}" stroke="${C.primary}" stroke-width="3" filter="url(#sh)"/>
    ${rows}
    ${footer}
    `,
  );
}

function renderEnding(scene) {
  const title = String(scene.title || '你学会了吗？');
  const mnemonic = String(scene.mnemonic || scene.subtitle || '');
  const bye = String(scene.bye || '下一题见');
  const mLines = wrapText(mnemonic, 1300, 34);
  return shell(
    C.success,
    `
    ${sparkles('#FFF3A0')}
    ${texts(wrapText(title, 1400, 68), 960, 380, { size: 68, fill: C.white, weight: 700, anchor: 'middle', lh: 88 })}
    <rect x="320" y="500" width="1280" height="${80 + mLines.length * 46}" rx="40" fill="rgba(255,255,255,0.2)"/>
    ${texts(mLines, 960, 558, { size: 34, fill: C.white, weight: 650, anchor: 'middle', lh: 48 })}
    ${texts([bye], 960, 820, { size: 28, fill: 'rgba(255,255,255,0.9)', weight: 500, anchor: 'middle' })}
    `,
  );
}

function renderCards(scene) {
  const title = String(scene.title || scene.step_title || '讲解');
  const body = String(scene.body || scene.tip || '');
  const bodyLines = wrapText(body, 1500, 36);
  return shell(
    C.bg,
    `
    ${pill(960, 48, title, C.primary)}
    <rect x="160" y="200" width="1600" height="720" rx="28" fill="${C.card}" filter="url(#sh)"/>
    ${texts(bodyLines, 220, 320, { size: 36, fill: C.text, weight: 600, lh: 54 })}
    `,
  );
}

/**
 * @param {Record<string, unknown>} scene
 * @returns {string} SVG
 */
export function sceneToSvg(scene) {
  const type = String(scene?.type || 'step');
  if (type === 'intro') return renderIntro(scene);
  if (type === 'trap') return renderTrap(scene);
  if (type === 'answer') return renderAnswer(scene);
  if (type === 'ending') return renderEnding(scene);
  if (type === 'cards' || type === 'point') return renderCards(scene);
  return renderStep(scene);
}
