# 词汇 / 语法薄弱点接口（Qwen）

覆盖三个能力：**单元总评 + 知识点列表**（含 PET Test 总结与官方量表换算）、**知识点讲解 + 出题**、**知识点口播短视频（异步）**。文本默认 `qwen3.8-max`（`QWEN_TEXT_MODEL` 可覆盖）；口播视频文案与生图编排均优先 Cursor **`grok-4.5`**（`fast` 关闭；生图多路并发且每路复用 Agent；**不用 AiHubMix**），TTS 用百炼 CosyVoice，本机 ffmpeg 合成后上传 OSS。

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

**PET Test 总结**也走本接口（不另开 URL）：当入参可识别为 PET 且带有四项原始分时，服务端按剑桥官方规则**先算量表分/等级**，再交给模型写总评；算分结果回传 `data.pet_score_report`。

### 入参

Body 即为单元学习 JSON（与业务侧 `unit_review` 同结构）。也可包在 `unit_review` 或 `input` 字段下。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | string | 是 | 单元，如 `Unit3`；PET 常见 `Test1` |
| `curriculum` / `course` | string | 否 | 如 `PET` / `think2`；含 `PET` 时启用 PET 算分 |
| `totalTaskCount` | number | 否 | 任务总数（可与各 type 之和略有出入） |
| `taskTypes` | array | 是 | 按类型聚合的学习数据，非空 |
| `taskTypes[].type` | string | 是 | 如 `listening` / `oral` / `word_cn_to_en` |
| `taskTypes[].typeLabel` | string | 否 | 中文标签 |
| `taskTypes[].taskCount` | number | 否 | 该类型任务数 |
| `taskTypes[].homework` | object | 否 | 见下 |
| `pet_scores` | object | PET 建议 | `{ reading, writing, listening, speaking }` 原始分；也可写在各 `homework.rawScore` |

`homework` 常见字段（按类型出现，缺省即可）：

- 无作业：`hasHomework: false`
- 计数：`totalQuestions` / `totalWords` / `totalSentences`、`correctCount`、`wrongCount`
- 词汇错词：`wrongWords: string[]`
- 错题：`wrongQuestions: [{ question, studentAnswer, correctAnswer, explanation }]`（字段可不全）
- 口语：`averageScore`、`grammarIssues: [{ issue, suggestion }]`
- PET 原始分：`rawScore` / `score`（阅读满分 32、写作 40、听力 25、口语 30）；口语也可传 `speaking_dimensions`

输入中的 `instruction` 若存在会被忽略，任务以服务端 Prompt 为准。

PET 识别条件（满足其一且能抽出至少一项原始分即算分）：`curriculum`/`course` 含 PET、或存在 `pet_scores`、或 `unit` 形如 `Test1`。

### 出参

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | boolean | 成功为 `true` |
| `model` | string | 实际调用模型 |
| `usage` | object | `token_count` / `input_count` / `output_count` |
| `data.summary` | object | 总评 |
| `data.knowledge_points` | array | 知识点列表 |
| `data.pet_score_report` | object \| 缺省 | 仅 PET 且成功算分时有；服务端确定性结果，勿再让模型改算 |

`data.summary`：

| 字段 | 说明 |
|------|------|
| `unit_label` | 单元标签 |
| `overall_assessment` | 总评正文（PET 时须含综合量表分与等级） |
| `strengths` | 优点 |
| `priority_focus` | 优先攻克方向 |
| `task_highlights` | 各类型一句摘要 |
| `assumptions` | 推断说明 |
| `pet_overall_scale` | PET 综合量表分（有算分时由服务端回填） |
| `pet_overall_label_zh` | PET 综合等级文案（有算分时由服务端回填） |

`data.pet_score_report`（PET）：

| 字段 | 说明 |
|------|------|
| `exam` | 固定 `"PET"` |
| `skills.<skill>` | `reading` / `writing` / `listening` / `speaking`（有原始分才出现） |
| `skills.<skill>.raw` | 原始分 |
| `skills.<skill>.max_raw` | 满分（32 / 40 / 25 / 30） |
| `skills.<skill>.scale` | 量表分（可含小数，供平均） |
| `skills.<skill>.scale_rounded` | 量表分四舍五入 |
| `skills.<skill>.label_zh` | `卓越` / `优秀` / `通过` / `不通过` |
| `skills.<skill>.cambridge_grade` | `Grade A/B/C` 或 `null`（未过 B1） |
| `skills.<skill>.cefr` | `B2` / `B1` / `A2` / `null` |
| `overall` | 四项齐全时才有；否则为 `null` |
| `overall.scale` | 综合量表分（四项 `scale` 平均后四舍五入） |
| `overall.label_zh` | 如 `通过 Grade C` |
| `overall.cefr` | 证书对应 CEFR |
| `overall.certificate` | 是否发证 |
| `missing_skills` | 未提供原始分的技能名数组 |
| `notes_zh` | 换算说明（展示用） |

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

