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
| `npm run coze:build-plan` | Merges prompt files → `learning-plan.md` | No |
| `npm run coze:spaces` | Lists Coze workspaces | Yes |
| `npm run coze:push-plan` | Build + push prompt to Plan bot | Yes |
| `npm run coze:push-oral` | Push oral prompt | Yes |
| `npm run coze:push-image` | Push image prompt | Yes |
| `npm run test:smoke` | Smoke test — calls Plan bot via Chat API (~2 min) | Yes |
| `npm run test:e2e` | Full E2E — calls all 3 bots (~3-6 min) | Yes |
| `npm run verify` | Quick-verify all 3 bots (~2-6 min, needs fixture files for image/audio) | Yes |

### Gotchas

- **`.env` setup**: The `COZE_API_TOKEN` environment variable should be written into `/workspace/.env`. The file is `.gitignore`-d.
- **`test:smoke` takes ~2 minutes** because it makes a real Coze Chat API call with model inference. `test:e2e` and `verify` take even longer (3-6 min).
- **Image/audio test fixtures** (`THINK1/think1作业问答/*.jpg`, `tests/fixtures/oral_sample.wav`) are **not committed to git** (too large). The `verify` and `test:e2e` scripts gracefully skip audio tests when fixtures are missing.
- **No lint or build system**: There is no ESLint, TypeScript, or build step. The codebase is plain Node.js ESM (`.mjs` files).
- **Python is optional**: Only needed for `npm run coze:export-builtin` (Excel → Markdown export). The exported file is already committed.
