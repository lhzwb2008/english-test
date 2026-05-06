# Coze 三智能体 — 后端接入说明

**Base URL**：`[REDACTED]`
**鉴权**：`Authorization: Bearer <COZE_API_TOKEN>`

三个智能体：**学习计划**、**作业批改（图）**、**口语评测（音）**。下方按 Bot 说明**工程侧需在输入中携带的内容**、**出参 JSON 字段**及**真实示例**（节选自 `tests/fixtures/api-examples/*.json`，由 `node tests/refresh-api-examples.mjs` 实际调用扣子接口产出）。更多调用细节见文末 **附录**。

---

## 学习计划

**bot_id**：`7627028738093596712`

**调用**：`POST /v3/chat`，**`stream: false`**（推荐 SDK `chat.createAndPoll`）。

### 入参（`content_type: text`）

业务在**一条用户消息**里主要提供 **`student_profile`**（自然语言学生档案，能推断**在读教材/体系**、**当前进度**、**每日时长与目标**），并视情况附加：

- 可选 **`start_date`**：具体公历起点（如 `2026-05-08`）。给出时模型按"日期模式"在每个 `days[i]` 同时输出 `day_index` 与 `date`；不给则按"序号模式"仅输出 `day_index`，由后端自行挂载日期。
- 可选 **`period_hint`**：`"先排两周"` / `"按月排到本月底"` / `"排到本单元结束"`；未指明默认 **14 个连续学习日**。

**不写 `curriculum`、`task_pool`。** 四套陪跑表的**原子课节已全部编入扣子侧 Prompt**（按 `think1`/`think2`/`powerup2`/`powerup3` 分区），模型先判定 `meta.curriculum` 再从内置库匹配 `lesson_code`。**不走 RAG**。

### 出参（`answer` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `meta.student_label` | string | 学生摘要（中文） |
| `meta.curriculum` | string | `think1` \| `think2` \| `powerup2` \| `powerup3` |
| `meta.assumptions` | string[] | 对齐取舍说明（中文） |
| `meta.schedule_mode` | string | `by_day_index` \| `by_date` |
| `days` | array | 学习日序列 |
| `days[].day_index` | number | 第几个学习日（1 起递增） |
| `days[].date` | string | 公历 `YYYY-MM-DD`，仅 `by_date` 时输出 |
| `days[].unit_zh` | string | 单元说明（中文为主） |
| `days[].lesson_code` | string | 须为内置库该体系下某条 `####` 标题原文，如 `U1-L1-Reading1` |
| `days[].tasks` | array | 当日条目 |
| `days[].tasks[].detail_zh` | string | 任务说明（中文） |
| `days[].tasks[].source_ref` | string | 来源引用（页码/听力编号） |
| `days[].tasks[].unit_ref` | string | 所属单元（如 `Unit 1`） |
| `days[].tasks[].priority` | string | `must` \| `optional` |
| `review_and_adjust_zh` | string[] | 复盘与调整建议（中文） |

### 示例输入（真实测试）

```text
student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。
英语基础：剑桥体系，从 KIDS BOX1 学到目前 THINK1 第一单元 Reading 阶段；每周六下午一次线下课，每次一个半小时；学校译林教材，每天英语课。能完成作业、自觉背默单词，但性格比较拖拉。
学习目标：小学三年级暑假 KET 达到卓越；小学五年级暑假 PET 达到优秀。
每天可学英语 30–60 分钟。
start_date: 2026-05-08（周五）
period_hint: 先排两周（连续 14 个学习日）。

请仅输出 JSON 学习计划，schedule_mode 设为 by_date 并包含 days[].date。
```

### 示例输出（节选，连接真实接口产出）

