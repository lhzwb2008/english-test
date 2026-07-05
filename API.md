# 智能体后端接入说明（Coze + Qwen-Omni 双引擎）

**鉴权**：`Authorization: Bearer <token>`（Coze Bot 用 `COZE_API_TOKEN`；Qwen 代理用 `QWEN_PROXY_TOKEN`，见下）。

五个智能体：**学习计划**、**作业批改（图）**、**口语评测（音，已切至 Qwen-Omni）**、**万能模型（自由 Prompt）**、**知识点讲解**。

| 智能体 | 引擎 | `bot_id` | 调用 |
| ------- | --- | --------------------- | --------------------------------------------------------------------- |
| 学习计划 | Coze | `7627028738093596712` | `POST /v3/chat`，`stream: false` |
| 作业批改（图） | Coze | `7627028840921219091` | `POST /v3/chat`，`stream: false`（须先 `/v1/files/upload` 取 `file_id`） |
| **口语评测（音）** | **Qwen-Omni 代理** | **`qwen-oral-v1`** | `POST /v3/chat`，`**stream: true`**（须先 `/v1/files/upload` 取 `file_id`）；**Base URL 改指向本地/已部署的 Qwen 代理** |
| 口语评测（音，Coze 旧版，仅供参考/回退） | Coze | `7627028747031642150` | 同上，`Base URL` 用 Coze 官方地址；**已知问题**：强制 TTS 音频输出，耗时/token 明显更高，不建议继续使用 |
| **万能模型（自由 Prompt，文本）** | Coze | **`7638850155068391439`** | `POST /v3/chat`；无预置 Prompt，业务在消息里写完整指令 |
| **万能模型（自由 Prompt，音频）** | **Qwen-Omni 代理** | **`qwen-universal-audio-v1`** | 同「口语评测」调用方式；无预置 system prompt，专为**音频输入 + 自定义 Prompt**场景设计 |
| 知识点讲解 | Coze | `7638556864866795539` | `POST /v3/chat`，`stream: false` |

所有 Bot 都返回**一份合法 JSON**（万能模型的输出结构由业务自定义 Prompt 决定），业务侧拿到 `answer` 消息的 `content` 后做 `JSON.parse` 即可。若模型偶发包裹 Markdown 围栏，截取首个 `{` 至末尾 `}` 子串后再解析。

---

## 0. 两套引擎如何选（重要）

| | Coze | Qwen-Omni 代理（本仓库 `server/`） |
|---|------|------------------------------|
| Base URL | `https://api.coze.cn` | 自建代理地址（本地 `http://127.0.0.1:8787`，或阿里云部署后的地址） |
| Token | `COZE_API_TOKEN` | `QWEN_PROXY_TOKEN` |
| 覆盖能力 | 学习计划、图片批改、知识点讲解、万能模型（文本） | 口语评测、万能模型（音频） |
| 音频场景表现 | 强制 TTS 音频输出（`conversation.audio.delta`），耗时数十秒、多收数 MB、token 消耗高 | `modalities:["text"]`，**不产生音频**，实测 22.7s 音频约 6–8s 出结果 |

**业务侧调用姿势完全一致**（同一套 `@coze/api` SDK 用法：先 `files.upload` 取 `file_id`，再 `chat.stream`/`chat.createAndPoll`，SSE 事件名一致），**只需按上表切换 `baseURL` + `token` + `bot_id` 三项配置**，无需改动业务代码。

---

## 1. 学习计划

`**bot_id`**：`7627028738093596712`，`stream: false`，推荐 SDK `chat.createAndPoll`。

### 入参（`content_type: text`）

业务侧在**一条用户消息**里写清 `**student_profile`**（自然语言学生档案，能推断**在读教材/体系**、**当前进度**、**每日时长与目标**），并按需附加：

- `start_date`（可选）：具体公历起点（如 `2026-05-08`）。给出时模型按"日期模式"在每个 `days[i]` 同时输出 `day_index` 与 `date`；不给则按"序号模式"仅输出 `day_index`，由后端自行挂载日期。
- `period_hint`（可选）：`"先排两周"` / `"按月排到本月底"` / `"排到本单元结束"`；未指明默认 **14 个连续学习日**。
- `system_task_pool`（可选）：业务方注入的"系统任务库"原子任务清单，每条形如 `ID: 100; 标题: 1单元单词复习; 描述: 1单元学习完成后，需要先复习单词`。**当本字段非空时，输出里 `days[].tasks[]` 必须从该清单中挑选**，并把命中条目的 ID 原样回填到 `tasks[].sourceRef`；未提供时所有 `sourceRef` 为 `""`，按内置教材库 `lesson_code` 衍生任务。该字段当前过渡用 `text` 直传，后续将切换知识库 RAG，输出 schema 保持不变。

**不传** `curriculum`、**不传** `task_pool`：四套陪跑表的**原子课节已编入扣子侧 Prompt**（按 `think1` / `think2` / `powerup2` / `powerup3` 分区，共 360+ 条），模型先判定 `meta.curriculum` 再从内置库匹配 `lesson_code`。**不走 RAG**。

### 出参（`answer.content` → `JSON.parse`）

