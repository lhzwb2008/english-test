# Coze 三智能体 — 后端接入说明

**Base URL**：`[REDACTED]`
**鉴权**：`Authorization: Bearer <COZE_API_TOKEN>`

三个智能体：**学习计划**、**作业批改（图）**、**口语评测（音）**。

| 智能体 | `bot_id` | 调用 |
|--------|----------|------|
| 学习计划 | `7627028738093596712` | `POST /v3/chat`，`stream: false` |
| 作业批改（图） | `7627028840921219091` | `POST /v3/chat`，`stream: false`（须先 `/v1/files/upload` 取 `file_id`） |
| 口语评测（音） | `7627028747031642150` | `POST /v3/chat`，**`stream: true`**（须先 `/v1/files/upload` 取 `file_id`） |
| 知识点讲解 | `7638556864866795539` | `POST /v3/chat`，`stream: false` |

三个 bot 都返回**一份合法 JSON**，业务侧拿到 `answer` 消息的 `content` 后做 `JSON.parse` 即可。若模型偶发包裹 Markdown 围栏，截取首个 `{` 至末尾 `}` 子串后再解析。

---

## 1. 学习计划

**`bot_id`**：`7627028738093596712`，`stream: false`，推荐 SDK `chat.createAndPoll`。

### 入参（`content_type: text`）

业务侧在**一条用户消息**里写清 **`student_profile`**（自然语言学生档案，能推断**在读教材/体系**、**当前进度**、**每日时长与目标**），并按需附加：

- `start_date`（可选）：具体公历起点（如 `2026-05-08`）。给出时模型按"日期模式"在每个 `days[i]` 同时输出 `day_index` 与 `date`；不给则按"序号模式"仅输出 `day_index`，由后端自行挂载日期。
- `period_hint`（可选）：`"先排两周"` / `"按月排到本月底"` / `"排到本单元结束"`；未指明默认 **14 个连续学习日**。

**不传** `curriculum`、**不传** `task_pool`：四套陪跑表的**原子课节已编入扣子侧 Prompt**（按 `think1` / `think2` / `powerup2` / `powerup3` 分区，共 360+ 条），模型先判定 `meta.curriculum` 再从内置库匹配 `lesson_code`。**不走 RAG**。

### 出参（`answer.content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `meta.student_label` | string | 学生摘要（中文） |
| `meta.curriculum` | string | `think1` \| `think2` \| `powerup2` \| `powerup3` |
| `meta.assumptions` | string[] | 对齐取舍说明（中文） |
| `meta.schedule_mode` | string | `by_day_index` \| `by_date` |
| `days[]` | array | 学习日序列 |
| `days[].day_index` | number | 第几个学习日（1 起递增） |
| `days[].date` | string | 公历 `YYYY-MM-DD`，仅 `by_date` 时输出 |
| `days[].unit_zh` | string | 单元说明（中文为主） |
| `days[].lesson_code` | string | 内置库中该体系下某条 `####` 标题原文，如 `U1-L1-Reading1` |
| `days[].tasks[].detail_zh` | string | 任务说明（中文） |
| `days[].tasks[].source_ref` | string | 来源引用（页码/听力编号等） |
| `days[].tasks[].unit_ref` | string | 所属单元（如 `Unit 1`） |
| `days[].tasks[].priority` | string | `must` \| `optional` |
| `review_and_adjust_zh` | string[] | 复盘与调整建议（中文） |

### 示例输入

