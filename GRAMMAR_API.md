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
| 显式标记 | `curriculum: "think"`（或 `course`） | `curriculum: "PET"`（或 `course: "PET"`） |
| 接口做什么 | 任务完成度总结 + 薄弱点 + 知识点列表 | **与 Think 相同**，并多一块**成绩展示** `pet_score_report` |
| 成绩怎么来 | 无 | **前端不用传分数**。有 `correctCount` + 总题数即可；服务端按「每题等分」换算到该科官方满分，再套剑桥量表 |
| 前端不要传 | — | 换算标准、`rawScore`、独立 `pet_scores` 都**不必传** |

未传 `curriculum`/`course` 时按 `think`。建议 Allen **显式**传 `think` 或 `PET`。

### 入参

Body 即现有 `unit_review`（也可包在 `unit_review` / `input` 下）。Think / PET **同一套字段**。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `unit` | string | 是 | Think：`Unit3`；PET：`Test1` / `Test9` 等 |
| `curriculum` / `course` | string | 建议 | `"think"` 或 `"PET"` |
| `totalTaskCount` | number | 否 | 任务总数 |
| `taskTypes` | array | 是 | 按类型聚合，非空 |
| `taskTypes[].type` | string | 是 | 见下 |
| `taskTypes[].typeLabel` | string | 否 | 中文标签 |
| `taskTypes[].taskCount` | number | 否 | 该类型任务数 |
| `taskTypes[].homework` | object | 否 | 见下 |

PET 科目识别（`type` / `typeLabel`）：

| 科 | 推荐 type | 也认 |
|----|-----------|------|
| 阅读 | `reading` | `image_free_upload`、标签含「书面」「阅读」 |
| 写作 | `writing` | 标签含「写作」「作文」 |
| 听力 | `listening` | 标签含「听力」 |
| 口语 | `oral` / `speaking` | 标签含「口语」 |

`homework`（有则传）：

- **成绩用（PET）优先**：`correctCount` + `totalQuestions`（或 `totalWords` / `totalSentences`；没有总数时可用 `correctCount + wrongCount`）
- **兼容写法**（无对题数时仍尽量出分）：
  - `averageScore` / `holistic_score_1_to_5` / `score`（≤5 时按 1–5 刻度：`round(分/5×该科满分)`；口语满分 30、写作 40）
  - `accuracy` / `correctRate`（0–1 或 0–100%）
  - 口语/写作 `dimensions[]` 或 `exam_rubric.dimensions[]` 的分项分均值
  - 明确原始分：`rawScore` / `petRaw` / `totalScore`
- 其它照旧：`wrongQuestions`、`wrongWords`、`grammarIssues`、`hasHomework` 等

**等分换算**（服务端）：

`原始分 = round(correctCount / 总题数 × 该科满分)`  
满分：阅读 32、写作 40、听力 25、口语 30。

例：听力对 20 / 共 25 → 原始分 20；阅读对 28 / 共 32 → 28；若只有 10 题对了 8 → 阅读原始分 `round(8/10×32)=26`。  
口语仅有 `averageScore: 3` → `round(3/5×30)=18`。

`instruction` 若存在会被忽略。

### 出参

| 字段 | 说明 |
|------|------|
| `ok` / `model` / `usage` | 同其他接口 |
| `data.summary` | 总评 |
| `data.knowledge_points[]` | 待巩固知识点 |
| `data.pet_score_report` | **仅 PET** 且至少抽到一科对题数据时有；前端成绩展示用这个 |

`data.summary` 主要字段：`unit_label`、`overall_assessment`、`strengths`、`priority_focus`、`task_highlights`、`assumptions`；有综合分时另有 `pet_overall_scale`、`pet_overall_label_zh`。

`data.pet_score_report` 要点：`skills.*`（`raw` / `scale_rounded` / `label_zh`）、四科齐全时的 `overall`、`missing_skills`（缺数据的科）。

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