| 字段                         | 类型       | 含义                                                      |
| -------------------------- | -------- | ------------------------------------------------------- |
| `meta.student_label`       | string   | 学生摘要（中文）                                                |
| `meta.curriculum`          | string   | `think1` \| `think2` \| `powerup2` \| `powerup3`           |
| `meta.assumptions`         | string[] | 对齐取舍说明（中文）                                              |
| `meta.schedule_mode`       | string   | `by_day_index` \| `by_date`                              |
| `days[]`                   | array    | 学习日序列                                                   |
| `days[].day_index`         | number   | 第几个学习日（1 起递增）                                           |
| `days[].date`              | string   | 公历 `YYYY-MM-DD`，仅 `by_date` 时输出                         |
| `days[].unit_zh`           | string   | 单元说明（中文为主）                                              |
| `days[].lesson_code`       | string   | 内置库中该体系下某条 `####` 标题原文，如 `U1-L1-Reading1`               |
| `days[].tasks[].detail_zh` | string   | 任务说明（中文）                                                |
| `days[].tasks[].sourceRef` | string   | 命中的 `system_task_pool` 原子任务 ID（如 `"100"`）；未提供任务库时为 `""` |
| `days[].tasks[].unit_ref`  | string   | 所属单元（如 `Unit 1`）                                        |
| `days[].tasks[].priority`  | string   | `must` \| `optional`                                     |
| `review_and_adjust_zh`     | string[] | 复盘与调整建议（中文）                                             |

### 示例输入

```text
student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系，THINK1 第一单元 Reading 阶段；每周六线下课 1.5 小时；学校每天英语课。能完成作业、自觉背默单词，性格拖拉。
学习目标：小学三年级暑假 KET 卓越；五年级暑假 PET 优秀。
每天可学英语 30–60 分钟。
start_date: 2026-05-08
period_hint: 先排两周（连续 14 个学习日）。

system_task_pool:
ID: 100; 标题: 1单元单词复习; 描述: 1单元学习完成后，需要先复习单词
ID: 101; 标题: 1单元课文跟读; 描述: 跟读 Unit1 Reading 课文 3 遍，注意语音语调
ID: 102; 标题: 1单元语法练习; 描述: 完成 Unit1 一般现在时填空 10 题
ID: 103; 标题: 1单元口语输出; 描述: 用 like + 动名词介绍自己的爱好，至少 30 秒
ID: 200; 标题: 2单元词汇预习; 描述: 预习 Unit2 单词表并完成自默

请仅输出 JSON 学习计划，schedule_mode 设为 by_date 并包含 days[].date；任务必须从 system_task_pool 中挑选，sourceRef 回填对应 ID。
```

### 示例输出（节选）

```json
{
  "meta": {
    "student_label": "无锡市大桥小学三年级吴同学，THINK1第一单元Reading阶段，目标三年级暑假KET卓越、五年级暑假PET优秀，每日可学30-60分钟",
    "curriculum": "think1",
    "assumptions": [
      "当前进度为THINK1第一单元Reading阶段，从U1-L1-Reading1开始对齐",
      "14个学习日对应公历日期为2026-05-08至2026-05-21（连续学习日）",
      "每周六线下课较多内容，必做项保持课后巩固优先，部分选做标 optional"
    ],
    "schedule_mode": "by_date"
  },
  "days": [
    {
      "day_index": 1,
      "date": "2026-05-08",
      "unit_zh": "Unit1 阅读1",
      "lesson_code": "U1-L1-Reading1",
      "tasks": [
        { "detail_zh": "1单元单词复习：完成 Unit1 单词表背记与认读", "sourceRef": "100", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "1单元课文跟读：跟读 Unit1 Reading 课文 3 遍", "sourceRef": "101", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "1单元口语输出：用 like + 动名词介绍爱好",    "sourceRef": "103", "unit_ref": "Unit 1", "priority": "must" }
      ]
    },
    {
      "day_index": 2,
      "date": "2026-05-09",
      "unit_zh": "Unit1 语法1词汇1",
      "lesson_code": "U1-L2-Grammar1Vocabulary1",
      "tasks": [
        { "detail_zh": "1单元语法练习：一般现在时填空 10 题", "sourceRef": "102", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "1单元单词复习：滚动复习 Unit1 词表",  "sourceRef": "100", "unit_ref": "Unit 1", "priority": "must" }
      ]
    }
  ],
  "review_and_adjust_zh": [
    "每周日复盘本周单词背默正确率，<80% 的词加入下周晨读清单",
    "每周复盘听力/阅读错题，整理到错题本，同类错题超 3 道做专项练习",
    "每完成 1 个单元做一套 KET 对应模块真题，按结果调整后续松紧"
  ]
}
```

**本地联调（任务库 + sourceRef）**：仓库内 `npm run coze:debug-plan`（脚本 `scripts/debug-learning-plan.mjs`）会向学习计划 Bot 发一条含 `system_task_pool` 的文本消息，并校验返回里每条 `tasks[].sourceRef` 是否落在池内 ID。需配置环境变量 `COZE_API_TOKEN`（与上文鉴权一致）。

---

## 2. 作业批改（图片）

`**bot_id`**：`7627028840921219091`，`stream: false`。

### 设计与限制

