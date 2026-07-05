import { randomBytes } from 'node:crypto';

/** 生成类似 Coze 的数字 ID 字符串 */
export function genId(prefix = '') {
  const n = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return `${prefix}${n.toString()}`;
}

export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}
