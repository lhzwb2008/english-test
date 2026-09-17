#!/usr/bin/env bash
#
# 通过 .deploy.env 里的账密登录 / 同步 Qwen 生产机。
# 用法（仓库根目录）：
#   npm run qwen:ssh              # 交互登录
#   npm run qwen:sync             # rsync 代码并执行 deploy/deploy.sh（不覆盖远端 .env）
#   bash scripts/qwen-remote.sh update [branch]
#   bash scripts/qwen-remote.sh status|logs
#   bash scripts/qwen-remote.sh exec -- <远端命令...>
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.deploy.env}"

die() { echo "[qwen-remote] $*" >&2; exit 1; }

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${1:-}" == "help" ]]; then
  sed -n '2,12p' "$0"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ROOT/.deploy.env.example" ]]; then
    cp "$ROOT/.deploy.env.example" "$ENV_FILE"
    die "已生成 $ENV_FILE，请填入 DEPLOY_USER / DEPLOY_PASSWORD 后重试。"
  fi
  die "缺少 $ENV_FILE（可从 .deploy.env.example 复制）"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DEPLOY_HOST:?请在 .deploy.env 填写 DEPLOY_HOST}"
: "${DEPLOY_USER:?请在 .deploy.env 填写 DEPLOY_USER}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/qwen-oral-proxy}"

if [[ -z "${DEPLOY_PASSWORD:-}" ]]; then
  die "请在 $ENV_FILE 填写 DEPLOY_PASSWORD（该文件不会进 Git）"
fi

if ! command -v sshpass >/dev/null 2>&1; then
  die "未找到 sshpass，请先安装后再试"
fi

export SSHPASS="$DEPLOY_PASSWORD"

SSH_BASE=(
  ssh
  -p "$DEPLOY_SSH_PORT"
  -o StrictHostKeyChecking=accept-new
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
  -o NumberOfPasswordPrompts=1
)

remote_ssh() {
  sshpass -e "${SSH_BASE[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
}

remote_sync() {
  sshpass -e rsync -az \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude .deploy.env \
    --exclude .venv \
    --exclude tmp \
    --exclude logs \
    --exclude 'server/data/request-logs/**' \
    --exclude 'server/data/video-jobs/*.json' \
    -e "ssh -p ${DEPLOY_SSH_PORT} -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1" \
    "$ROOT/" "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
}

cmd="${1:-ssh}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$cmd" in
  ssh|login)
    echo "[qwen-remote] 登录 ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_SSH_PORT}"
    remote_ssh -t
    ;;
  sync|rsync|deploy)
    echo "[qwen-remote] rsync → ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
    remote_sync
    echo "[qwen-remote] 远端执行 deploy/deploy.sh"
    remote_ssh "cd $(printf %q "$DEPLOY_PATH") && bash deploy/deploy.sh"
    ;;
  update)
    branch="${1:-main}"
    echo "[qwen-remote] 远端 update.sh ${branch}"
    remote_ssh "cd $(printf %q "$DEPLOY_PATH") && bash deploy/update.sh $(printf %q "$branch")"
    ;;
  status)
    remote_ssh "pm2 status"
    ;;
  logs)
    remote_ssh "pm2 logs ${PM2_APP_NAME:-qwen-oral-proxy} --lines 80"
    ;;
  exec|cmd|--)
    [[ $# -gt 0 ]] || die "用法: bash scripts/qwen-remote.sh exec -- <远端命令>"
    remote_ssh "$@"
    ;;
  *)
    remote_ssh "$cmd" "$@"
    ;;
esac
