# 三智能体 · 控制台手动测试用例（THINK1 素材）

在扣子控制台分别打开对应智能体，在**调试 / 预览**里按下面操作。  
附件路径均相对于仓库根目录的 `THINK1/`。

---

## 1. 英语学习-计划生成（`7627028738093596712`）

**不要上传文件**，只在输入框粘贴下面整段（内容来自 `学生信息输入(3).xlsx` 中「吴同学」一行，略作排版）：

```
curriculum: think1

student_profile:
学生：吴同学，三年级，女，无锡市大桥小学。

英语基础：剑桥体系，从 KIDS BOX1 学到目前 THINK1 第九单元；每周六下午一次线下课，每次一个半小时。学校用译林教材，每天都有英语课。2026年3月 KET 模拟：听力错 5 个、阅读错 10 个。能完成作业、自觉背默单词；性格比较拖拉，难以自主学习。每天可学习约半小时到一小时。

目标：小学三年级暑假 KET 达到卓越；小学五年级暑假 PET 达到优秀。

task_pool（节选，业务可贴全量或子集；本期不走 RAG）：
Welcome-PartA-01 | 必做：练习册P4 等 | 口语：主题词汇认读

请按人设仅输出学习计划 JSON。
```

**预期**：可解析 JSON；含 `meta` 与 `days[]`（条数与 `task_pool` 课节条数一致；`day_index` 递增，无公历 `date`）；`lesson_code` 来自 `task_pool`；说明文字为**简体中文**。

---

## 2. 英语学习-图片批改（`7627028840921219091`）

**上传图片**（控制台里选「图片」或按产品要求上传），使用文件：

`THINK1/think1作业问答/微信图片_20260330202239_986_322.jpg`  
（纸质练习：Double genitive、Past simple 等选择题与填空）

**文字说明**（可粘贴在同一轮或说明里，可选）：

```
教材：THINK1。题号见印刷。请按人设只输出批改 JSON；输出字段需含 image_summary_zh、items、overall_comment_zh（全中文面向家长）。
```

**预期**：JSON 含 `items`；`limitations` 可能因 OCR/手写非空；阅读题若未附带 passage，`passage_quote` 可能为空并在 `limitations` 说明。

---

## 3. 英语学习-口语批改（`7627028747031642150`）

**上传音频**：`THINK1/think1作业问答/新录音 28.m4a`  
（若控制台仅支持 wav，可先用本地转码：`ffmpeg -i "新录音 28.m4a" -acodec pcm_s16le -ar 16000 -ac 1 oral.wav` 再上传 `oral.wav`。）

**文字说明**（与 `think1作业问答/e71156dc-a233-4131-878d-01eda7a67077.png` 里老师反馈语境一致：强调 like + doing；可照抄下面）：

```
assignment: 口语作业：介绍自己的爱好或日常活动。请注意使用 like + gerund（如 like reading books），不要 like + 动词原形。
请按人设只输出 JSON（含 dimensions 五维与 holistic 总评）。
```

**预期**：JSON 含 `transcript`、`dimensions`（五维）、`holistic_summary_zh`、`language` 等；若听不清，见 `limitations`。

---

## 对照表

| 智能体 | 素材来源 | 本用例用到的文件 |
|--------|-----------|------------------|
| 计划生成 | `学生信息输入(3).xlsx` → 吴同学 | 仅文字（上贴） |
| 图片批改 | `think1作业问答` 作业照 | `微信图片_20260330202239_986_322.jpg` |
| 口语批改 | `新录音 28.m4a` + 老师反馈截图语境 | `新录音 28.m4a`（或转 wav） |

`bot_id` 见 `coze/bots.registry.json` 或 `docs/API.md`。
