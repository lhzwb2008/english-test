/**
 * 百炼临时存储上传（返回 oss://，仅模型侧可用，不可给浏览器直接播放）。
 * 成片对外 URL 由本服务 48h 文件接口提供；此处保留以便后续接模型流水线。
 */
import fs from 'node:fs';
import path from 'node:path';

function apiKey() {
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error('缺少 DASHSCOPE_API_KEY');
  return key;
}

function dashscopeRoot() {
  const raw = (
    process.env.DASHSCOPE_API_ROOT ||
    process.env.DASHSCOPE_BASE_URL ||
    'https://dashscope.aliyuncs.com'
  ).replace(/\/$/, '');
  for (const suffix of ['/compatible-mode/v1', '/compatible-mode', '/api/v1']) {
    if (raw.endsWith(suffix)) return raw.slice(0, -suffix.length);
  }
  return raw;
}

/**
 * @param {string} modelName 绑定模型名（上传与后续调用须一致）
 * @returns {Promise<Record<string, string>>}
 */
async function getUploadPolicy(modelName) {
  const url = new URL(`${dashscopeRoot()}/api/v1/uploads`);
  url.searchParams.set('action', 'getPolicy');
  url.searchParams.set('model', modelName);
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
  });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`获取上传凭证失败 HTTP ${resp.status}: ${raw.slice(0, 400)}`);
  }
  const data = JSON.parse(raw)?.data;
  if (!data?.upload_host) throw new Error(`上传凭证无效: ${raw.slice(0, 300)}`);
  return data;
}

/**
 * @param {string} filePath
 * @param {string} [modelName]
 * @returns {Promise<{ oss_url: string, expires_at: string }>}
 */
export async function uploadTempFile(filePath, modelName) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const model = modelName || process.env.DASHSCOPE_UPLOAD_MODEL || 'qwen-vl-plus';
  const policy = await getUploadPolicy(model);
  const fileName = path.basename(filePath);
  const key = `${policy.upload_dir}/${fileName}`;

  const form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id);
  form.append('Signature', policy.signature);
  form.append('policy', policy.policy);
  form.append('x-oss-object-acl', policy.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.append('key', key);
  form.append('success_action_status', '200');
  const blob = new Blob([fs.readFileSync(filePath)]);
  form.append('file', blob, fileName);

  const up = await fetch(policy.upload_host, { method: 'POST', body: form });
  if (!up.ok) {
    const t = await up.text();
    throw new Error(`临时上传失败 HTTP ${up.status}: ${t.slice(0, 400)}`);
  }

  const expires = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  return { oss_url: `oss://${key}`, expires_at: expires };
}