- 业务侧**只**通过 `object_string` 传入 `**text`**（一句调用提示，如「请仅输出 JSON」）+ `**image` + `file_id**`。
- **不传** `answer_key`、教材单元范围、阅读 passage、作文评分量表等业务上下文：这些是**题库 / 知识库**侧职责。
- **当前为无题库版本**：模型基于图片 OCR 出题干，能由通用语言知识独立确定的题目（语法填空、固定搭配等）会给出 `standard_answer`；阅读题若图中印有 passage 则结合 passage 判分；其它情况下 `standard_answer` 留空（`""`），并在 `reasoning_zh` / `limitations` 写明「因无题库未给标答」。
- **后续接入知识库 RAG 后**：Prompt 升级为"用 OCR 出的题干检索题库，命中后回填原题与标答"。**输出 schema 保持兼容**（业务无需改对接），`original_question` 与 `standard_answer` 直接写知识库返回的标准字段。

### 入参（`content_type: object_string`）

调用流程：

1. `**POST /v1/files/upload`**（`multipart/form-data`，字段名 `file`）→ 取 `data.id` 作为 `file_id`。
2. `additional_messages[*].content_type = "object_string"`，`content` 为 **JSON 数组的字符串形式**，至少包含：
  - `{"type":"text","text":"请仅输出 JSON。"}`
  - `{"type":"image","file_id":"<上一步取得的 file_id>"}`

### 出参（`answer.content` → `JSON.parse`）

