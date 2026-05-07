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

### Gotchas

- **`.env` setup**: The `COZE_API_TOKEN` environment variable should be written into `/workspace/.env`. The file is `.gitignore`-d.
- **No lint, build, or test system**: There is no ESLint, TypeScript, build step, or automated test suite. The codebase is plain Node.js ESM (`.mjs` files); verification is done by manually pushing prompts and trying the bots in the Coze console.
- **Python is optional**: Only needed for `npm run coze:export-builtin` (Excel → Markdown export). The exported file is already committed.
