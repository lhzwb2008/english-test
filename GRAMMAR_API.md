# 词汇 / 语法薄弱点接口（Qwen）

仅覆盖两个接口：**单元总评 + 知识点列表**、**知识点讲解 + 出题**。模型：`qwen3.8-max`（可用环境变量 `QWEN_TEXT_MODEL` 覆盖）。

## 调用说明

| 项 | 值 |
|---|---|
| **Base URL（生产）** | `http://101.201.237.149:8000` |
| **健康检查** | `GET /health` |
| **鉴权** | **无需**传 `Authorization`（访问控制由服务器网络侧维护） |
| **Content-Type** | `application/json` |
| **响应** | 非流式 JSON；业务侧直接使用返回体中的 `data` |

与口语代理相同机器、相同鉴权方式；本两接口**不走** `/v3/chat`，也**不需要**先上传文件。

耗时参考：总评约 1–3 分钟（完整 `unit_review` 偏长），讲解出题约 1–2 分钟。建议客户端超时 ≥ **300s**。

---

## 1. 单元总评 + 知识点列表

`POST /v1/grammar/assess`

根据单元学习数据（任务数、各类型正确/错误、错词、错题明细、口语语法问题等）生成总评，并产出待巩固的**词汇/语法知识点列表**（供接口 2 逐个调用）。

### 入参

Body 即为单元学习 JSON（与业务侧 `unit_review` 同结构）。也可包在 `unit_review` 或 `input` 字段下。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | string | 是 | 单元，如 `Unit3` |
| `totalTaskCount` | number | 否 | 任务总数（可与各 type 之和略有出入） |
| `taskTypes` | array | 是 | 按类型聚合的学习数据，非空 |
| `taskTypes[].type` | string | 是 | 如 `listening` / `oral` / `word_cn_to_en` |
| `taskTypes[].typeLabel` | string | 否 | 中文标签 |
| `taskTypes[].taskCount` | number | 否 | 该类型任务数 |
| `taskTypes[].homework` | object | 否 | 见下 |

`homework` 常见字段（按类型出现，缺省即可）：

- 无作业：`hasHomework: false`
- 计数：`totalQuestions` / `totalWords` / `totalSentences`、`correctCount`、`wrongCount`
- 词汇错词：`wrongWords: string[]`
- 错题：`wrongQuestions: [{ question, studentAnswer, correctAnswer, explanation }]`（字段可不全）
- 口语：`averageScore`、`grammarIssues: [{ issue, suggestion }]`

输入中的 `instruction` 若存在会被忽略，任务以服务端 Prompt 为准。

### 出参

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 成功为 `true` |
| `model` | string | 实际调用模型 |
| `usage` | object | `token_count` / `input_count` / `output_count` |
| `data.summary` | object | 总评 |
| `data.knowledge_points` | array | 知识点列表 |

`data.summary`：

| 字段 | 说明 |
|------|------|
| `unit_label` | 单元标签 |
| `overall_assessment` | 总评正文 |
| `strengths` | 优点 |
| `priority_focus` | 优先攻克方向 |
| `task_highlights` | 各类型一句摘要 |
| `assumptions` | 推断说明 |

`data.knowledge_points[]`：

| 字段 | 说明 |
|------|------|
| `id` | 如 `kp_1` |
| `title` | 知识点标题（可直接作为接口 2 的 `knowledge_point`） |
| `category` | `grammar` \| `vocabulary` |
| `priority` | `high` \| `medium` \| `low` |
| `reason` | 列入原因 |
| `focus_points` | 子点 |
| `evidence_types` | 证据来源的 `type` 列表 |
| `suggested_question_types` | `choice` / `blank` / `translation` |

