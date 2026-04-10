# Coze 三智能体 — 后端接入说明

**Base URL**：`https://api.coze.cn`  
**鉴权**：`Authorization: Bearer <COZE_API_TOKEN>`

三个智能体各自一节：**学习计划**、**作业批改（图）**、**口语评测（音）**。共享约定（上传、`object_string`、SDK、文档链接）放在文末 **附录**。

---

## 学习计划

**bot_id**：`7627028738093596712`

**调用**：`POST /v3/chat`，**`stream: false`**（可与图片批改一样用 `retrieve` + `message/list`，或使用 SDK `chat.createAndPoll`）。

**入参**：`additional_messages` 一条，`content_type: text`，`content` 为学生自然语言（年级、进度、每日时长、目标等）。任务池由业务或 Prompt 约定，按你们实际智能体配置为准。

**出参**（在 **`GET /v3/chat/message/list`** 返回中，取 **`type === "answer"`** 的 **`content`**，再 **`JSON.parse`**）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `meta.student_label` | string | 学生摘要标签 |
| `meta.horizon_weeks` | number | 规划周数 |
| `meta.assumptions` | string[] | 信息不足时的假设 |
| `weekly_plans` | array | 分周计划 |
| `weekly_plans[].week_index` | number | 第几周 |
| `weekly_plans[].focus` | string | 本周重点（英文） |
| `weekly_plans[].sessions` | array | 按天/按次 |
| `weekly_plans[].sessions[].tasks` | array | 任务列表 |
| `weekly_plans[].sessions[].tasks[].title_en` | string | 任务标题 |
| `weekly_plans[].sessions[].tasks[].detail_en` | string | 任务说明 |
| `weekly_plans[].sessions[].tasks[].source_ref` | string | 任务来源引用 |
| `weekly_plans[].sessions[].tasks[].priority` | string | `must` / `optional` |
| `review_and_adjust` | string[] | 如何复盘与调整（英文） |

---

## 作业批改（图片）

**bot_id**：`7627028840921219091`

**调用**：`POST /v3/chat`，**`stream: false`**。

**入参**：先 **`POST /v1/files/upload`** 得 **`file_id`**；用户消息里 **`content_type: object_string`**，`content` 为 JSON 数组字符串，需同时包含 **`text`**（可无说明时填空字符串）与 **`image` + `file_id`**。

**出参**（同上：取 **`answer`** 的 **`content`** → **`JSON.parse`**）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `image_summary` | string | 本页概述（英文） |
| `items` | array | 逐题 |
| `items[].id` | string | 题号或序号 |
| `items[].item_type` | string | 如 `mcq` / `fill_blank` 等 |
| `items[].student_answer` | string | 识别到的作答 |
| `items[].correct_answer` | string \| null | 标答 |
| `items[].is_correct` | boolean | 是否对 |
| `items[].confidence` | number | 可选，0～1 |
| `items[].reasoning_en` | string | 判分理由（英文） |
| `items[].reasoning_zh` | string | 理由（中文） |
| `overall_comment_en` | string | 总评 |
| `limitations` | string[] | OCR/模糊等限制 |

---

## 口语评测（音频）

**bot_id**：`7627028747031642150`

**调用**：`POST /v3/chat`，**`stream: true`**（与计划/图片不同，**必须开流**）。

**入参**：先上传音频得 **`file_id`**；**`object_string`** 中同时包含 **`text`**（可空）与 **`audio` + `file_id`**。平台对音频格式通常仅支持 **`wav` / `ogg_opus`**，其它格式需先转码。

**出参**（流结束后仍用 **`message/list`** 取 **`type === "answer"`** 的 **`content`** → **`JSON.parse`**）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `reference_text` | string \| null | 参考句；无则为 `null` |
| `transcript` | string | 英文转写 |
| `pronunciation.holistic_score_1_to_5` | number \| null | 1～5 粗分 |
| `pronunciation.holistic_note_en` | string | 发音综合说明（英文） |
| `pronunciation.mispronounced_or_weak_words` | string[] | 弱读/易错词 |
| `language.grammar_issues` | array | 语法问题列表 |
| `language.lexical_suggestions_en` | string[] | 词汇建议 |
| `coaching_tips_en` | string[] | 练习建议 |
| `limitations` | string[] | 限制说明 |

