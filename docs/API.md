# Coze 三智能体 — 后端接入说明

**Base URL**：`https://api.coze.cn`  
**鉴权**：`Authorization: Bearer <COZE_API_TOKEN>`

三个智能体：**学习计划**、**作业批改（图）**、**口语评测（音）**。下方按 Bot 说明**工程侧需在输入中携带的内容**、**出参 JSON 字段**及**示例**。更多调用细节见文末 **附录**。

---

## 学习计划

**bot_id**：`7627028738093596712`

**调用**：`POST /v3/chat`，**`stream: false`**（推荐 SDK `chat.createAndPoll`）。

### 入参（`content_type: text`）

单条用户消息内用**小标题**分块（非 HTTP JSON 体）：

| 块 | 是否必填 | 说明 |
|----|----------|------|
| `curriculum` | **必填** | `think1` \| `think2` \| `powerup2` \| `powerup3` |
| `task_pool` | **必填** | 从该国别**陪跑计划表**粘贴的课节列表（与仓库根目录四份 xls/xlsx 案例**同构**）。**仅允许编排其中出现的 `lesson_code`**；可全量粘贴，**不走 RAG** |
| `student_profile` | 建议 | 年级、时长、目标、习惯等自然语言 |

**学习日个数**：**不由业务传 `day_count`**。模型根据 `task_pool` 中**课节条目（行）数**自动生成 `days[]` 长度，并使 `day_index` 1…N 与条目顺序一致（与四表中「每行一课/一次作业布置」一致）；**真实公历日期由后端**自行挂载到各 `day_index`。

### 出参（`answer` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `meta.student_label` | string | 学生摘要（中文） |
| `meta.curriculum` | string | 与输入一致 |
| `meta.assumptions` | string[] | 假设与说明（中文） |
| `days` | array | 按学习日序号排列 |
| `days[].day_index` | number | 第几个学习日，从 1 递增（等价 day1、day2） |
| `days[].unit_zh` | string | 单元说明（中文为主） |
| `days[].lesson_code` | string | 须来自输入 `task_pool` |
| `days[].tasks` | array | 当日条目 |
| `days[].tasks[].detail_zh` | string | 任务说明（中文） |
| `days[].tasks[].source_ref` | string | 来源引用 |
| `days[].tasks[].priority` | string | `must` \| `optional` |
| `review_and_adjust_zh` | string[] | 复盘与调整建议（中文） |

### 示例输入

```
curriculum: think1

student_profile:
三年级，女，每日约 45 分钟，目标 KET 卓越。

task_pool:
Welcome-PartA-01 | 必做：练习册P4(1/2/4题) | 口语：主题词汇认读
U1-L1-Reading1 | 必做：P8 单词认读句子朗读 | 选做：P9 思维导图

请仅输出一个 JSON（days 条数与 task_pool 课节条数一致）。
```

### 示例输出（节选）

```json
{
  "meta": {
    "student_label": "三年级女生｜THINK1｜每日约45分钟",
    "curriculum": "think1",
    "assumptions": []
  },
  "days": [
    {
      "day_index": 1,
      "unit_zh": "Welcome",
      "lesson_code": "Welcome-PartA-01",
      "tasks": [
        {
          "detail_zh": "练习册必做；主题词汇认读。",
          "source_ref": "Welcome-PartA-01 / workbook p.4",
          "priority": "must"
        }
      ]
    },
    {
      "day_index": 2,
      "unit_zh": "Unit 1",
      "lesson_code": "U1-L1-Reading1",
      "tasks": [
        {
          "detail_zh": "知识清单认读与朗读；可选思维导图。",
          "source_ref": "U1-L1-Reading1 / P8-P9",
          "priority": "must"
        }
      ]
    }
  ],
  "review_and_adjust_zh": ["按周复盘错题。"]
}
```

---

## 作业批改（图片）

**bot_id**：`7627028840921219091`

