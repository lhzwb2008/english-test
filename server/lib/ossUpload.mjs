/**
 * 阿里云 OSS 上传（正式 Bucket，供终端播放）
 * 成片对象为 public-read，返回不带签名的固定 URL，可反复播放。
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

/**
 * 固定播放地址，不带 Expires / Signature。
 * @param {string} key
 * @returns {{ url: string, expires_at: null }}
 */
export function buildObjectUrl(key) {
  const clean = String(key || '').replace(/^\/+/, '');
  const bucket = required('OSS_BUCKET');
  const ep = (
    process.env.OSS_PUBLIC_ENDPOINT ||
    'oss-cn-shanghai.aliyuncs.com'
  ).replace(/^https?:\/\//, '');
  return { url: `https://${bucket}.${ep}/${clean}`, expires_at: null };
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
      'x-oss-object-acl': 'public-read',
    },
  });
  await client.putACL(key, 'public-read');
  const built = buildObjectUrl(key);
  return { key, ...built };
}

/**
 * @param {string} jobId
 * @param {string} localMp4
 */
export async function uploadGrammarVideo(jobId, localMp4) {
  const prefix = objectPrefix();
  const key = `${prefix}/homework-video/${jobId}.mp4`;
  return uploadFileToOss(localMp4, key);
}