| 字段                                        | 类型             | 含义                                                                                                                                                                                                  |
| ----------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image_summary_zh`                        | string         | 本页概述（中文）                                                                                                                                                                                            |
| `passages[]`                              | array          | **整页阅读原文**列表（一页若有多篇阅读材料就是多个对象）；非阅读页为 `[]`                                                                                                                                                           |
| `passages[].passage_id`                   | string         | 本页内稳定标识，如 `P1` / `P2`，供 `items[].passage_ref` 关联                                                                                                                                                    |
| `passages[].title`                        | string         | 阅读材料标题（如有），无则 `""`                                                                                                                                                                                  |
| `passages[].passage_text`                 | string         | **从图中 OCR 出的完整阅读原文**，保留段落用 `\n` 分段；OCR 不全时给能识别的部分并在 `limitations` 注明                                                                                                                                |
| `passages[].passage_translation_zh`       | string         | 整篇中文参考译文，可分段；无法翻译时为 `""`                                                                                                                                                                            |
| `items[]`                                 | array          | 逐题                                                                                                                                                                                                  |
| `items[].id`                              | string         | 题号或本地序号                                                                                                                                                                                             |
| `items[].item_type`                       | string         | `mcq` \| `fill_blank` \| `short_answer` \| `matching` \| `cloze` \| `translation` \| `reading` \| `composition` \| `unknown`；**作文统一作为一个 `item_type=composition` 的 item 出现在 `items` 中**，前端按 `item_type` 区分解析 |
| `items[].reading_subtype`                 | string \| null  | `main_idea` \| `detail` \| `inference` \| `vocabulary_in_context`；非阅读题为 `null`                                                                                                                         |
| `items[].original_question`               | string         | 从图中 OCR 出的完整题干（含选项），便于前端展示原题；不可读时为 `""`                                                                                                                                                             |
| `items[].standard_answer`                 | string         | 标准答案；**无题库且无法独立确认时为 `""`**（接入知识库后由 RAG 回填）                                                                                                                                                          |
| `items[].passage_ref`                     | string         | 本题对应的 `passages[].passage_id`；非阅读题为 `""`                                                                                                                                                            |
| `items[].evidence_quote`                  | string         | 判分依据所摘录的原文/题干句子；阅读题写自 `passages[].passage_text` 的相关片段，非阅读题可为空                                                                                                                                       |
| `items[].evidence_translation_zh`         | string         | `evidence_quote` 的中文翻译                                                                                                                                                                              |
| `items[].student_answer`                  | string         | 识别到的作答；不清写 `illegible`                                                                                                                                                                              |
| `items[].is_correct`                      | boolean \| null | 是否正确（`standard_answer` 为空时按通用语言规则给最稳妥判断，不确定时降低 `confidence`）；**作文 item 固定 `null`**                                                                                                                  |
| `items[].confidence`                      | number         | 0–1                                                                                                                                                                                                 |
| `items[].reasoning_zh`                    | string         | 简短判分理由（中文）                                                                                                                                                                                          |
| `items[].explanation_zh`                  | string         | 完整讲解（中文，可直接 TTS）                                                                                                                                                                                    |
| `items[].knowledge_points_zh`             | string[]       | 1–3 个考点关键词，便于学习总结 bot 抓薄弱点                                                                                                                                                                          |
| `items[].composition`                     | object \| 缺省    | **仅 `item_type=composition` 的 item 才有**；其它题型不输出此字段                                                                                                                                                  |
| `items[].composition.total_score`         | number \| null  | 作文总分（无量表时为 `null`）                                                                                                                                                                                  |
| `items[].composition.rubric_breakdown[]`  | array          | `{dimension_zh, score, comment_zh}`（中文维度名；当前 `score` 一律 `null`）                                                                                                                                     |
| `items[].composition.highlight_revisions` | string[]       | 改写示例（中文为主，可夹英文片段）                                                                                                                                                                                   |
| `overall_comment_zh`                      | string         | 总评（中文）                                                                                                                                                                                              |
| `limitations`                             | string[]       | OCR / 缺原文 / 无题库无法核对标答等限制（中文）                                                                                                                                                                        |

> **结构变更说明**：旧版本曾在顶层输出 `composition_assessment` 与 `items` 并列；当前版本已**统一收进 `items`**，作为 `item_type=composition` 的 item，并把作文专属字段放在 `items[].composition` 子对象里。这样前端只需对 `items` 做一次遍历，再按 `item_type` 分流；同一份作业里若有多篇作文，会出现多个 composition item。
>
> **阅读原文位置（重要）**：完整阅读原文统一放在**顶层 `passages[]`** 的 `passage_text`，**不在每个 item 里重复**。item 只通过 `passage_ref` 指向 `passages[].passage_id`，与本题判分直接相关的句段写到 `evidence_quote` / `evidence_translation_zh`。前端展示"原题 + 原文"时，从 `passages` 里按 `passage_ref` 取整篇文章。

### 示例 `object_string` 中 `text`（与 `image` 同条消息）

```text
请仅输出 JSON。
```

### 示例输出（节选）

```json
{
  "image_summary_zh": "本页是 THINK1 教材第一单元的阅读与练习作业，包含阅读理解选择题、语法填空题、30 词左右的爱好主题小写作三个题型。",
  "passages": [
    {
      "passage_id": "P1",
      "title": "About Anna",
      "passage_text": "Hi, I'm Anna. I'm twelve years old. I like reading books and playing the guitar.\nAt weekends, I often go to the park with my friends.",
      "passage_translation_zh": "你好，我叫 Anna，今年十二岁。我喜欢看书和弹吉他。\n周末我经常和朋友一起去公园。"
    }
  ],
  "items": [
    {
      "id": "1",
      "item_type": "reading",
      "reading_subtype": "detail",
      "original_question": "1. What does Anna like doing?\nA. playing computer games\nB. reading books and playing the guitar\nC. painting\nD. playing football",
      "standard_answer": "B",
      "passage_ref": "P1",
      "evidence_quote": "I like reading books and playing the guitar.",
      "evidence_translation_zh": "我喜欢读书和弹吉他。",
      "student_answer": "B",
      "is_correct": true,
      "confidence": 1.0,
      "reasoning_zh": "根据图中印有的阅读原文可确定标答为 B，学生作答与标答一致，回答正确。",
      "explanation_zh": "这道题问安娜喜欢做什么，属于阅读细节题，原文中可以直接找到「我喜欢读书和弹吉他」一句，正好匹配选项 B。",
      "knowledge_points_zh": ["阅读细节查找"]
    },
    {
      "id": "3",
      "item_type": "fill_blank",
      "reading_subtype": null,
      "original_question": "3. My brother ______ football every weekend.",
      "standard_answer": "plays",
      "passage_ref": "",
      "evidence_quote": "My brother ______ football every weekend.",
      "evidence_translation_zh": "我哥哥每个周末都踢足球。",
      "student_answer": "play",
      "is_correct": false,
      "confidence": 1.0,
      "reasoning_zh": "根据一般现在时语法规则可确定标答为 plays，学生作答 play 不符合语法。",
      "explanation_zh": "这道题考查一般现在时主谓一致，主语 My brother 是第三人称单数，时间状语 every weekend 表示一般现在时，动词要变第三人称单数 plays。",
      "knowledge_points_zh": ["一般现在时", "第三人称单数动词变化"]
    },
    {
      "id": "5",
      "item_type": "composition",
      "reading_subtype": null,
      "original_question": "Write about 30 words about your hobby.",
      "standard_answer": "",
      "passage_ref": "",
      "evidence_quote": "",
      "evidence_translation_zh": "",
      "student_answer": "I like play football. I play football with my friends after school. Football make me happy.",
      "is_correct": null,
      "confidence": 0.9,
      "reasoning_zh": "作文整体表意清晰，主要存在两处语法错误，不做对错判断。",
      "explanation_zh": "本篇 30 词小作文围绕「喜欢踢足球」展开，内容、结构、卷面都不错，主要问题集中在语法：like 后接动名词、主语 football 为第三人称单数需要 makes。建议改写为「I like playing football. I play football with my friends after school. Football makes me happy.」",
      "knowledge_points_zh": ["like + 动名词", "第三人称单数动词变化"],
      "composition": {
        "total_score": null,
        "rubric_breakdown": [
          { "dimension_zh": "内容", "score": null, "comment_zh": "内容完整，清晰说明了爱好、活动场景、感受，符合 30 词左右的字数要求。" },
          { "dimension_zh": "结构", "score": null, "comment_zh": "层次清晰：先点明爱好，再说明场景，最后表达感受。" },
          { "dimension_zh": "语言", "score": null, "comment_zh": "存在两处语法错误：like 后接动名词应为 playing；主语 football 第三人称单数，make 要改为 makes。" },
          { "dimension_zh": "卷面", "score": null, "comment_zh": "书写整洁，无涂改痕迹。" }
        ],
        "highlight_revisions": [
          "将 I like play football 改为 I like playing football（like + 动名词）",
          "将 football make me happy 改为 football makes me happy（三单 makes）"
        ]
      }
    }
  ],
  "overall_comment_zh": "本次作业完成度较好。阅读第 1 题与填空第 4 题正确，阅读第 2 题未定位到原文原因类信息，填空第 3 题需巩固三单变化；作文表意清晰但有两处小语法错误。",
  "limitations": ["写作题无官方评分量表，仅给参考建议与语法修改，未做官方评分"]
}
```

> 当**图中没有印 passage** 时（即纸面只给题干），顶层 `passages` 为 `[]`，阅读类题目的 `standard_answer` 会留空（`""`），`is_correct` 取最稳妥判断并把 `confidence` 调低，`limitations` 中明示「无题库，无法核对阅读题标答」。接入知识库后这部分由 RAG 回填，schema 不变。

---

## 3. 口语评测（音频）—— 已切换至 Qwen-Omni 代理

`**bot_id`**：`qwen-oral-v1`（Qwen-Omni 代理，见 §0 切换表），`**stream: true**`（含 `audio` 时强制流式）。

> **为什么切换**：Coze 口语 Bot 只要消息含 `audio` 就会**强制 TTS**，以 `conversation.audio.delta` 推送助手语音，OpenAPI **无参数可关闭**，导致多等数十秒、多收数 MB 下行、token 消耗显著更高。本仓库 `server/`（`npm run qwen:serve`）实现了一个**对外协议与 Coze 完全兼容**的代理：`/v1/files/upload` + `/v3/chat`（SSE），内部改调百炼 `qwen3.5-omni-flash`，请求 `modalities: ["text"]`，**不产生任何音频输出**。业务侧沿用同一套 `@coze/api` 代码，仅需切换 `baseURL`/`token`/`bot_id`（见 §0）。
>
> `coze/prompts/oral-homework.md` **原文未改**，直接作为 Qwen 的 system prompt 使用，**入参格式、出参 JSON schema 与旧版 Coze Bot 完全一致**，前端/业务侧无需任何改造。

### 入参（`content_type: object_string`）

调用流程：

1. `**POST /v1/files/upload**` 上传 wav / mp3 等（代理支持 wav/mp3/aac/ogg/amr/3gp 等常见格式）→ 取 `data.id` 作 `file_id`。
2. `**POST /v3/chat**`，`stream: true`，`additional_messages[*].content_type = "object_string"`，`content` 为 JSON 数组字符串：
  - `{"type":"text","text":"..."}`：业务可在此带题型说明 `assignment`、参考英文句 `reference_text`、维度提示 `dimension_hints`；无说明时可为 `""`。**带原文**时在 `text` 中写明 `reference_text:` 英文台词/课文（朗读对标）；**不带原文**时不写或为空白，响应里 `reference_text` 需为 `null`，按自由作答判分，不得捏造对照文案。
  - `{"type":"audio","file_id":"<上一步取得的 file_id>"}`
3. 消费 SSE，在收到 `**conversation.message.completed`** 且 `type === "answer"`、`content_type === "text"` 时，对 `data.content` 做 `JSON.parse`（此时已是完整 JSON 字符串）。
4. Qwen 代理**不会**推送 `conversation.audio.delta`，收到 text `completed` 即代表本次对话结束，可直接断开连接（无需刻意 abort，代理会主动 `res.end()` 并发送 `done`）。

### 出参（`answer.content` → `JSON.parse`）

| 字段                                          | 类型            | 含义                                                                                                                                                                      |
| ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference_text`                            | string \| null | 参考句/原文（英文）；业务在 `text` 里给出则**带原文判分**（按 `transcript` ↔ `reference_text` 对比，漏读/错读/增读/语序错落都会落到对应维度评分与 `pronunciation.mispronounced_or_weak_words`），未给则 `null`，按自由口语判分，不臆造原文 |
| `transcript`                                | string        | 学生口语**英文**转写（保留原句，不自动修正）                                                                                                                                                |
| `standard_response_en`                      | string        | **参考标准回复**（英文）：结合 `assignment` 与学生 `transcript` 要点生成；朗读类与 `reference_text` 一致；自由口语类为语法正确、扣题的示范句；无有效转写时为 `""`                                                                 |
| `holistic_score_1_to_5`                     | number \| null | 整体 1–5                                                                                                                                                                  |
| `holistic_summary_zh`                       | string        | 总评（中文）                                                                                                                                                                  |
| `dimensions[]`                              | array         | 五维评分                                                                                                                                                                    |
| `dimensions[].id`                           | string        | `fluency` \| `accuracy` \| `pronunciation` \| `completeness` \| `interaction`                                                                                               |
| `dimensions[].label_zh`                     | string        | 维度中文名                                                                                                                                                                   |
| `dimensions[].score_1_to_5`                 | number \| null | 1–5                                                                                                                                                                     |
| `dimensions[].comment_zh`                   | string        | 该维简评（中文）                                                                                                                                                                |
| `pronunciation.mispronounced_or_weak_words` | string[]      | 发音/用词提醒（中文为主）                                                                                                                                                           |
| `language.grammar_issues[]`                 | array         | 每条 `{issue_zh, suggestion_zh}` 或字符串（中文）                                                                                                                                 |
| `language.lexical_suggestions_zh`           | string[]      | 词汇升级建议（中文）                                                                                                                                                              |
| `coaching_tips_zh`                          | string[]      | 练习建议（中文）                                                                                                                                                                |
| `limitations`                               | string[]      | 限制说明（中文）                                                                                                                                                                |