**调用**：`POST /v3/chat`，**`stream: false`**。

**交互与一期一致（勿改对接方式）**：`POST /v1/files/upload` 取 **`file_id`** → `chat.createAndPoll`（或等价 Chat 调用）→ `additional_messages` 使用 **`content_type: object_string`**，`content` 为 **JSON 数组字符串**，且数组内须同时包含 **`{"type":"text","text":"..."}`** 与 **`{"type":"image","file_id":"..."}`**。本节下方表格仅约定 **`text` 中可拼接的语义内容**（阅读 passage、标答等），**不是**新增 HTTP 字段或替换 `object_string` 结构。

### 入参（`content_type: object_string`）

先 **`POST /v1/files/upload`** 得到 **`file_id`**。`object_string` 的 `content` 为 **JSON 数组字符串**，须同时包含 **`text`** 与 **`image` + `file_id`**。

**`text` 中建议包含（自然语言或分节）：**

| 块 | 是否必填 | 说明 |
|----|----------|------|
| 教材/单元/题号范围 | 建议 | 便于定位 |
| **阅读 passage** | 阅读题强烈建议 | 若原文不在作业纸上，由业务把 passage 文本贴入 |
| `answer_key` | 可选 | 教师标答 |
| `composition_rubric` | 作文可选 | 分项评分要点（中文） |

### 出参（`answer` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `image_summary_zh` | string | 本页概述（**中文**） |
| `items` | array | 逐题 |
| `items[].id` | string | 题号或序号 |
| `items[].item_type` | string | `mcq` \| `fill_blank` \| `short_answer` \| `reading` \| `composition` \| `unknown` |
| `items[].reading_subtype` | string \| null | `main_idea` \| `detail` \| `inference`，非阅读题为 `null` |
| `items[].passage_quote` | string | 阅读引用原文片段 |
| `items[].passage_translation_zh` | string | 参考译文 |
| `items[].evidence_quote` | string | 判分依据句摘录 |
| `items[].student_answer` | string | 识别到的作答 |
| `items[].correct_answer` | string \| null | 标答 |
| `items[].is_correct` | boolean | 是否正确 |
| `items[].confidence` | number | 0～1 |
| `items[].reasoning_zh` | string | 简短判分理由（中文） |
| `items[].explanation_zh` | string | 完整讲解（中文，可 TTS） |
| `overall_comment_zh` | string | 总评（中文） |
| `limitations` | string[] | 限制与不确定说明（中文） |

### 示例 `object_string` 中 `text`（与 `image` 同条消息）

```text
教材：THINK1 Unit1 Reading
题号：1-5
以下为阅读 passage（因图中字小由系统附带）：
...（passage 全文或节选）...
answer_key:（可选）教师标答或要点
请按智能体要求仅输出 JSON。
```

### 示例输出（节选）

```json
{
  "image_summary_zh": "本页为阅读理解选择题，共5题。",
  "items": [
    {
      "id": "1",
      "item_type": "reading",
      "reading_subtype": "detail",
      "passage_quote": "（摘自图中题干与系统 passage）…",
      "passage_translation_zh": "……",
      "evidence_quote": "……",
      "student_answer": "B",
      "correct_answer": "B",
      "is_correct": true,
      "confidence": 0.88,
      "reasoning_zh": "依据原文第二段细节，选项 B 与文意一致。",
      "explanation_zh": "本题考查细节：…。建议你回到第二段标出关键句。"
    }
  ],
  "overall_comment_zh": "阅读题表现较好，注意圈画证据句。",
  "limitations": []
}
```

---

## 口语评测（音频）

**bot_id**：`7627028747031642150`

**调用**：`POST /v3/chat`，**含 `audio` 时必须 `stream: true`**。