```json
{
  "meta": {
    "student_label": "无锡大桥小学三年级吴同学，THINK1 U1 Reading阶段，目标三年级暑假KET卓越、五年级暑假PET优秀，每日可学30-60分钟",
    "curriculum": "think1",
    "assumptions": [
      "当前进度为THINK1第一单元Reading阶段，对齐内置库U1-L1-Reading1作为起始课",
      "每周六有线下THINK1课，当天任务适配课后巩固需求，因目标进度较紧未跳过周末",
      "每日任务量控制在30-60分钟，选做任务可根据当日时间灵活调整",
      "14个连续学习日对应日期为2026-05-08至2026-05-21"
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
        { "detail_zh": "P8知识清单单词(1-19)背记和认读、句子朗读", "source_ref": "P8", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "P10 quiz完成单词和句子自默（1-27题）", "source_ref": "P10", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "口语练习：分享自己喜欢或讨厌的一项活动，谈谈感受", "source_ref": "", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "P9根据文章完成思维导图、P10 Practice填空", "source_ref": "P9/P10", "unit_ref": "Unit 1", "priority": "optional" }
      ]
    },
    {
      "day_index": 2,
      "date": "2026-05-09",
      "unit_zh": "Unit1 语法1词汇1",
      "lesson_code": "U1-L2-Grammar1Vocabulary1",
      "tasks": [
        { "detail_zh": "完成练习册P10 1-4题、P12 1题", "source_ref": "P10/P12", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "Hobbies单词短语背记、自默，Present simple语法规则背记和例句朗读", "source_ref": "P2/P4/P6", "unit_ref": "Unit 1", "priority": "must" },
        { "detail_zh": "口语练习：扮演双人对话，互相询问对方爱好相关问题", "source_ref": "", "unit_ref": "Unit 1", "priority": "must" }
      ]
    }
    /* ...共 14 天，完整内容见 tests/fixtures/api-examples/plan.json */
  ],
  "review_and_adjust_zh": [
    "每周日复盘本周单词背默正确率，低于80%的单词加入下周晨读背记清单",
    "每周复盘听力、阅读错题，整理对应知识点到错题本，同类错题超过3道的针对性补充专项练习",
    "每完成1个单元的学习，做一套KET对应模块真题，检测掌握情况，调整后续进度松紧"
  ]
}
```

> 完整 14 天 JSON：见 `tests/fixtures/api-examples/plan.json`（`raw_response_text` 字段保留扣子原始返回）。

---

## 作业批改（图片）

**bot_id**：`7627028840921219091`

**调用**：`POST /v3/chat`，**`stream: false`**。

**交互与一期一致（勿改对接方式）**：`POST /v1/files/upload` 取 **`file_id`** → `chat.createAndPoll`（或等价 Chat 调用）→ `additional_messages` 使用 **`content_type: object_string`**，`content` 为 **JSON 数组字符串**，且数组内须同时包含 **`{"type":"text","text":"..."}`** 与 **`{"type":"image","file_id":"..."}`**。本节下表仅约定 **`text` 中可拼接的语义内容**（阅读 passage、标答、作文 rubric 等），**不是**新增 HTTP 字段或替换 `object_string` 结构。

### 入参（`content_type: object_string`）

先 **`POST /v1/files/upload`** 得到 **`file_id`**。`object_string` 的 `content` 为 **JSON 数组字符串**，须同时包含 **`text`** 与 **`image` + `file_id`**。

**`text` 中建议包含（自然语言或分节）：**

| 块 | 是否必填 | 说明 |
|----|----------|------|
| 教材/单元/题号范围 | 建议 | 便于定位 |
| **阅读 passage** | 阅读题强烈建议 | 若原文不在作业纸上，由业务把 passage 贴入 |
| `answer_key` | 可选 | 教师标答；模型仍以原文为准做交叉校验 |
| `composition_rubric` | 作文可选 | 分项评分要点（中文） |

### 出参（`answer` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `image_summary_zh` | string | 本页概述（**中文**） |
| `items` | array | 逐题 |
| `items[].id` | string | 题号或本地序号 |
| `items[].item_type` | string | `mcq` \| `fill_blank` \| `short_answer` \| `matching` \| `cloze` \| `translation` \| `reading` \| `composition` \| `unknown` |
| `items[].reading_subtype` | string \| null | `main_idea` \| `detail` \| `inference` \| `vocabulary_in_context`，非阅读题为 `null` |
| `items[].passage_quote` | string | 阅读引用原文片段（非阅读题给空串） |
| `items[].passage_translation_zh` | string | 上句对应参考译文 |
| `items[].evidence_quote` | string | 判分依据所摘录的原文/题干句子 |
| `items[].evidence_translation_zh` | string | `evidence_quote` 的中文翻译 |
| `items[].student_answer` | string | 识别到的作答（不清写 `illegible`） |
| `items[].correct_answer` | string \| null | 标答 |
| `items[].is_correct` | boolean | 是否正确 |
| `items[].confidence` | number | 0–1 |
| `items[].reasoning_zh` | string | 简短判分理由（中文） |
| `items[].explanation_zh` | string | 完整讲解（中文，可直接 TTS） |
| `items[].knowledge_points_zh` | string[] | 1–3 个考点关键词，便于薄弱点统计 |
| `composition_assessment` | object \| null | 作文类时填，非作文可省略或全 `null` |
| `composition_assessment.total_score` | number \| null | 作文总分（如 rubric 给 100） |
| `composition_assessment.rubric_breakdown` | array | `{dimension_zh, score, comment_zh}` 数组（中文维度名） |
| `composition_assessment.highlight_revisions` | string[] | 改写示例（中文为主，可夹英文片段） |
| `overall_comment_zh` | string | 总评（中文） |
| `limitations` | string[] | OCR/缺原文等限制说明（中文） |

