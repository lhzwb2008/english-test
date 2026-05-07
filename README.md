# 英语学习 × Coze（一期 MVP）

本仓库维护三类智能体的 **Prompt 文本** 与 **创建/推送脚本**。题库解析不在本期范围。

## 扣子控制台中的位置

- **团队空间**：「共享空间」（`space_id` 见 `coze/bots.registry.json`）
- 控制台里的「英语学习」**文件夹**仅为 UI 分类；OpenAPI 创建的智能体出现在该空间列表中，可在界面中**手动拖入**对应文件夹。

## 已创建智能体（OpenAPI）

| 名称 | `bot_id` | Prompt 文件 |
|------|-----------|-------------|
| 英语学习-计划生成 | 见 `coze/bots.registry.json` | `learning-plan-head.md` + `builtin-tasks-from-excels.md` → **`learning-plan.md`**（`npm run coze:build-plan`） |
| 英语学习-图片批改 | 同上 | `coze/prompts/image-homework.md` |
| 英语学习-口语批改 | 同上 | `coze/prompts/oral-homework.md` |

脚本已为上述智能体尝试 **发布到 API 渠道**（connector `1024`）。业务侧使用 Chat API 时需带 `Authorization: Bearer <COZE_API_TOKEN>`。

## 工作流说明

- **工作流（可视化）**：当前 SDK **不支持**通过 API 创建画布工作流；若需要多节点编排，请在扣子内新建工作流，再把 `workflow_id` 绑到智能体。
- 本期三个能力以 **单智能体 + 强 JSON 提示词** 交付，足够 MVP 调试。

## Prompt 约定

- **输出**：各 Bot 只输出 **一份可解析的 JSON**，便于前后端落库。
- **学习计划**：业务侧在**一条文本消息**里写清 **`student_profile`**（体系、进度、每日时长、目标），**不必**再传 `curriculum` 或 `task_pool`；四套陪跑表的**原子课节（共 360+ 条 lesson_code）**已编入 Prompt（`coze/prompts/builtin-tasks-from-excels.md` 由 `ref/*.xlsx` / `*.xls` 导出后合并进 `learning-plan.md`）。可选 **`start_date` / `period_hint`**：给了 `start_date` 模型按"日期模式"输出 `days[].date`；未给则按"序号模式"仅输出 `day_index`；未给 `period_hint` 默认 14 天。`lesson_code` 必为内置库中某条 `####` 标题原文（如 `U1-L1-Reading1`）。详情见 [`API.md`](API.md)。
- **图片批改**：业务侧**只**传 `text`（一句调用提示如『请仅输出 JSON』）+ `image` + `file_id`，**不**再传 `answer_key` / 教材单元 / 阅读 passage / 作文 rubric——这些是题库/知识库职责。当前为**无题库**版本：模型基于图片 OCR + 通用语言知识；阅读理解题在**图中未印 passage** 时会把 `standard_answer` 留空（`""`），并在 `limitations` 写明『无题库无法核对标答』；接入知识库 RAG 后由 `original_question` / `standard_answer` 字段回填，**业务对接 schema 不变**。
- **口语批改**：`text` 中可携带题型说明、参考句；输出含**五维**评分 + 总评 + `language.grammar_issues`（结构化中文问题/改法）。

参考课程计划源表放在仓库 `ref/`（与 `scripts/export-builtin-from-excels.py` 路径一致），导出后更新 **`coze/prompts/builtin-tasks-from-excels.md`**，再执行 `npm run coze:build-plan` 合并为 `learning-plan.md`。

### 模型

你在控制台把各 Bot 统一改成 **Doubao 2.0** 即可；本仓库**不绑定**模型 ID，以扣子配置为准。

## 本地维护

1. 复制 `.env.example` 为 `.env`，填入 `COZE_API_TOKEN`（勿提交）。
2. **计划 Prompt 合并**：人设与规则在 `coze/prompts/learning-plan-head.md`，任务库在 `coze/prompts/builtin-tasks-from-excels.md`。执行 `npm run coze:build-plan` 生成最终 `coze/prompts/learning-plan.md`。若手边有更新后的陪跑表放入 `ref/` 并装好 Python 依赖（`xlrd`、`openpyxl`），可先 `npm run coze:export-builtin` 再 build。
3. 编辑完成后可执行（需 `.env` 中 `COZE_API_TOKEN`）：`npm run coze:push-plan` / `coze:push-oral` / `coze:push-image`（`push-plan` 会先 **build-plan** 再 `bots.update` 并发布 API 渠道 `1024`）。

```bash
npm install
npm run coze:spaces    # 查看空间 ID
# npm run coze:create  # 仅首次需要；会新建 Bot，勿重复
```

## 后端接入

见 **`API.md`**（鉴权、三个 `bot_id`、入参与 stream 要求）。

## 目录

- `API.md` — **后端接入简版 API 说明**
- `coze/prompts/learning-plan-head.md` — 计划 Bot 人设与编排规则（与内置库合并后发布）
- `coze/prompts/builtin-tasks-from-excels.md` — 四体系任务库（Excel 导出）
- `coze/prompts/learning-plan.md` — **合并产物**（`npm run coze:build-plan`），勿手改；推送前由脚本生成
- `coze/prompts/image-homework.md` / `oral-homework.md` — 图片 / 口语 Bot Prompt
- `coze/bots.registry.json` — 创建后写入的 `bot_id` 登记
- `scripts/` — 创建、空间列表、Prompt 推送脚本
- `ref/` — 参考课程计划源表（Excel）
