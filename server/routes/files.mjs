import { Router } from 'express';
import multer from 'multer';
import { saveFile } from '../lib/fileStore.mjs';
import { nowUnix } from '../lib/ids.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.QWEN_MAX_FILE_BYTES || 100 * 1024 * 1024) },
});

const router = Router();

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file?.buffer?.length) {
    return res.status(400).json({
      code: 4000,
      msg: '缺少 multipart 字段 file',
    });
  }

  const id = saveFile(req.file.buffer, {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
  });
  const createdAt = nowUnix();

  return res.json({
    code: 0,
    msg: '',
    data: {
      id,
      bytes: req.file.buffer.length,
      created_at: createdAt,
      file_name: req.file.originalname || 'audio.wav',
    },
  });
});

export default router;