### PET 入参示例（同一 URL；用对题数，不必传分）

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/assess' \
  -H 'Content-Type: application/json' \
  -d '{
    "unit": "Test9",
    "course": "PET",
    "totalTaskCount": 4,
    "taskTypes": [
      {
        "type": "image_free_upload",
        "typeLabel": "书面作业",
        "taskCount": 1,
        "homework": {
          "totalQuestions": 32,
          "correctCount": 28,
          "wrongCount": 4,
          "wrongQuestions": [{ "question": "Part 5", "explanation": "词汇搭配错误" }]
        }
      },
      {
        "type": "writing",
        "typeLabel": "写作",
        "taskCount": 1,
        "homework": {
          "totalQuestions": 40,
          "correctCount": 29,
          "wrongCount": 11
        }
      },
      {
        "type": "listening",
        "typeLabel": "听力",
        "taskCount": 1,
        "homework": {
          "totalQuestions": 25,
          "correctCount": 20,
          "wrongCount": 5
        }
      },
      {
        "type": "oral",
        "typeLabel": "口语",
        "taskCount": 1,
        "homework": {
          "averageScore": 3,
          "grammarIssues": [
            { "issue": "主谓不一致", "suggestion": "He likes..." }
          ]
        }
      }
    ]
  }'
```

上例换算后阅读 / 听力 / 口语原始分为 28 / 20 / 18（`averageScore=3` → `round(3/5×30)=18`）；写作未传则进 `missing_skills`，有数据的科仍会出分。四科齐全时才有 `overall`。

### 错误码

| code | HTTP | 说明 |
|------|------|------|
| `4000` | 400 | 缺少 `unit` 或空的 `taskTypes` |
| `5000` | 500 | 模型调用或 JSON 解析失败 |

---

## 2. 知识点讲解 + 出题

`POST /v1/grammar/drill`

输入：知识点 + 学生情况 + **讲解风格**。输出按风格组织的讲解 Markdown，以及结构化题目（含答案）。

**学生特点必跟**：只看 `student_profile.traits`。学习历史里的 PET/KET **不会**再把讲解锁成考试腔。有 traits 时服务端会编译 `trait_voice`（必须执行的口吻清单），输出含 `voice_adaptation_zh` / `voice_tags`，方便看出差异。无 traits 时按小学高年级默认。

**出题难度对标课程材料**：请传 `textbook` + `unit_ref`（Allen 已加）。Think 2 的总结就出 Think 2 / B1 题，PET 就出 PET 题。学生档案里的年级、「目前学 THINK1」只影响口吻，**不会**把题目降到更低教材。

同一知识点可切换四种信息组织方式（内容要点等价，结构不同），对齐 `tmp/everyone_vs_all_四种讲解风格对比.docx`：

| `explanation_style` | 名称 | 讲解骨架 | 适合 |
|---------------------|------|----------|------|
| `logical` | 简洁逻辑型 | 规则一览表 → 判断流程 → 例外 → 错题归因 | 理性、要框架 |
| `fun` | 有趣吸引型 | 画面/人设 → 用法+口诀 → 踩坑预警 | 要趣味、注意力短（**默认**） |
| `visual` | 视觉图表型 | 对照表 → 流程图 → 标签编码 → 图示例句 | 看图更快懂 |
| `exam` | 考试速记型 | 口诀 → 3 条踩分点 → 答题模板 → 秒杀/丢分 | 应试得分 |

未传风格时：服务端看 `traits` / `study_history` 关键词推断；仍无法判断则用 `fun`。

### 入参

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `knowledge_point` | string | 是 | 知识点，如 `everyone 与 all 的用法`（兼容 `knowledgePoint`） |
| `explanation_style` | string | 否 | `logical` / `fun` / `visual` / `exam`（兼容中文名如 `有趣吸引型`；也可写在 `student_profile` 内） |
| `student_profile` | object | 建议 | 学生情况（兼容 `student` / `studentProfile`） |
| `student_profile.grade` | string | 否 | 年级 |
| `student_profile.current_score` | number\|string | 否 | 当前分数 |
| `student_profile.target_score` | number\|string | 否 | 目标分数 |
| `student_profile.study_history` | string | 否 | 学习历史 |
| `student_profile.traits` | string | 否 | **学生特点（强烈建议）**，如「喜欢用例子讲故事」「比较急躁」「应试刷题」。有则文字讲解必贴合；也可用于推断风格 |
| `textbook` | string | 建议 | 当前课程教材，如 `THINK2` / `PET`（兼容 `book`）。**出题难度对标此字段**，不按年级或 `study_history` 里更低的旧教材降级 |
| `unit_ref` | string | 建议 | 当前单元，如 `Unit3`（兼容 `unitRef`） |
| `curriculum` | string | 否 | `think` / `PET` / `KET`；无 `textbook` 时也可用来估级别 |
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
| `data.explanation_style` | string | 实际使用的风格（服务端裁定后回写） |
| `data.explanation_markdown` | string | 讲解全文（Markdown，结构随风格变化） |
| `data.questions` | array | 题目列表（题型与风格无关） |
| `data.material` | object | 有 `textbook` 等时回写：`textbook` / `unit_ref` / `cefr` / `label_zh` |

`data.questions[]`：`id` / `type` / `stem` / `options` / `answer` / `explanation`（选择题 `options` 为 4 项，其它为 `null`）。

### 示例请求

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/drill' \
  -H 'Content-Type: application/json' \
  -d '{
    "knowledge_point": "everyone 与 all 的用法",
    "explanation_style": "fun",
    "student_profile": {
      "grade": "五年级",
      "traits": "喜欢用例子、讲故事；有点急躁"
    },
    "question_count": 6,
    "question_types": ["choice", "blank", "translation"]
  }'
```