### 示例 `object_string` 中 `text`

```text
assignment: 口语作业：介绍自己的爱好或日常活动。请使用 like + gerund（如 like reading books），不要 like + 动词原形。
reference_text: I like playing football and reading books at weekends.
请仅输出 JSON 口语批改结果（含 dimensions 五维 + holistic 总评 + standard_response_en）。
```

### 示例输出（节选）

```json
{
  "reference_text": "I like playing football and reading books at weekends.",
  "transcript": "I met my friend two years ago. We became friends because we all like read books. ... I like playing with he, her.",
  "standard_response_en": "I met my friend two years ago. We became friends because we both like reading books. I like playing football and reading books at weekends. I like playing with her.",
  "holistic_score_1_to_5": 3,
  "holistic_summary_zh": "整体表述连贯，内容贴合介绍日常活动的作业要求，但存在多处语法错误，未遵守 like 加动名词的作业规定。",
  "dimensions": [
    { "id": "fluency",       "label_zh": "流利度与连贯",            "score_1_to_5": 4, "comment_zh": "整体表述逻辑顺畅，没有明显卡顿或自我修正" },
    { "id": "accuracy",      "label_zh": "语言准确性（语法、词汇）", "score_1_to_5": 2, "comment_zh": "多处语法错误，未遵守 like + 动名词结构" },
    { "id": "pronunciation", "label_zh": "发音清晰度",              "score_1_to_5": 4, "comment_zh": "转写内容通顺，未出现因发音模糊导致无法识别的情况" },
    { "id": "completeness",  "label_zh": "任务完整度",              "score_1_to_5": 4, "comment_zh": "覆盖爱好、日常和朋友相处等信息，要点齐全" },
    { "id": "interaction",   "label_zh": "交际得体性",              "score_1_to_5": 4, "comment_zh": "符合日常分享个人生活的交际场景" }
  ],
  "pronunciation": {
    "mispronounced_or_weak_words": [
      "注意动词 ing 形式的发音，比如 reading 不要读成 read",
      "注意宾格 him/her 的发音，不要和主格 he/she 混淆"
    ]
  },
  "language": {
    "grammar_issues": [
      { "issue_zh": "like 后接动词原形 read，违反 like + 动名词", "suggestion_zh": "将 like read books 改为 like reading books" },
      { "issue_zh": "介词 with 后接主格 he，且与 her 混用",         "suggestion_zh": "改为 with her（女性）或 with him（男性）" },
      { "issue_zh": "两人共同做某事不能用 all",                     "suggestion_zh": "we all like 改为 we both like" }
    ],
    "lexical_suggestions_zh": [
      "两人共同做某事用 both 比 all 更地道",
      "「我也会做同样的事」可用 do the same for sb"
    ]
  },
  "coaching_tips_zh": [
    "重点巩固 like + 动名词结构",
    "梳理主格/宾格代词，动词与介词后接宾格",
    "多跟读场景对话，避免表意模糊的句子"
  ],
  "limitations": [
    "本次批改主要基于转写内容，发音/语调等细节以音频为准"
  ]
}
```

