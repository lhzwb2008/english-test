/**
 * 错题讲解横屏模板（1920×1080）。画面文字来自分镜 JSON，不走生图。
 * 字号按条数放大，让例句尽量占满卡片，避免「窗很大、字很小」。
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
  if (ch === ' ') return size * 0.34;
  return size * 0.58;
}

function measure(text, fontSize) {
  let w = 0;
  for (const ch of String(text || '')) w += charW(ch, fontSize);
  return w;
}

function wrapByChar(t, maxWidth, fontSize, maxLines) {
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
    if (lines.length >= maxLines) return lines;
  }
  if (buf && lines.length < maxLines) lines.push(buf);
  return lines;
}

function wrapByPunct(t, maxWidth, fontSize, maxLines) {
  const chunks = t.split(/(?<=[，。；、!！?？])/).filter(Boolean);
  if (chunks.length < 2) return null;
  const lines = [];
  let buf = '';
  for (const chunk of chunks) {
    const next = buf + chunk;
    if (buf && measure(next, fontSize) > maxWidth) {
      lines.push(buf);
      buf = measure(chunk, fontSize) > maxWidth
        ? wrapByChar(chunk, maxWidth, fontSize, 1)[0] || chunk
        : chunk;
      if (lines.length >= maxLines) return lines;
    } else {
      buf = next;
    }
  }
  if (buf && lines.length < maxLines) lines.push(buf);
  return lines;
}

export function wrapText(text, maxWidth, fontSize, maxLines = 6) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const compact = t.replace(/\s/g, '').length || 1;
  if (letters / compact < 0.45) {
    return wrapByPunct(t, maxWidth, fontSize, maxLines)
      || wrapByChar(t, maxWidth, fontSize, maxLines);
  }
  const lines = [];
  let buf = '';
  for (const word of t.split(' ')) {
    const next = buf ? `${buf} ${word}` : word;
    if (buf && measure(next, fontSize) > maxWidth) {
      lines.push(buf);
      buf = measure(word, fontSize) > maxWidth
        ? wrapByChar(word, maxWidth, fontSize, 1)[0] || word
        : word;
      if (lines.length >= maxLines) return lines;
    } else {
      buf = next;
    }
  }
  if (buf && lines.length < maxLines) lines.push(buf);
  return lines;
}

function texts(lines, x, y, { size = 32, fill = C.text, weight = 700, anchor = 'start', lh } = {}) {
  const step = lh || Math.round(size * 1.32);
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${y + i * step}" text-anchor="${anchor}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="${FONT}">${esc(line)}</text>`,
    )
    .join('\n');
}

function sparkles(color = '#FFD93D') {
  const pts = [
    [120, 90, 10],
    [1800, 100, 8],
    [160, 990, 9],
    [1760, 970, 11],
  ];
  return pts
    .map(
      ([x, y, r]) =>
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="0.9"/>`,
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

function pill(cx, y, label, fill, { fontSize = 42, padX = 52, h = 84 } = {}) {
  const width = Math.min(1760, Math.max(320, label.length * fontSize * 0.72 + padX * 2));
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

function scaleForCount(n, few, mid, many, dense) {
  if (n <= 1) return few;
  if (n <= 2) return mid;
  if (n <= 4) return many;
  return dense ?? many;
}

function lineCard(line, x, y, w, h) {
  const color = speakerColor(line.speaker);
  const tagged = Boolean(line.speaker);
  const tag = line.n
    ? `第 ${line.n} 句  ${line.speaker || ''}`.trim()
    : String(line.speaker || '例句');
  const enSize = h >= 500 ? 66 : h >= 340 ? 50 : h >= 210 ? 40 : 32;
  const zhSize = Math.round(enSize * 0.76);
  const pad = 48;
  const innerW = w - pad * 2;
  const center = !line.speaker;
  const wrapW =
    center && String(line.en || '').length > 22
      ? Math.round(innerW * 0.72)
      : innerW;
  const enLines = wrapText(line.en || '', wrapW, enSize, 4);
  const zhLines = wrapText(line.zh || '', wrapW, zhSize, 3);
  const enH = enLines.length * Math.round(enSize * 1.26);
  const zhH = zhLines.length ? zhLines.length * Math.round(zhSize * 1.3) + 14 : 0;
  const blockH = (tagged ? 36 : 0) + enH + zhH;
  const textY = y + Math.max(tagged ? 100 : 72, Math.round((h - blockH) / 2) + (tagged ? 28 : 16));
  const tx = center ? x + w / 2 : x + pad;
  const anchor = center ? 'middle' : 'start';
  const tagW = Math.min(w - 80, Math.max(200, 48 + tag.length * 22));
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="${C.card}" filter="url(#sh)"/>
    <rect x="${x}" y="${y}" width="14" height="${h}" rx="7" fill="${color}"/>
    ${
      tagged
        ? `<rect x="${x + 32}" y="${y + 22}" width="${tagW}" height="48" rx="14" fill="${color}"/>
    <text x="${x + 48}" y="${y + 56}" fill="${C.white}" font-size="24" font-weight="700" font-family="${FONT}">${esc(tag)}</text>`
        : ''
    }
    ${texts(enLines, tx, textY, { size: enSize, fill: C.text, weight: 700, lh: Math.round(enSize * 1.26), anchor })}
    ${texts(zhLines, tx, textY + enH + 18, { size: zhSize, fill: C.muted, weight: 650, lh: Math.round(zhSize * 1.3), anchor })}
  `;
}

function renderIntro(scene) {
  const title = String(scene.title || '错题讲解');
  const sub = String(scene.subtitle || scene.mnemonic || '');
  const titleSize = title.length > 18 ? 84 : 108;
  const titleLines = wrapText(title, 1720, titleSize, 3);
  const subSize = 54;
  const subLines = wrapText(sub, 1320, subSize, 4);
  const titleH = titleLines.length * Math.round(titleSize * 1.18);
  const boxH = Math.max(180, 80 + subLines.length * Math.round(subSize * 1.38));
  const titleY = 280;
  const boxY = titleY + titleH + 56;
  const boxW = 1680;
  const subBlockH = (subLines.length - 1) * Math.round(subSize * 1.38);
  return shell(
    C.primary,
    `
    ${sparkles('#FFD93D')}
    ${texts(titleLines, 960, titleY, { size: titleSize, fill: C.white, weight: 700, anchor: 'middle', lh: Math.round(titleSize * 1.18) })}
    <rect x="${(CANVAS_W - boxW) / 2}" y="${boxY}" width="${boxW}" height="${boxH}" rx="44" fill="rgba(255,255,255,0.2)"/>
    ${texts(subLines, 960, boxY + Math.round(boxH / 2) - subBlockH / 2 + 10, { size: subSize, fill: C.white, weight: 700, anchor: 'middle', lh: Math.round(subSize * 1.38) })}
    `,
  );
}

function renderStep(scene) {
  const step = scene.step
    ? `第 ${scene.step} 步：${scene.step_title || scene.title || ''}`
    : String(scene.title || '解题');
  const lines = Array.isArray(scene.lines) ? scene.lines.slice(0, 3) : [];
  const tip = String(scene.tip || '');
  const n = Math.max(1, lines.length);
  const top = 140;
  const bottom = tip ? 150 : 48;
  const gap = n === 1 ? 0 : 28;
  const usable = CANVAS_H - top - bottom;
  const cardH = Math.floor((usable - gap * (n - 1)) / n);
  const cards = lines.map((line, i) => {
    const y = top + i * (cardH + gap);
    return lineCard(line, 80, y, 1760, cardH);
  });
  const tipBar = tip
    ? `<rect x="80" y="940" width="1760" height="100" rx="22" fill="#EEF4FF"/>
       ${texts(wrapText(`提示：${tip}`, 1660, 32, 2), 110, 1004, { size: 32, fill: C.primary, weight: 700, lh: 42 })}`
    : '';
  return shell(
    C.bg,
    `
    ${sparkles('#F5C542')}
    ${pill(960, 28, step, C.primary, { fontSize: 40, h: 82 })}
    ${cards.join('\n')}
    ${tipBar}
    `,
  );
}

function miniLines(lines, x, y, w, h, { badge = C.teal } = {}) {
  const items = (lines || []).slice(0, 4);
  const n = Math.max(1, items.length);
  const rowH = Math.floor(h / n);
  const enSize = scaleForCount(n, 62, 40, 32, 30);
  const zhSize = Math.round(enSize * 0.7);
  const center = n === 1 && !items[0]?.speaker;
  return items
    .map((line, i) => {
      const yy = y + i * rowH;
      const color = line.speaker ? speakerColor(line.speaker) : badge;
      const label = `${line.n || i + 1}`;
      const prefix = line.speaker ? `${line.speaker}: ` : '';
      const textW = w - (center ? 48 : 96);
      const wrapW =
        center && String(line.en || '').length > 18
          ? Math.round(textW * 0.88)
          : textW;
      const en = wrapText(`${prefix}${line.en || line.zh || ''}`, wrapW, enSize, 3);
      const zh =
        line.en && line.zh ? wrapText(String(line.zh), textW, zhSize, 2) : [];
      const blockH =
        en.length * Math.round(enSize * 1.26) +
        (zh.length ? zh.length * Math.round(zhSize * 1.3) + 10 : 0);
      const textY = yy + Math.max(32, Math.round((rowH - blockH) / 2));
      const tx = center ? x + w / 2 : x + 72;
      const anchor = center ? 'middle' : 'start';
      const badgeX = center ? x + 36 : x + 28;
      return `
        <circle cx="${badgeX}" cy="${textY - 10}" r="24" fill="${color}"/>
        <text x="${badgeX}" y="${textY - 1}" text-anchor="middle" fill="${C.white}" font-size="22" font-weight="700" font-family="${FONT}">${esc(label)}</text>
        ${texts(en, tx, textY, { size: enSize, fill: C.text, weight: 700, lh: Math.round(enSize * 1.26), anchor })}
        ${
          zh.length
            ? texts(zh, tx, textY + en.length * Math.round(enSize * 1.26) + 12, {
                size: zhSize,
                fill: C.muted,
                weight: 650,
                lh: Math.round(zhSize * 1.3),
                anchor,
              })
            : ''
        }
      `;
    })
    .join('');
}

function trapLabels(scene) {
  const lines = [
    ...(scene?.wrong?.lines || []),
    ...(scene?.right?.lines || []),
  ];
  const dialogue = lines.some((l) => l?.speaker);
  return dialogue
    ? { bad: '错误排法', good: '正确排法' }
    : { bad: '错误用法', good: '正确用法' };
}

function whyBox(x, y, w, h, fill, textFill, why) {
  const lines = wrapText(why || '', w - 48, 28, 3);
  if (!lines.length) return '';
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}"/>
    ${texts(lines, x + 24, y + 48, { size: 28, fill: textFill, weight: 700, lh: 38 })}
  `;
}

function renderTrap(scene) {
  const title = String(scene.title || '小心陷阱');
  const wrong = scene.wrong || {};
  const right = scene.right || {};
  const labels = trapLabels(scene);
  const colW = 860;
  const colY = 140;
  const colH = 900;
  const hasWhy = Boolean(String(wrong.why || '').trim() || String(right.why || '').trim());
  const whyH = hasWhy ? 150 : 0;
  const bodyY = colY + 88;
  const bodyH = colH - 88 - whyH - 24;
  const whyY = colY + colH - whyH - 16;
  return shell(
    C.bg,
    `
    ${pill(960, 24, title, C.danger, { fontSize: 40, h: 82 })}
    <rect x="60" y="${colY}" width="${colW}" height="${colH}" rx="28" fill="#FFF5F5" filter="url(#sh)"/>
    <text x="${60 + colW / 2}" y="${colY + 58}" text-anchor="middle" fill="${C.danger}" font-size="38" font-weight="700" font-family="${FONT}">${esc(labels.bad)}</text>
    ${miniLines(wrong.lines, 88, bodyY, colW - 56, bodyH, { badge: C.danger })}
    ${whyBox(88, whyY, colW - 56, whyH - 16, '#FADBD8', C.danger, wrong.why)}

    <rect x="1000" y="${colY}" width="${colW}" height="${colH}" rx="28" fill="#F0FFF4" filter="url(#sh)"/>
    <text x="${1000 + colW / 2}" y="${colY + 58}" text-anchor="middle" fill="${C.success}" font-size="38" font-weight="700" font-family="${FONT}">${esc(labels.good)}</text>
    ${miniLines(right.lines, 1028, bodyY, colW - 56, bodyH, { badge: C.success })}
    ${whyBox(1028, whyY, colW - 56, whyH - 16, '#D5F5E3', '#1E8449', right.why)}
    `,
  );
}

function renderAnswer(scene) {
  const title = String(scene.title || '完整答案');
  const lines = Array.isArray(scene.lines) ? scene.lines.slice(0, 8) : [];
  const badge = String(scene.badge || '');
  const n = Math.max(1, lines.length);
  const dialogue = lines.some((l) => l.speaker);
  const grid = !dialogue && n >= 3 && n <= 4;
  const top = 150;
  const bottom = badge ? 130 : 56;
  const boxH = CANVAS_H - top - bottom + 20;

  let rows;
  if (grid) {
    const cellW = 820;
    const cellH = Math.floor((boxH - 64) / 2);
    const gapX = 36;
    const originX = 120;
    const originY = top + 20;
    rows = lines
      .map((line, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = originX + col * (cellW + gapX);
        const y = originY + row * (cellH + 20);
        const color = speakerColor(line.speaker);
        const enSize = 38;
        const zhSize = 28;
        const en = wrapText(line.en || line.zh || '', cellW - 72, enSize, 3);
        const zh = line.en && line.zh ? wrapText(String(line.zh), cellW - 72, zhSize, 2) : [];
        const blockH =
          24 + en.length * Math.round(enSize * 1.28) + (zh.length ? zh.length * 38 + 10 : 0);
        const textY = y + Math.max(56, Math.round((cellH - blockH) / 2) + 20);
        return `
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="24" fill="#F8FBFF"/>
          <circle cx="${x + 48}" cy="${textY - 10}" r="28" fill="${color}"/>
          <text x="${x + 48}" y="${textY}" text-anchor="middle" fill="${C.white}" font-size="24" font-weight="700" font-family="${FONT}">${esc(String(line.n || i + 1))}</text>
          ${texts(en, x + 92, textY, { size: enSize, fill: C.text, weight: 700, lh: Math.round(enSize * 1.28) })}
          ${
            zh.length
              ? texts(zh, x + 92, textY + en.length * Math.round(enSize * 1.28) + 14, {
                  size: zhSize,
                  fill: C.muted,
                  weight: 650,
                  lh: 38,
                })
              : ''
          }
        `;
      })
      .join('');
  } else {
    const rowH = Math.floor((boxH - 36) / n);
    const enSize = scaleForCount(n, 42, 36, 30, 28);
    const zhSize = Math.round(enSize * 0.72);
    rows = lines
      .map((line, i) => {
        const y = top + 18 + i * rowH;
        const color = speakerColor(line.speaker);
        const head = line.speaker ? `${line.speaker}: ` : '';
        const main = wrapText(`${head}${line.en || line.zh || ''}`, 1580, enSize, 2);
        const sub =
          line.en && line.zh ? wrapText(String(line.zh), 1580, zhSize, 2) : [];
        const blockH =
          main.length * Math.round(enSize * 1.24) +
          (sub.length ? sub.length * Math.round(zhSize * 1.26) + 6 : 0);
        const textY = y + Math.max(26, Math.round((rowH - blockH) / 2));
        return `
          <circle cx="168" cy="${textY - 10}" r="26" fill="${color}"/>
          <text x="168" y="${textY - 1}" text-anchor="middle" fill="${C.white}" font-size="22" font-weight="700" font-family="${FONT}">${esc(String(line.n || i + 1))}</text>
          ${texts(main, 214, textY, { size: enSize, fill: C.text, weight: 700, lh: Math.round(enSize * 1.24) })}
          ${
            sub.length
              ? texts(sub, 214, textY + main.length * Math.round(enSize * 1.24) + 8, {
                  size: zhSize,
                  fill: C.muted,
                  weight: 650,
                  lh: Math.round(zhSize * 1.26),
                })
              : ''
          }
        `;
      })
      .join('');
  }
  const footer = badge
    ? `<rect x="80" y="960" width="1760" height="88" rx="20" fill="#FFF6E0"/>
       ${texts(wrapText(badge, 1660, 30, 2), 960, 1016, { size: 30, fill: C.accent, weight: 700, anchor: 'middle' })}`
    : '';
  return shell(
    C.bg,
    `
    ${sparkles('#F5C542')}
    ${pill(960, 24, title, C.accent, { fontSize: 40, h: 82 })}
    <rect x="80" y="128" width="1760" height="${boxH}" rx="32" fill="${C.card}" stroke="${C.primary}" stroke-width="4" filter="url(#sh)"/>
    ${rows}
    ${footer}
    `,
  );
}

function renderEnding(scene) {
  const title = String(scene.title || '你学会了吗？');
  const mnemonic = String(scene.mnemonic || scene.subtitle || '');
  const bye = String(scene.bye || '下一题见');
  const titleSize = 84;
  const mSize = 50;
  const mLines = wrapText(mnemonic, 1480, mSize, 4);
  const boxH = Math.max(220, 88 + mLines.length * Math.round(mSize * 1.4));
  const subBlockH = (mLines.length - 1) * Math.round(mSize * 1.4);
  return shell(
    C.success,
    `
    ${sparkles('#FFF3A0')}
    ${texts(wrapText(title, 1680, titleSize, 2), 960, 260, { size: titleSize, fill: C.white, weight: 700, anchor: 'middle', lh: 100 })}
    <rect x="120" y="390" width="1680" height="${boxH}" rx="48" fill="rgba(255,255,255,0.22)"/>
    ${texts(mLines, 960, 390 + Math.round(boxH / 2) - subBlockH / 2 + 12, { size: mSize, fill: C.white, weight: 700, anchor: 'middle', lh: Math.round(mSize * 1.4) })}
    ${texts([bye], 960, 900, { size: 40, fill: 'rgba(255,255,255,0.95)', weight: 650, anchor: 'middle' })}
    `,
  );
}

function renderCards(scene) {
  const title = String(scene.title || scene.step_title || '讲解');
  const body = String(scene.body || scene.tip || '');
  const bodyLines = wrapText(body, 1600, 44, 8);
  return shell(
    C.bg,
    `
    ${pill(960, 28, title, C.primary, { fontSize: 40, h: 82 })}
    <rect x="80" y="140" width="1760" height="880" rx="32" fill="${C.card}" filter="url(#sh)"/>
    ${texts(bodyLines, 140, 280, { size: 44, fill: C.text, weight: 650, lh: 64 })}
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
