import { CozeAPI } from '@coze/api';

let singleton;

/**
 * @param {{ token: string, baseURL: string }} config
 */
export function getCozeClient(config) {
  if (!config.token) {
    throw new Error('缺少 COZE_API_TOKEN，请在 .env 中配置');
  }
  if (!singleton) {
    singleton = new CozeAPI({
      token: config.token,
      baseURL: config.baseURL,
    });
  }
  return singleton;
}
