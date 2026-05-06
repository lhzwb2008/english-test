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

## Prompt 约定

- **输出**：各 Bot 只输出 **一份可解析的 JSON**，便于前后端落库。
- **学习计划**：业务侧在**一条文本消息**中携带 `curriculum`、`task_pool`（对齐根目录四套陪跑表案例的行式课节）、`student_profile`（见 [`docs/API.md`](docs/API.md)）；**不传学习日个数**，由模型按 `task_pool` 条目数自动生成 `days[]` 与 **`day_index`**（day1、day2…）；**公历日期由后端挂载**。
- **图片批改**：`object_string` 的 `text` 中可携带单元/题号、**阅读 passage**（若图小或未印全文）、标答与作文量表等（见 `docs/API.md`）；输出**全中文**面向家长/学生。
- **口语批改**：`text` 中可携带题型说明、参考句；输出含**五维**评分 + 总评（见 `docs/API.md`）。

参考课程计划实例（任务库形态）：仓库根目录 `Think1 完整版…xlsx`、`THINK2…xls`、`Power Up2…xls`、`Power Up3…xls`。

### 模型

你在控制台把各 Bot 统一改成 **Doubao 2.0** 即可；本仓库**不绑定**模型 ID，以扣子配置为准。

## 本地维护

1. 复制 `.env.example` 为 `.env`，填入 `COZE_API_TOKEN`（勿提交）。
2. 编辑 `coze/prompts/*.md` 后，可执行（需 `.env` 中 `COZE_API_TOKEN`）：`npm run coze:push-plan` / `coze:push-oral` / `coze:push-image`，自动 `bots.update` 并发布 API 渠道 `1024`。

```bash
npm install
npm run coze:spaces    # 查看空间 ID
# npm run coze:create  # 仅首次需要；会新建 Bot，勿重复
```

`npm run test:e2e` / `test:smoke` 为**可选**的 API 冒烟脚本：会真实调模型，**耗时长**，日常开发不必跑。

## 后端接入

见 **`docs/API.md`**（鉴权、三个 `bot_id`、入参与 stream 要求）。  
本轮 Prompt/契约变更的**对照清单**见 **`docs/REVIEW-prompt-changes.md`**（Review 用）。

## 目录

- `docs/API.md` — **后端接入简版 API 说明**
- `docs/manual-test-cases.md` — **控制台手动测试用例**（THINK1 素材）
- `coze/prompts/` — 智能体人设与输出 JSON 约定（可版本维护）
- `coze/bots.registry.json` — 创建后写入的 `bot_id` 登记
- `scripts/` — 创建、空间列表、`quick-verify.mjs` 快速自检
- `THINK1/` — 学生样例、作业布置表、图片/音频调试样例（上下文）