### 成本对比（实测，22.7s 音频）

| 指标 | Coze 口语 Bot（旧版，仅参考） | Qwen-Omni 代理（现行） |
|------|--------------|----------------|
| 强制 TTS 音频流 | 有（`conversation.audio.delta`，数 MB） | **无** |
| 典型总耗时 | 数十秒（含等 TTS） | ~6–8s |
| Token（实测） | 较高（含 TTS 相关） | ~2600（`audio_tokens` ~156） |

### 本地启动与验证

```bash
# .env 配置 DASHSCOPE_API_KEY、QWEN_PROXY_TOKEN
npm run qwen:serve          # 终端 A，默认 :8787
npm run qwen:debug-oral     # 终端 B，用 @coze/api 指向本地代理做端到端验证
```

生产部署见 [`deploy/README.md`](deploy/README.md)（阿里云服务器一键安装/部署脚本）。

### 已知限制

- **无多轮 `conversation_id` 持久化**（口语批改为单轮，不影响现有用法）。
- **不支持** Coze 插件、workflow、知识库。
- **`GET /v3/chat/message/list` 未实现**（现有前端推荐 text-completed 断流，不依赖该兜底）。
- 音频上限按 `qwen3.5-omni-flash`：≤20 分钟、≤100MB；超限返回明确错误。
- 上传文件在代理内存暂存，默认 TTL 1 小时（`QWEN_FILE_TTL_MS`）。
- Coze 旧版口语 Bot（`bot_id 7627028747031642150`）仍可用作**回退/对照**，调用方式不变，仅 `baseURL`/`token` 换回 Coze 官方值。

---

## 4. 万能模型（自由 Prompt，无预置人设）

业务侧完全自定义指令的"空白 Bot"，用于批改主线三个固定 Prompt（学习计划/图片批改/知识点讲解）覆盖不到的临时性、探索性场景。**两个版本并存**，按输入模态选择：