**交互与一期一致（勿改对接方式）**：**含用户 `audio` 时禁止使用 `stream: false`**（否则会报参数错误）。先 **`POST /v1/files/upload`** 得 **`file_id`**（音频格式通常仅 **`wav` / `ogg_opus`**，其它需先转码）；`object_string` 内须同时包含 **`text`** 与 **`audio` + `file_id`**；流结束后用 **`GET /v3/chat/message/list`** 取 **`type === "answer"`** 的 **`content`** 再 **`JSON.parse`**。本节下方表格仅约定 **`text` 中的作业说明等**，**不改变**上传、stream、取数链路。

### 入参（`content_type: object_string`）

先上传音频得 **`file_id`**；**`object_string`** 中同时包含 **`text`**（可空占位）与 **`audio` + `file_id`**。

**`text` 中建议包含：**

| 块 | 是否必填 | 说明 |
|----|----------|------|
| `assignment` | 建议 | 题型与任务说明（朗读/问答/对话要点） |
| 参考课文/句子 | 可选 | 业务可把 `reference_text` 英文贴入说明 |
| `dimension_hints` | 可选 | 若只评部分维度可说明；默认五维全评 |

### 出参（流结束后 `message/list` 取 `type === "answer"` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `reference_text` | string \| null | 参考句（英文） |
| `transcript` | string | 学生口语**英文**转写 |
| `holistic_score_1_to_5` | number \| null | 整体 1～5 |
| `holistic_summary_zh` | string | 总评（中文） |
| `dimensions` | array | 五维评分 |
| `dimensions[].id` | string | `fluency` \| `accuracy` \| `pronunciation` \| `completeness` \| `interaction` |
| `dimensions[].label_zh` | string | 维度中文名 |
| `dimensions[].score_1_to_5` | number \| null | 1～5 |
| `dimensions[].comment_zh` | string | 该维简评（中文） |
| `pronunciation.mispronounced_or_weak_words` | string[] | 发音/用词提醒（中文为主） |
| `language.grammar_issues` | array | 语法问题（中文说明） |
| `language.lexical_suggestions_zh` | string[] | 词汇建议（中文） |
| `coaching_tips_zh` | string[] | 练习建议（中文） |
| `limitations` | string[] | 限制说明（中文） |

### 示例 `object_string` 中 `text`

```text
assignment: 朗读并回答：What do you like doing at weekends? 使用 like + gerund。
请输出 JSON 口语批改结果。
```

### 示例输出（节选）

```json
{
  "reference_text": null,
  "transcript": "I like playing football and reading books at weekends.",
  "holistic_score_1_to_5": 4,
  "holistic_summary_zh": "表达清楚，like + doing 基本正确，个别语法需巩固。",
  "dimensions": [
    {
      "id": "fluency",
      "label_zh": "流利度与连贯",
      "score_1_to_5": 4,
      "comment_zh": "语流较顺，衔接自然。"
    },
    {
      "id": "accuracy",
      "label_zh": "语言准确性（语法、词汇）",
      "score_1_to_5": 3,
      "comment_zh": "like 后动词形式需注意统一为动名词。"
    }
  ],
  "pronunciation": {
    "mispronounced_or_weak_words": ["注意 like 后接 playing / reading 的并列一致。"]
  },
  "language": {
    "grammar_issues": ["若强调两个并列爱好，可用 I like playing ... and reading ..."],
    "lexical_suggestions_zh": ["可在句尾补充时间状语丰富信息。"]
  },
  "coaching_tips_zh": ["仿写三句介绍周末活动，录一遍自查。"],
  "limitations": []
}
```

---

## 附录

### 图片 / 口语：传输层未变更说明

- 与历史版本相同：**必须先上传得 `file_id`，再在 Chat 里用 `object_string` 引用**；不要指望仅贴公网 URL 代替 `file_id`（见下「`object_string` 与 URL」）。
- **变更仅限**：Prompt 与**业务可拼进 `text` 的语义**、以及助手返回的 **JSON 字段表**（见各 Bot 正文）；**不是** Chat v3 协议变更。

