# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

This is `english-coze-mvp` — a prompt-engineering & bot-management toolkit for three Coze (扣子) AI bots (Learning Plan, Image Homework Grading, Oral Assessment). There are **no self-hosted services** — all scripts are API clients targeting the remote Coze platform.

### Prerequisites

- **Node.js ≥ 18** (ESM; nvm is available, `nvm install 20` works)
- **npm** as the package manager (lock file is `package-lock.json`)
- **`COZE_API_TOKEN`** must be set in `.env` (copy from `.env.example`). Without it, every API-touching script fails.

### Key commands (see `package.json` for full list)

| Command | What it does | Needs API? |
|---------|-------------|------------|
| `npm run coze:build-plan` | Sync slim `learning-plan-head.md` → `learning-plan.md` | No |
| `npm run coze:spaces` | Lists Coze workspaces | Yes |
| `npm run coze:push-plan` | Build + push prompt to Plan bot | Yes |
| `npm run coze:push-oral` | Push oral prompt | Yes |
| `npm run coze:push-image` | Push image prompt | Yes |
| `npm run coze:debug-plan` | Call plan bot + 校验 system_task_pool / sourceRef | Yes |

### Gotchas

- **`.env` setup**: The `COZE_API_TOKEN` environment variable should be written into `/workspace/.env`. The file is `.gitignore`-d.
- **No lint, build, or test system**: There is no ESLint, TypeScript, build step, or automated test suite. The codebase is plain Node.js ESM (`.mjs` files); verification is done by manually pushing prompts and trying the bots in the Coze console.
- **Python is optional**: Only needed for `npm run coze:export-builtin` (Excel → Markdown export). The exported file is already committed.

### Workflow preferences

- **交付面**：Prompt/脚本改完后推 Coze（及如有的线上服务）即可；不要为联调另存 `tmp/`、截图复现产物、额外说明文档等过程文件。
- **少写文档**：除非用户明确要求，不要同步改 `API.md` / README 等；以 `coze/prompts/*` 与推送结果为准。
- **改完即提交并推送**：用户要求的功能改动完成后，自动 `git commit` 相关源码（不含 `.env`、密钥、过程产物），并 `git push` 到当前分支远程。
