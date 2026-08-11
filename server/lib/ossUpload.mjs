/**
 * 阿里云 OSS 上传（正式 Bucket，供终端播放）
 * Bucket 私有时用签名 URL；查询接口可按 oss_key 刷新签名。
 */
import fs from 'node:fs';
import OSS from 'ali-oss';

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return String(v).trim();
}

export function ossConfigured() {
  return Boolean(
    process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET &&
      process.env.OSS_BUCKET,
  );
}

function createClient() {
  const regionRaw = process.env.OSS_REGION || 'oss-cn-shanghai';
  const region = regionRaw.startsWith('oss-') ? regionRaw : `oss-${regionRaw}`;
  const endpoint = process.env.OSS_ENDPOINT
    ? process.env.OSS_ENDPOINT.replace(/^https?:\/\//, '')
    : undefined;

  /** @type {ConstructorParameters<typeof OSS>[0]} */
  const opts = {
    accessKeyId: required('OSS_ACCESS_KEY_ID'),
    accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
    bucket: required('OSS_BUCKET'),
    region,
    secure: true,
    timeout: Number(process.env.OSS_TIMEOUT_MS || 120000),
  };
  if (endpoint) {
    opts.endpoint = endpoint;
    opts.cname = process.env.OSS_ENDPOINT_CNAME === '1';
  }
  return new OSS(opts);
}

function objectPrefix() {
  return (process.env.OSS_PREFIX || 'wenbo').replace(/^\/+|\/+$/g, '');
}

function urlMode() {
  return (process.env.OSS_URL_MODE || 'signed').toLowerCase();
}

function signedSeconds() {
  const n = Number(process.env.OSS_SIGNED_URL_SECONDS || 7 * 24 * 3600);
  return Number.isFinite(n) && n > 60 ? Math.floor(n) : 7 * 24 * 3600;
}

/**
 * @param {string} key
 * @returns {{ url: string, expires_at: string | null }}
 */
export function buildObjectUrl(key) {
  const client = createClient();
  const mode = urlMode();
  if (mode === 'public') {
    const publicBase = (process.env.OSS_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (publicBase) {
      return { url: `${publicBase}/${key}`, expires_at: null };
    }
    const bucket = required('OSS_BUCKET');
    const ep = (
      process.env.OSS_PUBLIC_ENDPOINT ||
      'oss-cn-shanghai.aliyuncs.com'
    ).replace(/^https?:\/\//, '');
    return { url: `https://${bucket}.${ep}/${key}`, expires_at: null };
  }

  const seconds = signedSeconds();
  const url = client.signatureUrl(key, {
    expires: seconds,
  });
  return {
    url,
    expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
  };
}

/**
 * @param {string} localPath
 * @param {string} objectKey
 * @returns {Promise<{ key: string, url: string, expires_at: string | null }>}
 */
export async function uploadFileToOss(localPath, objectKey) {
  if (!fs.existsSync(localPath)) {
    throw new Error(`本地文件不存在: ${localPath}`);
  }
  const client = createClient();
  const key = objectKey.replace(/^\/+/, '');
  await client.put(key, localPath, {
    headers: {
      'Content-Type':
        key.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream',
      'Content-Disposition': 'inline',
    },
  });
  const built = buildObjectUrl(key);
  return { key, ...built };
}

/**
 * @param {string} jobId
 * @param {string} localMp4
 */
export async function uploadGrammarVideo(jobId, localMp4) {
  const prefix = objectPrefix();
  const key = `${prefix}/grammar-video/${jobId}.mp4`;
  return uploadFileToOss(localMp4, key);
}
