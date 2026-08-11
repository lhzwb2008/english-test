/**
 * 简化竖屏口播合成：上图 + 底部字幕，按页 concat。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const IMAGE_H = 1500;

function ffmpegBin() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function ffprobeBin() {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

export function assertFfmpeg() {
  const r = spawnSync(ffmpegBin(), ['-version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error('未找到 ffmpeg，请在服务器安装 ffmpeg 并确保在 PATH 中');
  }
}

/**
 * @param {string} mediaPath
 * @returns {number}
 */
export function probeDuration(mediaPath) {
  const r = spawnSync(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mediaPath,
    ],
    { encoding: 'utf8' },
  );
  const d = Number(String(r.stdout || '').trim());
  if (!Number.isFinite(d) || d <= 0) return 3;
  return d;
}

function findFont() {
  const candidates = [
    process.env.GRAMMAR_VIDEO_FONT,
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
  ].filter(Boolean);
  for (const f of candidates) {
    if (f && fs.existsSync(f)) return f;
  }
  return null;
}

function escapeDrawtext(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
    .slice(0, 80);
}

function wrapSubtitle(text, maxChars = 18) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const lines = [];
  let buf = '';
  for (const ch of t) {
    buf += ch;
    if (buf.length >= maxChars && /[，。！？；、,.!?;\s]/.test(ch)) {
      lines.push(buf.trim());
      buf = '';
    }
    if (lines.length >= 2) break;
  }
  if (buf.trim() && lines.length < 2) lines.push(buf.trim());
  return lines.join('\n');
}

/**
 * @param {{ imagePath: string, audioPath: string, subtitle: string, outPath: string }} slide
 */
function renderSlide(slide) {
  const dur = probeDuration(slide.audioPath) + 0.25;
  const font = findFont();
  const sub = wrapSubtitle(slide.subtitle);
  const filters = [
    `scale=${CANVAS_W}:${IMAGE_H}:force_original_aspect_ratio=decrease`,
    `pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:60:color=0xFBF6E4`,
  ];
  if (sub && font) {
    const escapedFont = font.replace(/\\/g, '/').replace(/:/g, '\\:');
    const text = escapeDrawtext(sub.replace(/\n/g, ' '));
    filters.push(
      `drawtext=fontfile='${escapedFont}':text='${text}':fontsize=48:fontcolor=0x282828:borderw=2:bordercolor=white:x=(w-text_w)/2:y=h-360:line_spacing=12`,
    );
  }

  const args = [
    '-y',
    '-loop',
    '1',
    '-i',
    slide.imagePath,
    '-i',
    slide.audioPath,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-t',
    String(dur),
    slide.outPath,
  ];
  const r = spawnSync(ffmpegBin(), args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`ffmpeg 单页合成失败: ${(r.stderr || '').slice(-800)}`);
  }
}

/**
 * @param {Array<{ imagePath: string, audioPath: string, subtitle: string }>} slides
 * @param {string} outMp4
 * @returns {string}
 */
export function composeVerticalVideo(slides, outMp4) {
  assertFfmpeg();
  if (!slides?.length) throw new Error('无分镜可合成');

  const workDir = path.dirname(outMp4);
  fs.mkdirSync(workDir, { recursive: true });
  const parts = [];
  for (let i = 0; i < slides.length; i += 1) {
    const part = path.join(workDir, `part_${String(i).padStart(2, '0')}.mp4`);
    renderSlide({ ...slides[i], outPath: part });
    parts.push(part);
  }

  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(
    listFile,
    parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
  );

  const r = spawnSync(
    ffmpegBin(),
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-c',
      'copy',
      outMp4,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg concat 失败: ${(r.stderr || '').slice(-800)}`);
  }
  return outMp4;
}