### 示例请求

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/assess' \
  -H 'Content-Type: application/json' \
  -d '{
    "unit": "Unit3",
    "totalTaskCount": 40,
    "taskTypes": [
      {
        "type": "word_cn_to_en",
        "typeLabel": "单词中译英",
        "taskCount": 2,
        "homework": {
          "totalWords": 20,
          "correctCount": 6,
          "wrongCount": 14,
          "wrongWords": ["animated film", "comedy", "thriller", "talent show"]
        }
      },
      {
        "type": "image_free_upload",
        "typeLabel": "书面作业",
        "taskCount": 6,
        "homework": {
          "totalQuestions": 106,
          "correctCount": 83,
          "wrongCount": 23,
          "wrongQuestions": [
            {
              "question": "bad 副词比较级：______",
              "studentAnswer": "more badly",
              "correctAnswer": "worse",
              "explanation": "badly 的比较级是不规则变化 worse，不能加 more。"
            },
            {
              "question": "用 (not) as ... as 完成句子",
              "studentAnswer": "is modern than",
              "correctAnswer": "isn'\''t as modern as",
              "explanation": "题目要求 as...as 结构，不能写成比较级 than。"
            }
          ]
        }
      },
      {
        "type": "oral",
        "typeLabel": "口语",
        "taskCount": 4,
        "homework": {
          "averageScore": 3,
          "grammarIssues": [
            {
              "issue": "comedy film 泛指应用复数",
              "suggestion": "改为 comedy films"
            },
            {
              "issue": "a lot time 搭配错误",
              "suggestion": "改为 a lot of time"
            }
          ]
        }
      },
      {
        "type": "listening",
        "typeLabel": "听力",
        "taskCount": 3,
        "homework": {
          "totalQuestions": 41,
          "correctCount": 24,
          "wrongCount": 17,
          "wrongQuestions": [
            {
              "question": "What DVD does the shop assistant recommend?",
              "studentAnswer": "the book set lieve",
              "correctAnswer": "the box set of Glee",
              "explanation": "细节听辨错误，box/book 混淆。"
            }
          ]
        }
      }
    ]
  }'
```

### 示例响应（节选）

```json
{
  "ok": true,
  "model": "qwen3.8-max",
  "usage": {
    "token_count": 4200,
    "input_count": 1500,
    "output_count": 2700
  },
  "data": {
    "summary": {
      "unit_label": "Unit3",
      "overall_assessment": "本单元词汇与书面语法仍是主要短板：中译英正确率偏低，比较级/最高级与 as…as 易混；口语有复数与固定搭配问题。建议先攻语法变形，再集中过影视类词汇。",
      "strengths": ["书面作业整体完成量较大，部分 as…as 题已掌握"],
      "priority_focus": "形容词/副词比较等级与影视主题词汇",
      "task_highlights": [
        {
          "type": "word_cn_to_en",
          "typeLabel": "单词中译英",
          "note": "20 词错 14，影视类词汇薄弱"
        },
        {
          "type": "oral",
          "typeLabel": "口语",
          "note": "平均分 3，存在复数与搭配问题"
        }
      ],
      "assumptions": []
    },
    "knowledge_points": [
      {
        "id": "kp_1",
        "title": "形容词与副词的比较级 / 最高级（含不规则）",
        "category": "grammar",
        "priority": "high",
        "reason": "书面作业出现 more badly、变形拼写错误等",
        "focus_points": ["规则变形", "不规则 worse/worst", "双音节 y→i"],
        "evidence_types": ["image_free_upload"],
        "suggested_question_types": ["choice", "blank", "translation"]
      },
      {
        "id": "kp_2",
        "title": "as…as 同级比较",
        "category": "grammar",
        "priority": "high",
        "reason": "易写成比较级 than",
        "focus_points": ["not as…as", "与比较级区分"],
        "evidence_types": ["image_free_upload"],
        "suggested_question_types": ["choice", "blank"]
      },
      {
        "id": "kp_3",
        "title": "影视 / 节目类词汇巩固",
        "category": "vocabulary",
        "priority": "high",
        "reason": "中译英大量错词集中在 film/show 类",
        "focus_points": ["animated film", "thriller", "talent show"],
        "evidence_types": ["word_cn_to_en"],
        "suggested_question_types": ["choice", "blank", "translation"]
      }
    ]
  }
}
```

### 错误码

| code | HTTP | 说明 |
|------|------|------|
| `4000` | 400 | 缺少 `unit` 或空的 `taskTypes` |
| `5000` | 500 | 模型调用或 JSON 解析失败 |

---

## 2. 知识点讲解 + 出题

`POST /v1/grammar/drill`

输入**分开**为两部分：知识点 + 学生情况。输出讲解 Markdown 与结构化题目（含答案），题型为选择 / 填空 / 翻译。

### 入参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `knowledge_point` | string | 是 | 知识点，如 `现在进行时`（兼容 `knowledgePoint`） |
| `student_profile` | object | 建议 | 学生情况（兼容 `student` / `studentProfile`） |
| `student_profile.grade` | string | 否 | 年级，如 `三年级` |
| `student_profile.current_score` | number\|string | 否 | 当前分数 |
| `student_profile.target_score` | number\|string | 否 | 目标分数 |
| `student_profile.study_history` | string | 否 | 学习历史（教材、进度、考试、习惯等） |
| `student_profile.traits` | string | 否 | 后台自由输入的学生特点（如「喜欢用例子讲故事」「比较急躁」） |
| `focus_points` | string[] | 否 | 需要强调的子点 |
| `question_count` | number | 否 | 题量，默认 `6`，最大 `20` |
| `question_types` | string[] | 否 | `choice` / `blank` / `translation`；默认三类都出 |

### 出参

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 成功为 `true` |
| `model` | string | 实际调用模型 |
| `usage` | object | token 用量 |
| `data.knowledge_point` | string | 回显知识点 |
| `data.explanation_markdown` | string | 讲解全文（Markdown） |
| `data.questions` | array | 题目列表 |

`data.questions[]`：

| 字段 | 说明 |
|------|------|
| `id` | 如 `q1` |
| `type` | `choice` \| `blank` \| `translation` |
| `stem` | 题干 |
| `options` | 选择题为 4 项；其它为 `null` |
| `answer` | 答案（选择为 `A`/`B`/`C`/`D`） |
| `explanation` | 解析 |

### 示例请求

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/drill' \
  -H 'Content-Type: application/json' \
  -d '{
    "knowledge_point": "现在进行时",
    "student_profile": {
      "grade": "三年级",
      "current_score": 110,
      "target_score": 135,
      "study_history": "孩子一直学剑桥英语教材，从 KIDS BOX 1 开始，目前学到 THINK 1 Unit 9。每周六下午线下课 1.5 小时。校内成绩中上，译林教材，每天有英语课。2026 年 3 月考过 KET，听力错 5 题、阅读错 10 题。作业认真，会主动背单词，但性格有些拖延，自主学习习惯不足，每天学习 0.5–1 小时。",
      "traits": "喜欢用例子、讲故事；有点急躁"
    },
    "question_count": 6,
    "question_types": ["choice", "blank", "translation"]
  }'
```

