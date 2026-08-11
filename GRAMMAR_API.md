# 词汇 / 语法薄弱点接口（Qwen）

覆盖三个能力：**单元总评 + 知识点列表**（含 PET Test 总结与官方量表换算）、**知识点讲解 + 出题**、**知识点口播短视频（异步）**。文本默认 `qwen3.8-max`（`QWEN_TEXT_MODEL` 可覆盖）；口播视频**文案**优先 Cursor **`grok-4.5`**，**生图**用百炼万相 **`wan2.5-t2i-preview`**，TTS 用 CosyVoice，本机 ffmpeg 合成后上传 OSS。

## 调用说明

| 项 | 值 |
|---|---|
| **Base URL（生产）** | `http://101.201.237.149:8000` |
| **健康检查** | `GET /health` |
| **鉴权** | **无需**传 `Authorization`（访问控制由服务器网络侧维护） |
| **Content-Type** | `application/json` |
| **响应** | 非流式 JSON；业务侧直接使用返回体中的 `data` |

与口语代理相同机器、相同鉴权方式；本两接口**不走** `/v3/chat`，也**不需要**先上传文件。

耗时参考：总评约 1–3 分钟（完整 `unit_review` 偏长），讲解出题约 1–2 分钟；口播短视频异步，墙钟约 **3–6 分钟**（视 Cursor / 百炼排队）。同步接口建议客户端超时 ≥ **300s**。

---

## 1. 单元总评 + 知识点列表

`POST /v1/grammar/assess`

### 场景（Think / PET 共用同一 URL）

| | Think | PET |
|---|---|---|
| 何时 | Think 某 Unit 学完 | PET 某次 Test 考完 |
| 显式标记 | `curriculum: "think"` | `curriculum: "PET"` |
| 接口做什么 | 任务完成度总结 + 薄弱点 + 知识点列表（供下游讲解出题） | **与 Think 相同**，并多一块**成绩展示** |
| 成绩从哪来 | 无剑桥量表 | 改卷得到的各科**原始分**已在 `taskTypes[].homework` 里；服务端用内置剑桥表换成量表分/等级，回传 `pet_score_report` |
| 前端不要传 | — | **不要传换算标准**；不必再单独传 `pet_scores` 对象 |

未传 `curriculum` 时服务端按 `think` 处理。产品侧约定：**Allen 统一显式传入** `think` 或 `PET`。

### 入参

Body 即业务侧已有的 `unit_review`（也可包在 `unit_review` / `input` 下）。**Think / PET 字段结构相同**，PET 只是听说读写作业上多带改卷原始分。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | string | 是 | Think：`Unit3`；PET：`Test1` / `Test9` 等 |
| `curriculum` | string | 建议 | 显式传 `"think"` 或 `"PET"` |
| `totalTaskCount` | number | 否 | 任务总数 |
| `taskTypes` | array | 是 | 按类型聚合的学习 / 考试数据，非空 |
| `taskTypes[].type` | string | 是 | Think 如 `listening` / `oral` / `word_cn_to_en`；PET 如 `reading` / `writing` / `listening` / `speaking`（或 `oral`） |
| `taskTypes[].typeLabel` | string | 否 | 中文标签 |
| `taskTypes[].taskCount` | number | 否 | 该类型任务数 |
| `taskTypes[].homework` | object | 否 | 见下 |

`homework`（有则传，缺省即可）：

- 完成度 / 对错：`totalQuestions`、`correctCount`、`wrongCount`、`hasHomework` 等
- 错词 / 错题：`wrongWords`、`wrongQuestions[]`
- 口语：`averageScore`、`grammarIssues[]`
- **PET 改卷原始分**（成绩展示用）：写在对应科的 `homework.rawScore`（或 `score`）  
  - 阅读满分 32、写作 40、听力 25、口语 30

`instruction` 若存在会被忽略。

### 出参

| 字段 | 说明 |
|------|------|
| `ok` / `model` / `usage` | 同其他接口 |
| `data.summary` | 总评（完成情况、强弱项、各类型摘要） |
| `data.knowledge_points[]` | 待巩固词汇/语法点（供 `/v1/grammar/drill`、口播） |
| `data.pet_score_report` | **仅 PET** 且读到原始分时有：量表分 + 等级（前端成绩展示用这个，不要让模型改算） |

`data.summary` 主要字段：`unit_label`、`overall_assessment`、`strengths`、`priority_focus`、`task_highlights`、`assumptions`；PET 成功算分时另有 `pet_overall_scale`、`pet_overall_label_zh`。

`data.pet_score_report`（PET）要点：

| 字段 | 说明 |
|------|------|
| `skills.reading/writing/listening/speaking` | 各科 `raw`、`scale_rounded`、`label_zh`（卓越/优秀/通过/不通过）等 |
| `overall.scale` / `overall.label_zh` | 四科齐全时的综合量表分与等级文案（如 `通过 Grade C`） |
| `missing_skills` | 缺原始分的科目 |

### Think 入参示例

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/assess' \
  -H 'Content-Type: application/json' \
  -d '{
    "unit": "Unit3",
    "curriculum": "think",
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
          "wrongWords": ["animated film", "comedy"]
        }
      },
      {
        "type": "oral",
        "typeLabel": "口语",
        "taskCount": 4,
        "homework": {
          "averageScore": 3,
          "grammarIssues": [
            { "issue": "comedy film 泛指应用复数", "suggestion": "改为 comedy films" }
          ]
        }
      }
    ]
  }'