### 示例 `object_string` 中 `text`（与 `image` 同条消息）

```text
教材：THINK1 Unit 1 — Reading & Practice
题号：A1-A2 阅读、B3-B4 填空、C 写作
本页阅读 passage（与图中一致，便于你判分时引用）：
"""
My name is Anna. I am twelve years old. I live in a small town with my family.
I have got a brother and a sister. My brother plays football every weekend. My sister
likes painting. I like reading books and playing the guitar. I never play computer
games on weekdays because I think they are boring. On Saturdays my whole family
goes to the park. I usually take my camera with me to take photos of birds.
"""
answer_key:
1. B
2. A
3. plays
4. like
composition_rubric:
- 内容（25%）：是否说明了爱好、频率、地点和感受
- 结构（25%）：是否有连贯的开头-展开-结尾
- 语言（30%）：动词三单/时态/动名词搭配
- 卷面（20%）：拼写与标点

请仅输出 JSON。
```

### 示例输出（节选，连接真实接口产出）

```json
{
  "image_summary_zh": "本页为THINK1 Unit1的阅读与练习作业，包含2道阅读理解选择题、2道语法填空题，以及1篇主题为个人爱好的30词左右小作文。",
  "items": [
    {
      "id": "A1",
      "item_type": "reading",
      "reading_subtype": "detail",
      "passage_quote": "I like reading books and playing the guitar.",
      "passage_translation_zh": "我喜欢读书和弹吉他。",
      "evidence_quote": "I like reading books and playing the guitar.",
      "evidence_translation_zh": "我喜欢读书和弹吉他。",
      "student_answer": "B",
      "correct_answer": "B",
      "is_correct": true,
      "confidence": 1.0,
      "reasoning_zh": "作答与原文表述一致，答案正确。",
      "explanation_zh": "这道题问安娜喜欢做什么，原文中可以直接找到安娜说自己喜欢读书和弹吉他的表述，对应选项B，你的作答是正确的。",
      "knowledge_points_zh": ["阅读细节定位", "兴趣爱好类词汇"]
    },
    {
      "id": "A2",
      "item_type": "reading",
      "reading_subtype": "detail",
      "passage_quote": "I never play computer games on weekdays because I think they are boring.",
      "passage_translation_zh": "我工作日从不玩电脑游戏，因为我觉得它们很无聊。",
      "evidence_quote": "I never play computer games on weekdays because I think they are boring.",
      "evidence_translation_zh": "我工作日从不玩电脑游戏，因为我觉得它们很无聊。",
      "student_answer": "C",
      "correct_answer": "A",
      "is_correct": false,
      "confidence": 1.0,
      "reasoning_zh": "原文未提及父母不允许玩游戏的相关内容，正确原因是安娜认为游戏无聊，对应选项A，作答错误。",
      "explanation_zh": "这道题问安娜工作日不玩电脑游戏的原因，原文明确说明是因为她觉得电脑游戏很无聊，对应选项A。你选的『父母不允许』在原文中完全没有提到，所以这道题答错了，做阅读题要记得回到原文找对应依据哦。",
      "knowledge_points_zh": ["阅读细节查找", "因果逻辑判断"]
    },
    {
      "id": "B3",
      "item_type": "fill_blank",
      "reading_subtype": null,
      "passage_quote": "",
      "passage_translation_zh": "",
      "evidence_quote": "My brother ____ football every weekend.",
      "evidence_translation_zh": "我的哥哥每个周末都踢足球。",
      "student_answer": "play",
      "correct_answer": "plays",
      "is_correct": false,
      "confidence": 1.0,
      "reasoning_zh": "主语my brother是第三人称单数，一般现在时谓语动词要用第三人称单数形式，作答用了动词原形，错误。",
      "explanation_zh": "这道题考查一般现在时的动词变化规则，主语『我的哥哥』属于第三人称单数，谓语动词要用第三人称单数形式，play 的三单形式是 plays。",
      "knowledge_points_zh": ["一般现在时", "第三人称单数动词变化"]
    }
  ],
  "composition_assessment": {
    "total_score": null,
    "rubric_breakdown": [
      { "dimension_zh": "内容", "score": null, "comment_zh": "完整说明了爱好是踢足球、和朋友一起玩、地点在公园、频率是每周末、感受是有趣又开心，符合内容要求。" },
      { "dimension_zh": "结构", "score": null, "comment_zh": "有开头点明爱好、中间说明活动场景、结尾表达感受的完整结构，逻辑连贯自然。" },
      { "dimension_zh": "语言", "score": null, "comment_zh": "存在两处语法错误：like 后接动名词应使用 playing，不能用 play；主语 football 是第三人称单数，make 要变为三单形式 makes，其余表达通顺。" },
      { "dimension_zh": "卷面", "score": null, "comment_zh": "拼写全部正确，标点使用规范，卷面整洁。" }
    ],
    "highlight_revisions": [
      "修正后的作文参考：I like playing football very much. I play it with my friend in the park every weekend. It is fun and I think football makes me happy."
    ]
  },
  "overall_comment_zh": "你本次作业的阅读第1题和填空第4题作答正确，掌握得不错。阅读第2题没有找到原文对应的正确细节，填空第3题对一般现在时第三人称单数的动词变化规则不够熟悉，作文整体内容和结构都达标，只有两处小的语法错误，修正后就很好啦，继续加油哦。",
  "limitations": ["本次作业文本清晰可识别，给定材料完整，无判分限制。"]
}
```