### 示例响应（节选）

```json
{
  "ok": true,
  "model": "qwen3.8-max",
  "usage": {
    "token_count": 6800,
    "input_count": 1200,
    "output_count": 5600
  },
  "data": {
    "knowledge_point": "现在进行时",
    "explanation_markdown": "## 一、现在进行时是什么？\n\n简单说：表示**此刻正在发生**的动作……\n",
    "questions": [
      {
        "id": "q1",
        "type": "choice",
        "stem": "Look! The boys ______ football on the playground.",
        "options": [
          "A. play",
          "B. plays",
          "C. are playing",
          "D. is playing"
        ],
        "answer": "C",
        "explanation": "Look! 提示此刻正在发生，boys 为复数，用 are playing。"
      },
      {
        "id": "q2",
        "type": "blank",
        "stem": "She __________ (do) her homework now.",
        "options": null,
        "answer": "is doing",
        "explanation": "now 表进行中，主语 she 用 is + doing。"
      },
      {
        "id": "q3",
        "type": "translation",
        "stem": "中译英：他们正在看电影。",
        "options": null,
        "answer": "They are watching a film.",
        "explanation": "are + watching 表示正在看。"
      }
    ]
  }
}
```

### 错误码

| code | HTTP | 说明 |
|------|------|------|
| `4000` | 400 | 缺少 `knowledge_point` |
| `5000` | 500 | 模型调用或 JSON 解析失败 |

---

## 推荐调用顺序

1. 单元结束后把 `unit_review` POST 到 `/v1/grammar/assess`，拿到 `knowledge_points`。
2. 按 `priority` 依次（或并行）调用 `/v1/grammar/drill`，`knowledge_point` 用列表里的 `title`，并带上该生的 `student_profile`。
3. 前端渲染 `explanation_markdown`；练习区解析 `questions`（已含答案，注意展示时机）。
