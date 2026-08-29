/**
 * 横屏静图 + 口播拼接（画面文字已在 PNG 上，不再叠字幕）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

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
  if (!Number.isFinite(d) || d <= 0) return 1;
  return d;
}

/**
 * @param {number} seconds
 * @param {string} outPath
 */
export function writeSilence(seconds, outPath) {
  const t = Math.max(0.05, Number(seconds) || 0.18);
  const r = spawnSync(
    ffmpegBin(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      String(t),
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      outPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg 静音失败: ${(r.stderr || '').slice(-400)}`);
  }
  return outPath;
}

/**
 * @param {string[]} files
 * @param {string} outPath
 */
export function concatAudioFiles(files, outPath) {
  if (!files?.length) throw new Error('无音频可拼接');
  const listFile = `${outPath}.concat.txt`;
  fs.writeFileSync(
    listFile,
    files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
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
      '-c:a',
      'libmp3lame',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      '128k',
      outPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg 音频拼接失败: ${(r.stderr || '').slice(-800)}`);
  }
  return outPath;
}

function renderSlide(slide) {
  const dur = Math.max(
    probeDuration(slide.audioPath),
    Number(slide.minDuration) || 0,
  );
  const args = [
    '-y',
    '-loop',
    '1',
    '-i',
    slide.imagePath,
    '-i',
    slide.audioPath,
    '-vf',
    `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${CANVAS_H}:(ow-iw)/2:(oh-ih)/2:color=0xF7FAFF`,
    '-c:v',
    'libx264',
    '-tune',
    'stillimage',
    '-pix_fmt',
    'yuv420p',
    '-af',
    `apad=whole_dur=${dur.toFixed(3)}`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-t',
    String(Math.max(0.4, dur)),
    slide.outPath,
  ];
  const r = spawnSync(ffmpegBin(), args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`ffmpeg 单页合成失败: ${(r.stderr || '').slice(-800)}`);
  }
}

/**
 * @param {Array<{ imagePath: string, audioPath: string }>} slides
 * @param {string} outMp4
 * @returns {string}
 */
export function composeSlideshow(slides, outMp4) {
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
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outMp4],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg concat 失败: ${(r.stderr || '').slice(-800)}`);
  }
  return outMp4;
}
