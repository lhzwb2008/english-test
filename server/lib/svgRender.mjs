/**
 * SVG → PNG（模板画面，保证中英文与题面一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const FONT_CANDIDATES = [
  process.env.GRAMMAR_VIDEO_FONT,
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
].filter(Boolean);

let cachedFont = undefined;

export function findFontFile() {
  if (cachedFont !== undefined) return cachedFont;
  for (const f of FONT_CANDIDATES) {
    if (f && fs.existsSync(f)) {
      cachedFont = f;
      return f;
    }
  }
  cachedFont = null;
  return null;
}

/**
 * @param {string} svg
 * @param {string} outPath
 * @param {{ width?: number }} [opts]
 */
export function renderSvgToPng(svg, outPath, opts = {}) {
  const width = opts.width || 1920;
  const fontFile = findFontFile();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: fontFile ? [fontFile] : [],
      loadSystemFonts: true,
      defaultFontFamily: fontFile?.includes('PingFang')
        ? 'PingFang SC'
        : fontFile?.includes('wqy')
          ? 'WenQuanYi Micro Hei'
          : 'sans-serif',
    },
  });
  const png = resvg.render().asPng();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  return outPath;
}