| 版本 | 引擎 | `bot_id` | 输入 | 适用场景 |
|------|------|----------|------|----------|
| 万能模型（文本） | Coze | `7638850155068391439` | `content_type: text` | 纯文本自定义任务（无音频） |
| 万能模型（音频） | Qwen-Omni 代理 | `qwen-universal-audio-v1` | `content_type: object_string`（`text` + `audio` + `file_id`） | **音频输入 + 自定义 Prompt**（如听写、自由对话评测、非标准评分维度的口语任务） |

两者共同点：**不注入任何 system prompt**，模型的行为完全由业务在消息里写的指令决定；输出格式（JSON 或纯文本）也由业务在 Prompt 里自行约定并自行解析，本仓库不做 schema 假设。

### 万能模型（文本）调用

```javascript
const { messages } = await client.chat.createAndPoll({
  bot_id: '7638850155068391439',
  user_id: 'biz-user',
  additional_messages: [
    { role: RoleType.User, content: '<业务自定义完整指令 + 待处理文本>', content_type: 'text' },
  ],
});
```

### 万能模型（音频）调用

与「口语评测」调用方式完全一致（`baseURL`/`token` 指向 Qwen 代理），仅 `bot_id` 换成 `qwen-universal-audio-v1`，`text` 字段里写**完整的自定义指令**（Prompt + 输出格式要求）：

```javascript
const up = await client.files.upload({ file: fs.createReadStream('./audio.wav') });
for await (const evt of client.chat.stream({
  bot_id: 'qwen-universal-audio-v1',
  user_id: 'biz-user',
  additional_messages: [{
    role: RoleType.User,
    content_type: 'object_string',
    content: JSON.stringify([
      { type: 'text', text: '<业务自定义完整指令，例如：请转写音频并判断是否包含脏话，仅输出 JSON {transcript, has_profanity}>' },
      { type: 'audio', file_id: up.id },
    ]),
  }],
})) {
  // 同 §3：conversation.message.completed 时取 data.content
}
```

---

## 5. 知识点讲解

`**bot_id**`：`7638556864866795539`，`stream: false`，推荐 SDK `chat.createAndPoll`。

用于学生在批改结果里点击"关联知识点 → 查看讲解"时**实时生成**讲解文本（也可在后台先调一次落库复用）。**输出 Markdown 文本为核心产物**，并附 TTS 朗读脚本，便于前端生成讲解音频。

### 入参（`content_type: text`）

业务侧在**一条用户消息**里写清：

- `**知识点：<名称>`**（必填）：中文知识点名称，如 `现在完成时` / `for 与 since 的区别` / `不可数名词`。
- `**context：...**`（可选）：教学/批改上下文，自然语言，例如：学生年级、触发场景（"批改中现在完成时句子出错"）、希望强调或省略的子点。未给默认按**小学高年级**讲。

建议消息开头写一句 `请仅输出 JSON。`，避免模型偶发输出 Markdown 围栏。

### 出参（`answer.content` → `JSON.parse`）

| 字段                     | 类型     | 含义                                                                                        |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `knowledge_point`      | string | 回显输入的知识点名称                                                                                |
| `explanation_markdown` | string | **核心产物**：完整讲解 Markdown（包含定义、公式、句式表格、用法、易混对照、不规则变化、易错点、随堂练习+答案）。换行为 `\n`，前端直接 Markdown 渲染。 |
| `tts_script_zh`        | string | 可直接送 TTS 的中文朗读脚本（纯文本，无 Markdown 标记），约 500–900 字。                                          |

> 整体内容长度通常在 1500–3500 字（取决于知识点复杂度），`explanation_markdown` 字符串可能较大，前后端注意字段长度限制。

### 示例输入

```text
请仅输出 JSON。
知识点：现在完成时
context：学生为小学五年级，刚在批改中把 have been to 与 have gone to 用混。
```

### 示例输出（节选）

```json
{
  "knowledge_point": "现在完成时",
  "explanation_markdown": "## 一、什么是现在完成时？\n\n现在完成时连接**过去**和**现在**……\n\n## 二、基本构成\n\n**公式：主语 + have/has + 过去分词**\n\n## 三、四种句式\n\n| 句式 | 结构 | 例句 |\n|------|------|------|\n| 肯定句 | 主语 + have/has + 过去分词 | `I have finished my homework.` 我已经写完作业了。 |\n……\n\n## 八、容易踩的坑\n\n- ❌ `I have lost my keys yesterday.` → ✅ `I lost my keys yesterday.`\n……\n\n## 九、随堂小练习\n\n1. I ______ (finish) my homework already.\n……\n\n**答案：** 1. have finished……",
  "tts_script_zh": "今天我们来讲一个英语里非常重要的时态：现在完成时。它的核心，是把过去和现在连在一起……举个例子，英文是 I have lost my keys，意思是：我把钥匙弄丢了，所以现在进不了门……"
}
```

---

## 附录

### 上传文件