```text
student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系，THINK1 第一单元 Reading 阶段；每周六线下课 1.5 小时；学校每天英语课。能完成作业、自觉背默单词，性格拖拉。
学习目标：小学三年级暑假 KET 卓越；五年级暑假 PET 优秀。
每天可学英语 30–60 分钟。
start_date: 2026-05-08
period_hint: 先排两周（连续 14 个学习日）。

请仅输出 JSON 学习计划，schedule_mode 设为 by_date 并包含 days[].date。
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
        { "detail_zh": "P8 知识清单单词(1-19)背记和认读、句子朗读", "source_ref": "P8", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "P10 quiz 完成单词和句子自默（1-27题）",      "source_ref": "P10", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "口语：分享自己喜欢或讨厌的一项活动并谈感受", "source_ref": "",    "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "P9 思维导图、P10 Practice 填空",             "source_ref": "P9/P10", "unit_ref": "Unit 1", "priority": "optional" }
      ]
    },
    {
      "day_index": 2,
      "date": "2026-05-09",
      "unit_zh": "Unit1 语法1词汇1",
      "lesson_code": "U1-L2-Grammar1Vocabulary1",
      "tasks": [
        { "detail_zh": "练习册 P10 1-4题、P12 1题",                  "source_ref": "P10/P12", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "Hobbies 单词短语背记/自默；Present simple 语法规则背记和例句朗读", "source_ref": "P2/P4/P6", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "口语：双人对话互问爱好",                     "source_ref": "",       "unit_ref": "Unit 1", "priority": "must" }
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

---

## 2. 作业批改（图片）

**`bot_id`**：`7627028840921219091`，`stream: false`。

### 设计与限制

- 业务侧**只**通过 `object_string` 传入 **`text`**（一句调用提示，如「请仅输出 JSON」）+ **`image` + `file_id`**。
- **不传** `answer_key`、教材单元范围、阅读 passage、作文评分量表等业务上下文：这些是**题库 / 知识库**侧职责。
- **当前为无题库版本**：模型基于图片 OCR 出题干，能由通用语言知识独立确定的题目（语法填空、固定搭配等）会给出 `standard_answer`；阅读题若图中印有 passage 则结合 passage 判分；其它情况下 `standard_answer` 留空（`""`），并在 `reasoning_zh` / `limitations` 写明「因无题库未给标答」。
- **后续接入知识库 RAG 后**：Prompt 升级为"用 OCR 出的题干检索题库，命中后回填原题与标答"。**输出 schema 保持兼容**（业务无需改对接），`original_question` 与 `standard_answer` 直接写知识库返回的标准字段。

### 入参（`content_type: object_string`）

调用流程：

1. **`POST /v1/files/upload`**（`multipart/form-data`，字段名 `file`）→ 取 `data.id` 作为 `file_id`。
2. `additional_messages[*].content_type = "object_string"`，`content` 为 **JSON 数组的字符串形式**，至少包含：
   - `{"type":"text","text":"请仅输出 JSON。"}`
   - `{"type":"image","file_id":"<上一步取得的 file_id>"}`

### 出参（`answer.content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `image_summary_zh` | string | 本页概述（中文） |
| `items[]` | array | 逐题 |
| `items[].id` | string | 题号或本地序号 |
| `items[].item_type` | string | `mcq` \| `fill_blank` \| `short_answer` \| `matching` \| `cloze` \| `translation` \| `reading` \| `composition` \| `unknown`；**作文统一作为一个 `item_type=composition` 的 item 出现在 `items` 中**，前端按 `item_type` 区分解析 |
| `items[].reading_subtype` | string \| null | `main_idea` \| `detail` \| `inference` \| `vocabulary_in_context`；非阅读题为 `null` |
| `items[].original_question` | string | 从图中 OCR 出的完整题干（含选项），便于前端展示原题；不可读时为 `""` |
| `items[].standard_answer` | string | 标准答案；**无题库且无法独立确认时为 `""`**（接入知识库后由 RAG 回填） |
| `items[].passage_quote` | string | 阅读引用原文片段；图中未印 passage 或非阅读题时为 `""` |
| `items[].passage_translation_zh` | string | `passage_quote` 的中文译文 |
| `items[].evidence_quote` | string | 判分依据所摘录的原文/题干句子；非阅读题可为空 |
| `items[].evidence_translation_zh` | string | `evidence_quote` 的中文翻译 |
| `items[].student_answer` | string | 识别到的作答；不清写 `illegible` |
| `items[].is_correct` | boolean \| null | 是否正确（`standard_answer` 为空时按通用语言规则给最稳妥判断，不确定时降低 `confidence`）；**作文 item 固定 `null`** |
| `items[].confidence` | number | 0–1 |
| `items[].reasoning_zh` | string | 简短判分理由（中文） |
| `items[].explanation_zh` | string | 完整讲解（中文，可直接 TTS） |
| `items[].knowledge_points_zh` | string[] | 1–3 个考点关键词，便于学习总结 bot 抓薄弱点 |
| `items[].composition` | object \| 缺省 | **仅 `item_type=composition` 的 item 才有**；其它题型不输出此字段 |
| `items[].composition.total_score` | number \| null | 作文总分（无量表时为 `null`） |
| `items[].composition.rubric_breakdown[]` | array | `{dimension_zh, score, comment_zh}`（中文维度名；当前 `score` 一律 `null`） |
| `items[].composition.highlight_revisions` | string[] | 改写示例（中文为主，可夹英文片段） |
| `overall_comment_zh` | string | 总评（中文） |
| `limitations` | string[] | OCR / 缺原文 / 无题库无法核对标答等限制（中文） |