> 完整 4 题逐题 + 作文评分：见 `tests/fixtures/api-examples/image.json`。

---

## 口语评测（音频）

**bot_id**：`7627028747031642150`

**调用**：`POST /v3/chat`，**含 `audio` 时必须 `stream: true`**。

**交互与一期一致（勿改对接方式）**：**含用户 `audio` 时禁止使用 `stream: false`**（否则会报参数错误）。先 **`POST /v1/files/upload`** 得 **`file_id`**（音频格式通常仅 **`wav` / `ogg_opus`**，其它先转码）；`object_string` 内须同时包含 **`text`** 与 **`audio` + `file_id`**；流结束后用 **`GET /v3/chat/message/list`** 取 **`type === "answer"`** 的 **`content`** 再 **`JSON.parse`**。

### 入参（`content_type: object_string`）

先上传音频得 **`file_id`**；**`object_string`** 中同时包含 **`text`**（可空占位）与 **`audio` + `file_id`**。

**`text` 中建议包含：**

| 块 | 是否必填 | 说明 |
|----|----------|------|
| `assignment` | 建议 | 题型与任务说明（朗读 / 问答 / 对话要点） |
| `reference_text` | 可选 | 参考英文句子或课文原文 |
| `dimension_hints` | 可选 | 仅评部分维度时说明；默认五维全评 |

### 出参（流结束后 `message/list` 取 `type === "answer"` 的 `content` → `JSON.parse`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `reference_text` | string \| null | 参考句（英文） |
| `transcript` | string | 学生口语**英文**转写（保留原句，不自动修正） |
| `holistic_score_1_to_5` | number \| null | 整体 1–5 |
| `holistic_summary_zh` | string | 总评（中文） |
| `dimensions` | array | 五维评分 |
| `dimensions[].id` | string | `fluency` \| `accuracy` \| `pronunciation` \| `completeness` \| `interaction` |
| `dimensions[].label_zh` | string | 维度中文名 |
| `dimensions[].score_1_to_5` | number \| null | 1–5 |
| `dimensions[].comment_zh` | string | 该维简评（中文） |
| `pronunciation.mispronounced_or_weak_words` | string[] | 发音/用词提醒（中文为主） |
| `language.grammar_issues` | array | 每条 `{issue_zh, suggestion_zh}` 或字符串（中文） |
| `language.lexical_suggestions_zh` | string[] | 词汇升级建议（中文） |
| `coaching_tips_zh` | string[] | 练习建议（中文） |
| `limitations` | string[] | 限制说明（中文） |

### 示例 `object_string` 中 `text`

```text
assignment: 口语作业：介绍自己的爱好或日常活动。请使用 like + gerund（如 like reading books）；不要 like + 动词原形。
reference_text: I like playing football and reading books at weekends. (示例参考)
请仅输出 JSON 口语批改结果（含 dimensions 五维 + holistic 总评）。
```

### 示例输出（节选，连接真实接口产出）