**Coze**：`POST https://api.coze.cn/v1/files/upload`，`multipart/form-data`，字段名 `**file**`。响应 `data.id` 即 `**file_id**`。文档：[上传文件](https://www.coze.cn/docs/developer_guides/upload_files?_lang=zh)

**Qwen 代理**：`POST <代理地址>/v1/files/upload`，同样 `multipart/form-data` + 字段名 `file`，响应结构 `{ code: 0, data: { id, bytes, created_at, file_name } }`，`data.id` 即 `file_id`；文件仅暂存于代理内存，默认 1 小时后过期（`QWEN_FILE_TTL_MS`）。

**对话接入只用 `file_id`**：在 `/v3/chat` 里用 `object_string` 带上 `image / audio + file_id`，平台/代理在对话侧解析；不要尝试把 `file_id` 拼成公网 URL。若业务要长期可访问的图/音 URL，请走自有对象存储。

### `object_string` 注意点

- `content` 本体是**字符串**，其值为 **JSON 数组的字符串形式**（注意转义）。
- 图片/口语都需 `text` + `image / audio` 两段；`text` 可为 `""`。
- 仅有公网 URL、没有 `file_id` 时：服务端拉流再 `POST /v1/files/upload`，用返回的 `id` 发对话。

### 口语为何强制 `stream: true`

只要消息里带 `audio`，Coze OpenAPI 不允许 `stream: false`，必须 `stream: true`；Qwen 代理同样要求 `stream: true`（与 Coze 行为保持一致，便于业务代码复用）。JSON 可在同一次流里的 `**conversation.message.completed`（text answer）** 直接解析；**不必**等 `chat.completed`。Coze 侧 `conversation.audio.delta` 在 text completed 之后仍会推送，业务应在 text completed 后断流；**Qwen 代理不产生该事件**，收到 text completed 即可视为对话结束。

### Node SDK 示例

```javascript
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

// Coze 引擎：学习计划 / 图片批改 / 万能模型（文本） / 知识点讲解
const cozeClient = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: process.env.COZE_BASE_URL, // https://api.coze.cn
});

// Qwen-Omni 引擎：口语评测 / 万能模型（音频）
const qwenClient = new CozeAPI({
  token: process.env.QWEN_PROXY_TOKEN,
  baseURL: process.env.QWEN_PROXY_BASE_URL, // 本地 http://127.0.0.1:8787 或部署后的地址
});

// 学习计划：纯文本 + createAndPoll
const { messages: planMsgs } = await cozeClient.chat.createAndPoll({
  bot_id: '7627028738093596712',
  user_id: 'biz-user',
  additional_messages: [
    { role: RoleType.User, content: '…见上文 student_profile…', content_type: 'text' },
  ],
});
const plan = JSON.parse(
  planMsgs.filter((m) => m.type === 'answer').map((m) => m.content).join('')
);

// 图片批改：上传 + createAndPoll
const upImg = await cozeClient.files.upload({ file: fs.createReadStream('./homework.png') });
const { messages: imgMsgs } = await cozeClient.chat.createAndPoll({
  bot_id: '7627028840921219091',
  user_id: 'biz-user',
  additional_messages: [
    {
      role: RoleType.User,
      content: JSON.stringify([
        { type: 'text', text: '请仅输出 JSON。' },
        { type: 'image', file_id: upImg.id },
      ]),
      content_type: 'object_string',
    },
  ],
});
const image = JSON.parse(
  imgMsgs.filter((m) => m.type === 'answer').map((m) => m.content).join('')
);

// 口语评测（Qwen-Omni）：上传 + stream；text answer completed 后即结束
const upAud = await qwenClient.files.upload({ file: fs.createReadStream('./oral.wav') });
const abort = new AbortController();
let oralRaw = '';
for await (const evt of qwenClient.chat.stream(
  {
    bot_id: 'qwen-oral-v1',
    user_id: 'biz-user',
    additional_messages: [
      {
        role: RoleType.User,
        content: JSON.stringify([
          { type: 'text', text: 'assignment: …\n请仅输出 JSON。' },
          { type: 'audio', file_id: upAud.id },
        ]),
        content_type: 'object_string',
      },
    ],
  },
  { signal: abort.signal },
)) {
  if (
    evt.event === ChatEventType.CONVERSATION_MESSAGE_COMPLETED &&
    evt.data?.type === 'answer' &&
    evt.data?.content_type === 'text'
  ) {
    oralRaw = evt.data.content;
    abort.abort();
    break;
  }
}
const oral = JSON.parse(oralRaw);

// 万能模型（文本）：纯文本自定义指令
const { messages: universalMsgs } = await cozeClient.chat.createAndPoll({
  bot_id: '7638850155068391439',
  user_id: 'biz-user',
  additional_messages: [
    { role: RoleType.User, content: '<业务自定义完整指令>', content_type: 'text' },
  ],
});

// 知识点讲解：纯文本输入
const { messages: kpMsgs } = await cozeClient.chat.createAndPoll({
  bot_id: '7638556864866795539',
  user_id: 'biz-user',
  additional_messages: [
    {
      role: RoleType.User,
      content: '请仅输出 JSON。\n知识点：现在完成时\ncontext：小学五年级，have been to / have gone to 混淆。',
      content_type: 'text',
    },
  ],
});
const knowledge = JSON.parse(
  kpMsgs.filter((m) => m.type === 'answer').map((m) => m.content).join('')
);
// knowledge.explanation_markdown → 渲染给学生看
// knowledge.tts_script_zh        → 送 TTS 生成音频
```

### 官方文档

- [Chat v3](https://www.coze.cn/docs/developer_guides/chat_v3?_lang=zh)
- [消息列表](https://www.coze.cn/docs/developer_guides/chat_message_list?_lang=zh)
- [鉴权](https://www.coze.cn/docs/developer_guides/authentication?_lang=zh)