### 接入 Tips（口语专项）

- **`stream: false` 不适合带音频的多模态**：请固定使用 **`stream: true`**，否则易出现与流式协议不一致的行为。
- **先上传再对话**：`POST /v1/files/upload`，响应里的 **`id`** 即 **`file_id`**，再拼进 **`object_string`**；不要把上传得到的 **`file_id` 当成可浏览器打开的 http 链接**。
- **`object_string` 结构**：`content` 本体是**字符串**，其值为 **JSON 数组的字符串形式**（注意转义）；数组里至少要有 **`{"type":"text","text":""}`** 与 **`{"type":"audio","file_id":"..."}`**。
- **取结果**：消费 **SSE 直到结束**，用返回的 **`conversation_id`** 与 **`chat_id`**（或 SDK 事件里的等价字段）调 **`GET /v3/chat/message/list`**，在消息列表里找 **`type === "answer"`**，对 **`content`** 做 **`JSON.parse`**。若模型偶发在 JSON 外夹杂 Markdown，业务侧需容错或重试。
- **`file_id` vs 仅贴 URL**：走 OpenAPI 上传时，模型应能基于 **`file_id`** 转写；若用户**只粘贴音频 URL、没有 `file_id`**，行为与上传场景不同，**不要**与「已上传但解析失败」混为一谈。
- **推荐**：`@coze/api` 使用 **`chat.stream`** + **`chat.messages.list`**，减少手写 SSE 与轮询。

---

## 附录

### 上传文件

`POST https://api.coze.cn/v1/files/upload`，`multipart/form-data`，字段名 **`file`**。文档：[上传文件](https://www.coze.cn/docs/developer_guides/upload_files?_lang=zh)

### `object_string` 与空文字

`content_type` 为 `object_string` 时，图片/口语都需 **`text` + `image`/`audio`** 两段；无额外说明时 **`text` 可为 `""`**。

### Node SDK 示例（读取助手 JSON）

```javascript
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: 'https://api.coze.cn',
});

// 学习计划或图片：createAndPoll
const { messages } = await client.chat.createAndPoll({
  bot_id: '7627028738093596712',
  user_id: 'biz-user',
  additional_messages: [
    { role: RoleType.User, content: '学生情况…', content_type: 'text' },
  ],
});
const reply = messages.filter((m) => m.type === 'answer').map((m) => m.content).join('');
const data = JSON.parse(reply);

// 口语：stream + message list
let convId, chatId;
for await (const evt of client.chat.stream({
  bot_id: '7627028747031642150',
  user_id: 'biz-user',
  additional_messages: [/* object_string 含 audio */],
})) {
  if (evt.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
    convId = evt.data.conversation_id;
    chatId = evt.data.id;
  }
}
const msgs = await client.chat.messages.list(convId, chatId);
const oralReply = msgs.filter((m) => m.type === 'answer').map((m) => m.content).join('');
const oralData = JSON.parse(oralReply);
```

### 冒烟脚本

- `npm run test:oral-audio`：验证 **wav + `file_id` + stream**（需 `tests/fixtures/oral_sample.wav` 与 `.env` 中 Token）。

### 官方文档

- [Chat v3](https://www.coze.cn/docs/developer_guides/chat_v3?_lang=zh)
- [消息列表](https://www.coze.cn/docs/developer_guides/chat_message_list?_lang=zh)
- [鉴权](https://www.coze.cn/docs/developer_guides/authentication?_lang=zh)

### 仓库 Prompt 同步到扣子

| 命令 | 说明 |
|------|------|
| `npm run coze:push-plan` | `learning-plan.md` → 计划 Bot |
| `npm run coze:push-oral` | `oral-homework.md` → 口语 Bot |
| `npm run coze:push-image` | `image-homework.md` → 图片 Bot |

需配置 `.env` 中 `COZE_API_TOKEN`。
