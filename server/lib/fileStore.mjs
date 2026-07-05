import { genId } from './ids.mjs';

const TTL_MS = Number(process.env.QWEN_FILE_TTL_MS || 3_600_000);
const store = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, meta] of store) {
    if (now - meta.createdAt > TTL_MS) store.delete(id);
  }
}, 60_000).unref?.();

/**
 * @param {Buffer} buffer
 * @param {{ originalname?: string, mimetype?: string }} file
 */
export function saveFile(buffer, file = {}) {
  const id = genId();
  store.set(id, {
    buffer,
    filename: file.originalname || 'audio.wav',
    mimetype: file.mimetype || 'application/octet-stream',
    createdAt: Date.now(),
  });
  return id;
}

export function getFile(fileId) {
  return store.get(fileId) || null;
}

export function detectAudioFormat(filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase() || 'wav';
  const map = {
    wav: 'wav',
    mp3: 'mp3',
    m4a: 'aac',
    aac: 'aac',
    ogg: 'ogg',
    opus: 'ogg',
    amr: 'amr',
    '3gp': '3gp',
    '3gpp': '3gpp',
  };
  return map[ext] || ext;
}
