# Coze Prompt Lab

本地维护多个 Coze 智能体的 Prompt 文案（Markdown），并通过开放平台 Chat API 按 `bot_id` 发消息调试。

## 准备

1. 在 [Coze 扣子](https://www.coze.cn) 创建智能体，**发布为 API 服务**，记下 **Bot ID**。
2. 在开放平台获取 **访问令牌**（PAT 或你提供的 Service Token），写入根目录 `.env` 中的 `COZE_API_TOKEN`（勿提交 Git；可参考 `.env.example`）。

## 使用

```bash
npm install
npm run dev
```

- 浏览器打开 Vite 提示的地址（一般为 `http://127.0.0.1:5173`）。
- **登记** `bot_id`，在右侧编辑并**保存**本地 Prompt 副本（`prompts/<bot_id>.md`），在控制台与线上人设保持同步仍由你手动完成（后续可接 Bot 更新 API）。
- **调试对话**会向 `POST /api/debug/chat` 转发到 Coze `chat.createAndPoll`。

## 目录

- `server/` — Express API（Coze SDK、读写 `prompts/`）。
- `prompts/registry.json` — 已登记的智能体列表。
- `prompts/*.md` — 各智能体 Prompt 本地副本。

## 环境变量

| 变量 | 说明 |
|------|------|
| `COZE_API_TOKEN` | 必填，开放平台令牌 |
| `COZE_BASE_URL` | 默认 `https://api.coze.cn` |
| `COZE_DEBUG_USER_ID` | 调试时的 `user_id` |
| `PORT` | API 端口，默认 `3847` |