```

### PET 入参示例（同一 URL；多成绩展示）

与 Think 相同结构；`curriculum` 为 `PET`，听说读写作业带上**改卷原始分**即可。

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/assess' \
  -H 'Content-Type: application/json' \
  -d '{
    "unit": "Test9",
    "curriculum": "PET",
    "totalTaskCount": 6,
    "taskTypes": [
      {
        "type": "reading",
        "typeLabel": "阅读",
        "taskCount": 1,
        "homework": {
          "rawScore": 28,
          "wrongQuestions": [{ "question": "Part 5", "explanation": "词汇搭配错误" }]
        }
      },
      {
        "type": "writing",
        "typeLabel": "写作",
        "taskCount": 1,
        "homework": { "rawScore": 29 }
      },
      {
        "type": "listening",
        "typeLabel": "听力",
        "taskCount": 1,
        "homework": { "rawScore": 20 }
      },
      {
        "type": "oral",
        "typeLabel": "口语",
        "taskCount": 1,
        "homework": { "rawScore": 24 }
      }
    ]
  }'
```

上例服务端算分：`data.pet_score_report.overall.scale` = **152**（通过 Grade C）。前端成绩展示直接用 `pet_score_report`。

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

把单个知识点做成**竖屏讲解口播**（目标约 **1 分钟**、分镜 **3–5 页**），**不含题目、无吸睛引子**。入参与第二节 `/v1/grammar/drill` 一致（`question_*` 可传但视频链路忽略）。

成片上传**阿里云 OSS**（Bucket `nba-dev-sh`，前缀 `wenbo`）。Bucket 为**私有**时，`video_url` 为**签名 HTTPS**（默认约 7 天；查询接口会刷新签名）。未配置 OSS 时回退本服务 `/file`。

### 3.1 创建任务

`POST /v1/grammar/video` → HTTP **202**

| 字段 | 必填 | 说明 |
|------|------|------|
| `knowledge_point` | 是 | 知识点标题 |
| `student_profile` | 否 | 年级 / 特点等，影响例句难度与口吻 |
| `focus_points` | 否 | 优先覆盖的子点数组 |
| `question_count` / `question_types` | 否 | 视频链路忽略 |

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/video' \
  -H 'Content-Type: application/json' \
  -d '{
    "knowledge_point": "现在进行时",
    "student_profile": {
      "grade": "五年级",
      "traits": "喜欢对比记忆"
    },
    "focus_points": ["be + doing", "Look!/now 线索", "与一般现在时易混"]
  }'
```

出参：

```json
{
  "ok": true,
  "job_id": "vid_e237b79a2eca4a1198be",
  "status": "running",
  "poll_url": "/v1/grammar/video/vid_e237b79a2eca4a1198be"
}
```

### 3.2 查询任务

`GET /v1/grammar/video/:jobId`

| 字段 | 说明 |
|------|------|
| `status` | `queued` / `running` / `succeeded` / `failed` |
| `progress` | `queued` → `script` → `images` → `tts` → `compose` → `upload` → `done` |
| `video_url` | 成功时的可播放地址（OSS 签名 URL；查询时刷新） |
| `expires_at` | 当前签名过期时间 |
| `error` | 失败原因 |
| `knowledge_point` | 回显知识点 |

建议每 **5–10 秒**轮询，直至 `succeeded` / `failed`。整单约 **3–6 分钟**。

成功示例（字段节选）：

```json
{
  "ok": true,
  "job_id": "vid_e237b79a2eca4a1198be",
  "status": "succeeded",
  "progress": "done",
  "knowledge_point": "现在进行时",
  "video_url": "https://nba-dev-sh.oss-cn-shanghai.aliyuncs.com/wenbo/grammar-video/vid_....mp4?Expires=...&Signature=...",
  "expires_at": "2026-08-18T07:30:21.536Z",
  "error": null
}
```

```bash
curl -sS 'http://101.201.237.149:8000/v1/grammar/video/vid_e237b79a2eca4a1198be'
```

### 3.3 播放

优先使用查询结果里的 `video_url`（OSS）。  
兼容：`GET /v1/grammar/video/:jobId/file` 可拉本机缓存（若尚未清理）。

对象路径：`wenbo/grammar-video/{job_id}.mp4`。

### 3.4 流水线与依赖

| 步骤 | 实现 |
|------|------|
| 讲解 + 分镜文案 | **一次** Cursor Cloud **`grok-4.5`**（`fast=false`；未配置则回退 Qwen） |
| 生图 | 百炼万相 **`wan2.5-t2i-preview`**，竖屏 `960*1696`，**全部并行** |
| TTS | 百炼 CosyVoice，默认音色 **`longxiaoxia_v2`（温柔女声）** |
| 合成 / 上传 | 本机 ffmpeg → OSS 签名 URL |

相关环境变量（服务端 `.env`，勿提交密钥）：

| 变量 | 默认 / 说明 |
|------|-------------|
| `CURSOR_API_KEY` / `CURSOR_SANDBOX_REPO_URL` | Cursor 文案 |
| `CURSOR_MODEL_ID` | `grok-4.5` |
| `DASHSCOPE_API_KEY` | 百炼 TTS / 生图 |
| `DASHSCOPE_IMAGE_MODEL` | `wan2.5-t2i-preview` |
| `DASHSCOPE_IMAGE_SIZE` | `960*1696` |
| `DASHSCOPE_TTS_VOICE` | `longxiaoxia_v2` |
| `GRAMMAR_VIDEO_MAX_SLIDES` | `5`（范围 3–5） |
| `GRAMMAR_VIDEO_IMAGE_CONCURRENCY` | 默认等于页数（全并行） |
| `OSS_*` | 成片上传与签名 |

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