```json
{
  "reference_text": "I like playing football and reading books at weekends. (示例参考)",
  "transcript": "I met my friend two years ago. We became friends because we all like read books. She will recommend the good books she has read to me. I would do the thing. Now, we do homework and play together. We also swim, play badminton together after school. I like playing with he, her.",
  "holistic_score_1_to_5": 3,
  "holistic_summary_zh": "整体表述连贯，内容贴合介绍日常活动的作业要求，但存在多处语法错误，尤其未遵守 like 加动名词的作业规定，整体表达合格但有较大提升空间",
  "dimensions": [
    { "id": "fluency",       "label_zh": "流利度与连贯",            "score_1_to_5": 4, "comment_zh": "整体表述逻辑顺畅，没有明显卡顿、自我修正的情况，流利度较好" },
    { "id": "accuracy",      "label_zh": "语言准确性（语法、词汇）", "score_1_to_5": 2, "comment_zh": "存在多处语法错误，违反了本次作业要求的 like 加动名词结构" },
    { "id": "pronunciation", "label_zh": "发音清晰度",              "score_1_to_5": 4, "comment_zh": "转写内容通顺，没有出现因发音模糊导致无法识别的内容" },
    { "id": "completeness",  "label_zh": "任务完整度",              "score_1_to_5": 4, "comment_zh": "涵盖爱好、日常和朋友相处的活动等信息，要点齐全" },
    { "id": "interaction",   "label_zh": "交际得体性",              "score_1_to_5": 4, "comment_zh": "表述自然，符合日常分享个人生活的交际场景，语气得体" }
  ],
  "pronunciation": {
    "mispronounced_or_weak_words": [
      "注意动词 ing 形式的发音，比如 reading 不要读成 read",
      "注意宾格 him/her 的发音，不要和主格 he/she 混淆"
    ]
  },
  "language": {
    "grammar_issues": [
      { "issue_zh": "使用 like 表达爱好时接了动词原形 read，违反本次作业要求的 like+动名词结构", "suggestion_zh": "将 like read books 改为 like reading books" },
      { "issue_zh": "介词 with 后面接了主格代词 he，语法使用错误，且 he 和 her 指代混乱", "suggestion_zh": "改为 like playing with her（指代女性朋友）或 like playing with him（指代男性朋友）" },
      { "issue_zh": "指代你和朋友两个人时用了 all，all 一般用于三者及以上",                    "suggestion_zh": "将 we all like 改为 we both like" },
      { "issue_zh": "I would do the thing 表述模糊，表意不明确",                              "suggestion_zh": "改为 I also do the same for her，表示你也会给她推荐好书" }
    ],
    "lexical_suggestions_zh": [
      "表示两人共同做某事可以用 both 代替 all，更符合英语使用习惯",
      "表达『我也会做同样的事』可以用固定表达 do the same for sb，比 do the thing 更地道清晰"
    ]
  },
  "coaching_tips_zh": [
    "重点巩固 like+动名词的固定结构，每次练习表达爱好时刻意提醒自己加动词 ing 形式",
    "梳理主格和宾格代词的用法，尤其是动词、介词后面要接宾格代词",
    "可以多跟读场景对话，积累日常分享的常用地道表达，避免出现表意模糊的句子"
  ],
  "limitations": [
    "本次批改仅基于提供的转写内容，未结合实际音频的语调、重音、连读等细节，若需要更精准的发音评测可上传对应音频"
  ]
}
```

> 完整原始 SSE → message/list 出参：见 `tests/fixtures/api-examples/oral.json`。

---

## 附录

### 图片 / 口语：传输层未变更说明

- 与历史版本相同：**必须先上传得 `file_id`，再在 Chat 里用 `object_string` 引用**；不要指望仅贴公网 URL 代替 `file_id`（见下「`object_string` 与 URL」）。
- **变更仅限**：Prompt 与**业务可拼进 `text` 的语义**、以及助手返回的 **JSON 字段表**（见各 Bot 正文）；**不是** Chat v3 协议变更。

### 上传文件

