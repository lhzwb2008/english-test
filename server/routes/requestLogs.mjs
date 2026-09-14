/**
 * 图片批改等直连 Coze 的请求，业务侧可把 text + 图 + 模型 JSON 副本 POST 到这里，
 * 与口语代理共用按日 JSONL / 媒体抽样。
 */
import { Router } from 'express';
import multer from 'multer';
import { writeHomeworkSample } from '../lib/requestLog.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.REQUEST_LOG_MAX_MEDIA_BYTES || 15 * 1024 * 1024) },
});

const router = Router();

function parseAnswer(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

router.post('/ingest', upload.array('file', 8), (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const files = (req.files || []).map((f, i) => ({
    filename: f.originalname || `upload_${i}${f.mimetype === 'image/png' ? '.png' : '.jpg'}`,
    buffer: f.buffer,
  }));
  const logged = writeHomeworkSample({
    kind: body.kind || 'image_homework',
    bot_id: body.bot_id || '',
    user_text: body.user_text || body.text || '',
    answer: parseAnswer(body.answer),
    files,
  });
  return res.json({ code: 0, msg: '', data: logged });
});

export default router;