> **结构变更说明**：旧版本曾在顶层输出 `composition_assessment` 与 `items` 并列；当前版本已**统一收进 `items`**，作为 `item_type=composition` 的 item，并把作文专属字段放在 `items[].composition` 子对象里。这样前端只需对 `items` 做一次遍历，再按 `item_type` 分流；同一份作业里若有多篇作文，会出现多个 composition item。

### 示例 `object_string` 中 `text`（与 `image` 同条消息）

```text
请仅输出 JSON。
```

### 示例输出（节选）

```json
{
  "image_summary_zh": "本页是 THINK1 教材第一单元的阅读与练习作业，包含阅读理解选择题、语法填空题、30 词左右的爱好主题小写作三个题型。",
  "items": [
    {
      "id": "1",
      "item_type": "reading",
      "reading_subtype": "detail",
      "original_question": "1. What does Anna like doing?\nA. playing computer games\nB. reading books and playing the guitar\nC. painting\nD. playing football",
      "standard_answer": "B",
      "passage_quote": "I like reading books and playing the guitar.",
      "passage_translation_zh": "我喜欢读书和弹吉他。",
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
      "passage_quote": "",
      "passage_translation_zh": "",
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
      "passage_quote": "",
      "passage_translation_zh": "",
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

> 当**图中没有印 passage** 时（即纸面只给题干），阅读类题目的 `standard_answer` 会留空（`""`），`is_correct` 取最稳妥判断并把 `confidence` 调低，`limitations` 中明示「无题库，无法核对阅读题标答」。接入知识库后这部分由 RAG 回填，schema 不变。

---

## 3. 口语评测（音频）

**`bot_id`**：`7627028747031642150`，**`stream: true`**（含 `audio` 时强制流式）。

### 入参（`content_type: object_string`）

调用流程：

1. **`POST /v1/files/upload`** 上传 wav / ogg_opus（其它格式先转码）→ 取 `data.id` 作 `file_id`。
2. **`POST /v3/chat`**，`stream: true`，`additional_messages[*].content_type = "object_string"`，`content` 为 JSON 数组字符串：
   - `{"type":"text","text":"..."}`：业务可在此带题型说明 `assignment`、参考英文句 `reference_text`、维度提示 `dimension_hints`；无说明时可为 `""`。
   - `{"type":"audio","file_id":"<上一步取得的 file_id>"}`
3. 消费 SSE 直到 `conversation.chat.completed`，记下 `conversation_id` 与 `chat_id`。
4. **`GET /v3/chat/message/list`**，找 `type === "answer"`，对 `content` 做 `JSON.parse`。

> SSE 中可能出现 `event: conversation.audio.delta` + `content_type: audio`，这是助手侧 TTS 分片，不是用户上传的音频回传，业务侧忽略即可。

### 出参（`answer.content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `reference_text` | string \| null | 参考句（英文）；业务未给则 `null` |
| `transcript` | string | 学生口语**英文**转写（保留原句，不自动修正） |
| `holistic_score_1_to_5` | number \| null | 整体 1–5 |
| `holistic_summary_zh` | string | 总评（中文） |
| `dimensions[]` | array | 五维评分 |
| `dimensions[].id` | string | `fluency` \| `accuracy` \| `pronunciation` \| `completeness` \| `interaction` |
| `dimensions[].label_zh` | string | 维度中文名 |
| `dimensions[].score_1_to_5` | number \| null | 1–5 |
| `dimensions[].comment_zh` | string | 该维简评（中文） |
| `pronunciation.mispronounced_or_weak_words` | string[] | 发音/用词提醒（中文为主） |
| `language.grammar_issues[]` | array | 每条 `{issue_zh, suggestion_zh}` 或字符串（中文） |
| `language.lexical_suggestions_zh` | string[] | 词汇升级建议（中文） |
| `coaching_tips_zh` | string[] | 练习建议（中文） |
| `limitations` | string[] | 限制说明（中文） |