`POST [REDACTED]/v1/files/upload`，`multipart/form-data`，字段名 **`file`**。文档：[上传文件](https://www.coze.cn/docs/developer_guides/upload_files?_lang=zh)

**`file_id` 与 URL**：成功响应里通常有 **`data.id`**（即 **`file_id`**）。**对话接入不需要、也不要自己拼「下载地址」**：在 **`/v3/chat`** 里用 **`object_string`** 带上 **`image`/`audio` + `file_id`** 即可，平台会在对话侧解析该资源。`file_id` **不是**「把 id 填进某个固定 `https://…` 模板就能长期公网访问」的那种链接。若业务必须在 App 里展示用户上传图/音的**长期可访问 URL**，应使用**自有对象存储**或产品文档推荐方式。

### `object_string` 与空文字

`content_type` 为 `object_string` 时，图片/口语都需 **`text` + `image`/`audio`** 两段；无额外说明时 **`text` 可为 `""`**（与一期一致）。阅读题若需要 passage，再由业务在 `text` 中追加。

**只有公网 URL、没有 `file_id` 时**：对话接口里图片/音频字段**以 `file_id` 为准**。若素材只存在于你的 URL，**由服务端拉取该 URL 的文件流，再 `POST /v1/files/upload`**，用返回的 **`id`** 发对话。

### 接入 Tips（口语专项，与一期相同）

- **为何不能改成 `stream: false`**：最终 JSON 是在**对话结束后**从 **`message/list`** 里取的，与是否流式「传输助手正文」无关；但**只要消息里带音频**，OpenAPI 就**不允许** `stream: false`，只能 **`stream: true`** 发请求，再在流结束（或轮询 `retrieve` 至 `completed`）后拉 **`message/list`**。SSE 里可忽略大量 `delta`/`verbose`，以 **`answer` 的完整 `content`** 为准。
- **SSE 里出现 `event:conversation.audio.delta`、且 `content_type` 为 `audio`**：这是**助手侧语音合成（TTS）**分片，**不是**用户上传的音频被原样回传。若你只需要批改 JSON，**不要**把它当成「用户录音」，直接忽略该事件即可。
- **先上传再对话**：`POST /v1/files/upload`，响应里的 **`id`** 即 **`file_id`**，再拼进 **`object_string`**。
- **`object_string` 结构**：`content` 本体是**字符串**，其值为 **JSON 数组的字符串形式**（注意转义）；数组里至少要有 **`{"type":"text","text":""}`** 与 **`{"type":"audio","file_id":"..."}`**。
- **取结果**：消费 **SSE 直到结束**，用返回的 **`conversation_id`** 与 **`chat_id`** 调 **`GET /v3/chat/message/list`**，找 **`type === "answer"`**，对 **`content`** 做 **`JSON.parse`**。若模型偶发在 JSON 外夹杂 Markdown 围栏，业务侧需做容错（截取首个 `{`–末尾 `}` 子串）或重试。
- **推荐**：`@coze/api` 使用 **`chat.stream`** + **`chat.messages.list`**。

### Node SDK 示例（读取助手 JSON）

```javascript
import { CozeAPI, RoleType, ChatEventType } from '@coze/api';

const client = new CozeAPI({
  token: process.env.COZE_API_TOKEN,
  baseURL: '[REDACTED]',
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

### 端到端测试脚本

| 命令 | 用途 |
|------|------|
| `node tests/refresh-api-examples.mjs` | **真实调用**三个 bot，把请求 / 响应落到 `tests/fixtures/api-examples/{plan,image,oral}.json`，便于据此校验本文档示例 |
| `npm run test:oral-audio` | 验证 **wav + `file_id` + stream**（需 fixture 与 `.env`） |
| `npm run test:e2e` | 一期保留的三 bot 串联冒烟（依赖 THINK1 真实素材，可选） |

### 官方文档

- [Chat v3](https://www.coze.cn/docs/developer_guides/chat_v3?_lang=zh)
- [消息列表](https://www.coze.cn/docs/developer_guides/chat_message_list?_lang=zh)
- [鉴权](https://www.coze.cn/docs/developer_guides/authentication?_lang=zh)

### 仓库 Prompt 同步到扣子

| 命令 | 说明 |
|------|------|
| `npm run coze:export-builtin` | 从 `ref/*.xls(x)` 重新导出 `coze/prompts/builtin-tasks-from-excels.md`（**所有原子课节**，按体系/Sheet 分区） |
| `npm run coze:build-plan`     | `learning-plan-head.md` + `builtin-tasks-from-excels.md` → `learning-plan.md` |
| `npm run coze:push-plan`      | 先 `coze:build-plan`，再推送至**计划 Bot**并发布 API 渠道 `1024` |
| `npm run coze:push-image`     | `image-homework.md` → 图片 Bot |
| `npm run coze:push-oral`      | `oral-homework.md` → 口语 Bot |

需配置 `.env` 中 `COZE_API_TOKEN`。
