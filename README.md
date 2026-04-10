# 英语学习 × Coze（一期 MVP）

本仓库维护三类智能体的 **Prompt 文本**、**创建脚本**与 **THINK1 业务上下文样例**。题库解析不在本期范围。

## 扣子控制台中的位置

- **团队空间**：「共享空间」（`space_id` 见 `coze/bots.registry.json`）
- 控制台里的「英语学习」**文件夹**仅为 UI 分类；OpenAPI 创建的智能体出现在该空间列表中，可在界面中**手动拖入**对应文件夹。

## 已创建智能体（OpenAPI）

| 名称 | `bot_id` | Prompt 文件 |
|------|-----------|-------------|
| 英语学习-计划生成 | 见 `coze/bots.registry.json` | `coze/prompts/learning-plan.md` |
| 英语学习-图片批改 | 同上 | `coze/prompts/image-homework.md` |
| 英语学习-口语批改 | 同上 | `coze/prompts/oral-homework.md` |

脚本已为上述智能体尝试 **发布到 API 渠道**（connector `1024`）。业务侧使用 Chat API 时需带 `Authorization: Bearer <COZE_API_TOKEN>`。

## 工作流说明

- **工作流（可视化）**：当前 SDK **不支持**通过 API 创建画布工作流；若需要多节点编排，请在扣子内新建工作流，再把 `workflow_id` 绑到智能体。
- 本期三个能力以 **单智能体 + 强 JSON 提示词** 交付，足够 MVP 调试。

## 本地维护

1. 复制 `.env.example` 为 `.env`，填入 `COZE_API_TOKEN`（勿提交）。
2. 编辑 `coze/prompts/*.md` 后，可在控制台手动同步到智能体，或重新执行创建脚本（会**新建** bot；更新已有 bot 需后续扩展 `bots.update` 脚本）。

```bash
npm install
npm run coze:spaces    # 查看空间 ID
npm run coze:create    # 在 COZE_SPACE_ID 对应空间创建（默认共享空间）；会新建 3 个 Bot，勿重复执行
npm run test:smoke     # 联调 Chat API（可能需等待 1～2 分钟）
```

重复执行 `coze:create` 会再创建三套智能体。若仅需更新 Prompt，请改 `coze/prompts/*.md` 后在扣子控制台粘贴，或后续自行扩展 `client.bots.update` 脚本。

## 目录

- `coze/prompts/` — 智能体人设与输出 JSON 约定（可版本维护）
- `coze/bots.registry.json` — 创建后写入的 `bot_id` 登记
- `scripts/` — 创建与空间列表
- `THINK1/` — 学生样例、作业布置表、图片/音频调试样例（上下文）
