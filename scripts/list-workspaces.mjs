import 'dotenv/config';
import { CozeAPI } from '@coze/api';

const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: process.env.COZE_BASE_URL || 'https://api.coze.cn',
});

const r = await client.workspaces.list({ page_num: 1, page_size: 50 });
for (const w of r.workspaces) {
  console.log(`${w.name}\t${w.id}\t${w.workspace_type}`);
}