### PET 入参示例（仍调同一 URL）

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/assess' \
  -H 'Content-Type: application/json' \
  -d '{
    "unit": "Test9",
    "curriculum": "PET",
    "totalTaskCount": 6,
    "pet_scores": {
      "reading": 28,
      "writing": 29,
      "listening": 20,
      "speaking": 24
    },
    "taskTypes": [
      {
        "type": "reading",
        "typeLabel": "阅读",
        "taskCount": 1,
        "homework": {
          "rawScore": 28,
          "wrongQuestions": [
            {
              "question": "Part 5 gap 12",
              "explanation": "词汇搭配错误"
            }
          ]
        }
      },
      {
        "type": "writing",
        "typeLabel": "写作",
        "taskCount": 1,
        "homework": {
          "rawScore": 29,
          "wrongQuestions": [
            {
              "explanation": "词汇和句式多样化不足"
            }
          ]
        }
      },
      {
        "type": "oral",
        "typeLabel": "口语",
        "taskCount": 1,
        "homework": {
          "rawScore": 24,
          "grammarIssues": [
            {
              "issue": "讲过去的事情动词忘记变成过去式",
              "suggestion": "注意过去时一致性"
            }
          ]
        }
      },
      {
        "type": "listening",
        "typeLabel": "听力",
        "taskCount": 1,
        "homework": {
          "rawScore": 20,
          "wrongQuestions": [
            {
              "question": "Part 4",
              "explanation": "细节遗漏"
            }
          ]
        }
      }
    ]
  }'
