#!/usr/bin/env bash
#
# 更新部署：git pull 最新代码后调用 deploy.sh 完成依赖安装与 pm2 重启。
# 用法（在服务器仓库目录内执行）：
#   bash deploy/update.sh [git_branch]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANCH="${1:-main}"

cd "$APP_DIR"
echo "[update] git pull origin ${BRANCH} ..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

bash "$SCRIPT_DIR/deploy.sh"