### 示例 `object_string` 中 `text`

```text
assignment: 口语作业：介绍自己的爱好或日常活动。请使用 like + gerund（如 like reading books），不要 like + 动词原形。
reference_text: I like playing football and reading books at weekends.
请仅输出 JSON 口语批改结果（含 dimensions 五维 + holistic 总评）。
```

### 示例输出（节选）

```json
{
  "reference_text": "I like playing football and reading books at weekends.",
  "transcript": "I met my friend two years ago. We became friends because we all like read books. ... I like playing with he, her.",
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

---

## 4. 知识点讲解

**`bot_id`**：`7638556864866795539`，`stream: false`，推荐 SDK `chat.createAndPoll`。

用于学生在批改结果里点击"关联知识点 → 查看讲解"时**实时生成**讲解文本（也可在后台先调一次落库复用）。**输出 Markdown 文本为核心产物**，并附 TTS 朗读脚本，便于前端生成讲解音频。

### 入参（`content_type: text`）

业务侧在**一条用户消息**里写清：

- **`知识点：<名称>`**（必填）：中文知识点名称，如 `现在完成时` / `for 与 since 的区别` / `不可数名词`。
- **`context：...`**（可选）：教学/批改上下文，自然语言，例如：学生年级、触发场景（"批改中现在完成时句子出错"）、希望强调或省略的子点。未给默认按**小学高年级**讲。

建议消息开头写一句 `请仅输出 JSON。`，避免模型偶发输出 Markdown 围栏。

### 出参（`answer.content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `knowledge_point` | string | 回显输入的知识点名称 |
| `explanation_markdown` | string | **核心产物**：完整讲解 Markdown（包含定义、公式、句式表格、用法、易混对照、不规则变化、易错点、随堂练习+答案）。换行为 `\n`，前端直接 Markdown 渲染。 |
| `tts_script_zh` | string | 可直接送 TTS 的中文朗读脚本（纯文本，无 Markdown 标记），约 500–900 字。 |

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

`POST [REDACTED]/v1/files/upload`，`multipart/form-data`，字段名 **`file`**。响应 `data.id` 即 **`file_id`**。文档：[上传文件](https://www.coze.cn/docs/developer_guides/upload_files?_lang=zh)

**对话接入只用 `file_id`**：在 `/v3/chat` 里用 `object_string` 带上 `image / audio + file_id`，平台在对话侧解析；不要尝试把 `file_id` 拼成公网 URL。若业务要长期可访问的图/音 URL，请走自有对象存储。

### `object_string` 注意点

- `content` 本体是**字符串**，其值为 **JSON 数组的字符串形式**（注意转义）。
- 图片/口语都需 `text` + `image / audio` 两段；`text` 可为 `""`。
- 仅有公网 URL、没有 `file_id` 时：服务端拉流再 `POST /v1/files/upload`，用返回的 `id` 发对话。

### 口语为何强制 `stream: true`

最终 JSON 是在对话结束后从 `message/list` 里取的。但只要消息里带音频，OpenAPI 不允许 `stream: false`，必须 `stream: true` 发请求；流结束（或轮询 `retrieve` 至 `completed`）后再拉 `message/list`。SSE 中的 `delta` / `verbose` 可忽略，以 `answer` 的完整 `content` 为准。

### Node SDK 示例

```javascript
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: '[REDACTED]',
});

// 学习计划：纯文本 + createAndPoll
const { messages: planMsgs } = await client.chat.createAndPoll({
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
const upImg = await client.files.upload({ file: fs.createReadStream('./homework.png') });
const { messages: imgMsgs } = await client.chat.createAndPoll({
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

// 口语评测：上传 + stream + message list
const upAud = await client.files.upload({ file: fs.createReadStream('./oral.wav') });
let convId, chatId;
for await (const evt of client.chat.stream({
  bot_id: '7627028747031642150',
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
})) {
  if (evt.event === ChatEventType.CONVERSATION_CHAT_COMPLETED) {
    convId = evt.data.conversation_id;
    chatId = evt.data.id;
  }
}
const oralMsgs = await client.chat.messages.list(convId, chatId);
const oral = JSON.parse(
  oralMsgs.filter((m) => m.type === 'answer').map((m) => m.content).join('')
);

// 知识点讲解：纯文本输入
const { messages: kpMsgs } = await client.chat.createAndPoll({
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