换风格只需改 `explanation_style`（如 `"exam"` / `"logical"` / `"visual"`），其它字段可不变。

### 示例响应（节选）

```json
{
  "ok": true,
  "model": "qwen3.8-max",
  "data": {
    "knowledge_point": "everyone 与 all 的用法",
    "explanation_style": "fun",
    "explanation_markdown": "## 一、先记住一个画面\n\n**Everyone** 像「点名员」……\n",
    "questions": [
      {
        "id": "q1",
        "type": "choice",
        "stem": "Everyone ______ here.",
        "options": ["A. are", "B. is", "C. be", "D. am"],
        "answer": "B",
        "explanation": "everyone 作主语，谓语用单数 is。"
      }
    ]
  },
  "usage": { "token_count": 6800, "input_count": 1200, "output_count": 5600 }
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

同样：与文字讲解共用四种风格——**有 `explanation_style`（或可由 traits 推断）时，口播分镜必须按该风格骨架排布**（logical / fun / visual / exam），不是只改语气。有 `traits` 时口播用词与画面标签还须贴合该生。

成片上传**阿里云 OSS**（Bucket `nba-dev-sh`，前缀 `wenbo`）。Bucket 为**私有**时，`video_url` 为**签名 HTTPS**（默认约 7 天；查询接口会刷新签名）。未配置 OSS 时回退本服务 `/file`。

### 3.1 创建任务

`POST /v1/grammar/video` → HTTP **202**

| 字段 | 必填 | 说明 |
|------|------|------|
| `knowledge_point` | 是 | 知识点标题 |
| `explanation_style` | 否 | **同 drill 四风格**；决定分镜页顺序（规则表/人设/流程图/口诀模板）。不传则按 traits 推断，默认 `fun` |
| `student_profile` | 否 | **建议传**。`traits` 非空时口播/画面必须按特点调整；年级影响难度 |
| `focus_points` | 否 | 优先覆盖的子点数组 |
| `question_count` / `question_types` | 否 | 视频链路忽略 |

```bash
curl -sS -X POST 'http://101.201.237.149:8000/v1/grammar/video' \
  -H 'Content-Type: application/json' \
  -d '{
    "knowledge_point": "everyone 与 all 的用法",
    "explanation_style": "exam",
    "student_profile": {
      "grade": "五年级",
      "traits": "应试刷题，注意力一般"
    },
    "focus_points": ["everyone 单数", "all + 复数名词", "不能 everyone students"]
  }'
```

四种风格分镜骨架（优先 4 页）：

| 风格 | s1 | s2 | s3 | s4 |
|------|----|----|----|----|
| `logical` | 规则对照 | 判断流程 | 例外限制 | 错题归因 |
| `fun` | 人设画面 | 场景用法 | 踩坑 ❌✅ | 口诀 |
| `visual` | 对照表 | 分支判断 | 编码/坑 | 标签例句+口诀 |
| `exam` | 口诀先背 | 踩分点 | 答题模板 | 秒杀+丢分 |
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
2. 按 `priority` 依次（或并行）调用 `/v1/grammar/drill`，`knowledge_point` 用列表里的 `title`，并带上该生的 `student_profile`，以及总结时的 `textbook` / `unit_ref`（难度对标教材）。
3. 前端渲染 `explanation_markdown`；练习区解析 `questions`（已含答案，注意展示时机）。PET 分数展示优先用 `pet_score_report`，不要解析总评正文里的数字。调用 drill / video 时请带上该生 `student_profile.traits`，以便按特点讲。
4. 若需要口播短视频：对同一知识点 POST `/v1/grammar/video`，轮询 `GET /v1/grammar/video/:jobId`，用 `video_url`（OSS）播放。