```

成功时 `data.pet_score_report.overall.scale` 应为 `152`（通过 Grade C）；总评正文须与此一致。

### PET 示例响应（节选）

```json
{
  "ok": true,
  "model": "qwen3.8-max",
  "usage": {
    "token_count": 3800,
    "input_count": 1600,
    "output_count": 2200
  },
  "data": {
    "summary": {
      "unit_label": "Test9",
      "overall_assessment": "本 Test 综合量表分 152，证书等级为通过 Grade C（合格线 140，距优秀 153 差 1 分）。阅读 28→约 157（优秀）、口语 24→153（优秀）相对更好；写作 29、听力 20 均为通过档，写作句式多样与听力 Part4 细节仍是短板。建议优先补写作语言准确性与听力长对话细节。",
      "strengths": ["阅读接近卓越线", "口语已达优秀档"],
      "priority_focus": "写作句式多样与听力 Part4 细节",
      "task_highlights": [
        {
          "type": "reading",
          "typeLabel": "阅读",
          "note": "原始分 28，量表约 157，等级优秀；Part5 词汇搭配仍有错"
        },
        {
          "type": "writing",
          "typeLabel": "写作",
          "note": "原始分 29，量表约 149，等级通过；句式多样化不足"
        },
        {
          "type": "oral",
          "typeLabel": "口语",
          "note": "原始分 24，量表 153，等级优秀；过去时一致性需巩固"
        },
        {
          "type": "listening",
          "typeLabel": "听力",
          "note": "原始分 20，量表约 149，等级通过；Part4 细节遗漏"
        }
      ],
      "assumptions": [],
      "pet_overall_scale": 152,
      "pet_overall_label_zh": "通过 Grade C"
    },
    "knowledge_points": [
      {
        "id": "kp_1",
        "title": "一般过去时动词变形",
        "category": "grammar",
        "priority": "high",
        "reason": "口语指出讲过去的事情忘记用过去式",
        "focus_points": ["规则动词 -ed", "常见不规则过去式"],
        "evidence_types": ["oral"],
        "suggested_question_types": ["choice", "blank", "translation"]
      },
      {
        "id": "kp_2",
        "title": "写作词汇与句式多样化",
        "category": "vocabulary",
        "priority": "medium",
        "reason": "写作反馈提到词汇和句式多样化不足",
        "focus_points": ["同义替换", "从句补充细节"],
        "evidence_types": ["writing"],
        "suggested_question_types": ["translation", "blank"]
      }
    ],
    "pet_score_report": {
      "exam": "PET",
      "skills": {
        "reading": {
          "skill": "reading",
          "raw": 28,
          "max_raw": 32,
          "scale": 156.5,
          "scale_rounded": 157,
          "label_zh": "优秀",
          "cambridge_grade": "Grade B",
          "cefr": "B1"
        },
        "writing": {
          "skill": "writing",
          "raw": 29,
          "max_raw": 40,
          "scale": 149.28571428571428,
          "scale_rounded": 149,
          "label_zh": "通过",
          "cambridge_grade": "Grade C",
          "cefr": "B1"
        },
        "listening": {
          "skill": "listening",
          "raw": 20,
          "max_raw": 25,
          "scale": 148.66666666666666,
          "scale_rounded": 149,
          "label_zh": "通过",
          "cambridge_grade": "Grade C",
          "cefr": "B1"
        },
        "speaking": {
          "skill": "speaking",
          "raw": 24,
          "max_raw": 30,
          "scale": 153,
          "scale_rounded": 153,
          "label_zh": "优秀",
          "cambridge_grade": "Grade B",
          "cefr": "B1"
        }
      },
      "overall": {
        "scale": 152,
        "average_exact": 151.86309523809524,
        "label_zh": "通过 Grade C",
        "cambridge_grade": "Grade C",
        "cefr": "B1",
        "certificate": true,
        "formula_zh": "总分 = (阅读量表分 + 写作量表分 + 听力量表分 + 口语量表分) ÷ 4，四舍五入取整"
      },
      "missing_skills": [],
      "notes_zh": [
        "四项权重相等，各占 25%",
        "写作：两篇作文各 0–20（四维各 0–5），原始满分 40",
        "口语原始分 = 四项分项之和 + 整体表现×2，满分 30",
        "中间原始分按锚点线性插值；官方完整对照表未公开时与证书可能有 ±1 偏差"
      ]
    }
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

## 3. 知识点口播短视频（异步）

只把**讲解**做成竖屏口播短视频（目标 **1–3 分钟**，高教学密度），**不含题目**。入参与第二节 `/v1/grammar/drill` 一致。

成片合成后上传到**阿里云 OSS**（`nba-dev-sh` / 前缀 `wenbo`）。当前 Bucket 为**私有**，`video_url` 为**签名 HTTPS**（默认约 7 天，查询接口会刷新签名），流量走 OSS 不走业务机。未配置 OSS 时才回退本服务 `/file`。

说明：控制台里的 CNAME `nba-dev-sh.cn-shanghai.taihangpfm.cn` 目前证书与域名不匹配，暂用默认 `*.oss-cn-shanghai.aliyuncs.com` 签名地址；CNAME 证书配好后可改 `OSS_URL_MODE=public` + `OSS_PUBLIC_BASE_URL`。

### 3.1 创建任务

`POST /v1/grammar/video` → HTTP **202**

入参字段同第二节（`knowledge_point` 必填；`student_profile` / `focus_points` 等可选；`question_*` 可传但视频链路忽略题目）。

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/video' \
  -H 'Content-Type: application/json' \
  -d '{
    "knowledge_point": "现在进行时",
    "student_profile": {
      "grade": "三年级",
      "traits": "喜欢用例子讲故事"
    },
    "focus_points": ["be + doing", "Look!/now 线索"]
  }'
```

出参：

```json
{
  "ok": true,
  "job_id": "vid_...",
  "status": "queued",
  "poll_url": "/v1/grammar/video/vid_..."
}
```

### 3.2 查询任务

`GET /v1/grammar/video/:jobId`

| 字段 | 说明 |
|------|------|
| `status` | `queued` / `running` / `succeeded` / `failed` |
| `progress` | `queued` / `drill` / `script` / `images` / `tts` / `compose` / `upload` / `done` |
| `video_url` | 成功时的可播放地址（OSS 签名 URL；查询时刷新） |
| `expires_at` | 当前签名过期时间（私有桶）；公有读时可为 `null` |
| `error` | 失败原因 |

建议每 5–10 秒轮询，直至 `succeeded` / `failed`。单次可能数分钟。

### 3.3 播放

优先直接使用查询结果里的 `video_url`（OSS）。  
兼容：`GET /v1/grammar/video/:jobId/file` 仍可拉本机缓存（若尚未清理）。

对象路径约定：`wenbo/grammar-video/{job_id}.mp4`。

### 流水线说明

1. **讲解 + 分镜文案**：Cursor Cloud **`grok-4.5`**（`fast=false`；未配置则回退 Qwen）。分镜按**课堂教学**组织，**无吸睛引子 / cold_open**
2. **生图**：Cursor 内置 GenerateImage（编排默认 **`grok-4.5`**；`GRAMMAR_VIDEO_IMAGE_CONCURRENCY` 路并发，每路复用同一 Agent；未配置则回退百炼万相）。**不使用 AiHubMix**
3. TTS：百炼 CosyVoice（默认音色 **`longxiaoxia_v2` 温柔女声**）；合成：本机 ffmpeg；上传：阿里云 OSS 签名 URL
4. 目标时长 **1–3 分钟**，分镜约 5–8 页，强调例句 / 易混对比 / 口诀；整体制作耗时约 **10–20 分钟**（生图为主）
### 错误码

| code | HTTP | 说明 |
|------|------|------|
| `4000` | 400 | 缺少 `knowledge_point` |
| `4040` | 404 | 任务不存在或已清理 |
| `4090` | 409 | 视频尚未就绪（访问 `/file` 时） |
| `4100` | 410 | 视频已过期 |

---

## 推荐调用顺序

1. 单元 / PET Test 结束后把 `unit_review` POST 到 `/v1/grammar/assess`，拿到 `knowledge_points`（PET 时另有 `pet_score_report`）。
2. 按 `priority` 依次（或并行）调用 `/v1/grammar/drill`，`knowledge_point` 用列表里的 `title`，并带上该生的 `student_profile`。
3. 前端渲染 `explanation_markdown`；练习区解析 `questions`（已含答案，注意展示时机）。PET 分数展示优先用 `pet_score_report`，不要解析总评正文里的数字。
4. 若需要口播短视频：对同一知识点 POST `/v1/grammar/video`，轮询 `GET /v1/grammar/video/:jobId`，用 `video_url`（OSS）播放。