### 上传文件

`POST https://api.coze.cn/v1/files/upload`，`multipart/form-data`，字段名 **`file`**。文档：[上传文件](https://www.coze.cn/docs/developer_guides/upload_files?_lang=zh)

**`file_id` 与 URL**：成功响应里通常有 **`data.id`**（即 **`file_id`**）。**对话接入不需要、也不要自己拼「下载地址」**：在 **`/v3/chat`** 里用 **`object_string`** 带上 **`image`/`audio` + `file_id`** 即可，平台会在对话侧解析该资源。`file_id` **不是**「把 id 填进某个固定 `https://…` 模板就能长期公网访问」的那种链接；若官方响应里另有临时 **`url`** 等字段，以**当前接口文档**为准，且多为短期有效，不宜当作持久素材地址。若业务必须在 App 里展示用户上传图/音的**长期可访问 URL**，应使用**自有对象存储**或产品文档推荐方式，而不是依赖「用 `file_id` 拼 URL」。

### `object_string` 与空文字

`content_type` 为 `object_string` 时，图片/口语都需 **`text` + `image`/`audio`** 两段；无额外说明时 **`text` 可为 `""`**（与一期一致）。阅读题若需要 passage，再由业务在 `text` 中追加。

**只有公网 URL、没有 `file_id` 时**：对话接口里图片/音频字段**以 `file_id` 为准**，**不要**指望把自建 OSS、CDN 上的 `https://…` 直接塞进 `object_string` 当作官方支持的入参。若素材只存在于你的 URL，**由服务端拉取该 URL 的文件流，再 `POST /v1/files/upload`**，用返回的 **`id`** 发对话。是否支持其它字段名（如 `url`），以**当前** [Chat v3](https://www.coze.cn/docs/developer_guides/chat_v3?_lang=zh) / `object_string` 说明为准。

### 接入 Tips（口语专项，与一期相同）

- **为何不能改成 `stream: false`**：最终 JSON 是在**对话结束后**从 **`message/list`** 里取的，与是否流式「传输助手正文」无关；但**只要消息里带音频**，OpenAPI 就**不允许** `stream: false`，只能 **`stream: true`** 发请求，再在流结束（或轮询 `retrieve` 至 `completed`）后拉 **`message/list`**。SSE 里可忽略大量 `delta`/`verbose`，以 **`answer` 的完整 `content`** 为准。
- **SSE 里出现 `event:conversation.audio.delta`、且 `content_type` 为 `audio`**：这是**助手侧语音合成（TTS）**分片，**不是**用户上传的音频被原样回传。若你只需要批改 JSON，**不要**把它当成「用户录音」，直接忽略该事件即可。
- **先上传再对话**：`POST /v1/files/upload`，响应里的 **`id`** 即 **`file_id`**，再拼进 **`object_string`**。
- **`object_string` 结构**：`content` 本体是**字符串**，其值为 **JSON 数组的字符串形式**（注意转义）；数组里至少要有 **`{"type":"text","text":""}`** 与 **`{"type":"audio","file_id":"..."}`**。
- **取结果**：消费 **SSE 直到结束**，用返回的 **`conversation_id`** 与 **`chat_id`** 调 **`GET /v3/chat/message/list`**，找 **`type === "answer"`**，对 **`content`** 做 **`JSON.parse`**。若模型偶发在 JSON 外夹杂 Markdown，业务侧需容错或重试。
- **`file_id` vs 仅贴 URL**：若用户**只粘贴音频 URL、没有 `file_id`**，行为与上传场景不同，**不要**与「已上传但解析失败」混为一谈。
- **推荐**：`@coze/api` 使用 **`chat.stream`** + **`chat.messages.list`**。

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
    { role: RoleType.User, content: '…见上文文本模板…', content_type: 'text' },
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

- `npm run test:oral-audio`：验证 **wav + `file_id` + stream**（需 fixture 与 `.env`）。

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
