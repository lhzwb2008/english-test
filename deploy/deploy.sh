#!/usr/bin/env bash
#
# 阿里云服务器一键安装/部署脚本 —— Qwen-Omni 口语批改兼容代理
#
# 幂等设计：缺依赖（Node.js / pm2）会自动安装；已具备依赖时跳过安装，直接
# npm install + pm2 restart/start 完成部署。可反复执行（更新代码后重跑即可）。
#
# 用法（在服务器上，仓库目录内执行）：
#   bash deploy/deploy.sh
#
# 可选环境变量：
#   APP_PORT         覆盖 QWEN_PROXY_PORT（默认沿用 .env 或 8787）
#   PM2_APP_NAME      pm2 进程名（默认 qwen-oral-proxy）
#   NODE_MAJOR_MIN    要求的最低 Node 主版本（默认 18）
#   SKIP_PM2_STARTUP  设为 1 可跳过 `pm2 startup`（开机自启）配置
#
set -euo pipefail

# ---------- 基础信息 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PM2_APP_NAME="${PM2_APP_NAME:-qwen-oral-proxy}"
NODE_MAJOR_MIN="${NODE_MAJOR_MIN:-18}"

log()  { echo -e "\033[1;32m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy][警告]\033[0m $*"; }
err()  { echo -e "\033[1;31m[deploy][错误]\033[0m $*" >&2; }

cd "$APP_DIR"
log "部署目录: $APP_DIR"

# ---------- 1. 识别包管理器（阿里云 Linux/CentOS 用 yum|dnf，Ubuntu/Debian 用 apt）----------
PKG_MANAGER=""
if command -v apt-get >/dev/null 2>&1; then
  PKG_MANAGER="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MANAGER="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MANAGER="yum"
else
  warn "未识别到 apt/dnf/yum，跳过系统包管理器相关自动安装步骤（假设 Node.js 已就绪）。"
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    warn "当前非 root 且无 sudo，若需要安装系统依赖可能会失败。"
  fi
fi

# ---------- 2. 检查 / 安装 Node.js ----------
need_install_node=true
if command -v node >/dev/null 2>&1; then
  current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$current_major" -ge "$NODE_MAJOR_MIN" ]; then
    log "检测到 Node.js $(node -v)（>= v${NODE_MAJOR_MIN}），跳过安装。"
    need_install_node=false
  else
    warn "检测到 Node.js $(node -v)，低于要求的 v${NODE_MAJOR_MIN}，将升级。"
  fi
else
  log "未检测到 Node.js，准备安装。"
fi

if [ "$need_install_node" = true ]; then
  if [ -z "$PKG_MANAGER" ]; then
    err "无法自动安装 Node.js（未识别包管理器），请手动安装 Node.js >= ${NODE_MAJOR_MIN} 后重试。"
    exit 1
  fi
  log "通过 NodeSource 安装 Node.js ${NODE_MAJOR_MIN}.x ..."
  case "$PKG_MANAGER" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | $SUDO bash -
      $SUDO apt-get install -y nodejs
      ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x" | $SUDO bash -
      $SUDO "$PKG_MANAGER" install -y nodejs
      ;;
  esac
  log "Node.js 安装完成: $(node -v)，npm: $(npm -v)"
fi

# ---------- 3. 检查 / 安装 pm2 ----------
if command -v pm2 >/dev/null 2>&1; then
  log "检测到 pm2 $(pm2 -v)，跳过安装。"
else
  log "未检测到 pm2，全局安装 ..."
  $SUDO npm install -g pm2
fi

# ---------- 3b. ffmpeg（口播视频合成）----------
if command -v ffmpeg >/dev/null 2>&1; then
  log "检测到 ffmpeg：$(ffmpeg -version 2>&1 | head -n1)"
else
  if [ -z "$PKG_MANAGER" ]; then
    warn "未检测到 ffmpeg，且无法自动安装；/v1/grammar/video 合成会失败。"
  else
    log "安装 ffmpeg ..."
    case "$PKG_MANAGER" in
      apt)
        $SUDO apt-get update -y
        $SUDO apt-get install -y ffmpeg fonts-wqy-microhei
        ;;
      dnf|yum)
        $SUDO "$PKG_MANAGER" install -y ffmpeg wqy-microhei-fonts || \
          warn "yum/dnf 安装 ffmpeg 失败，请手动安装后重试口播视频接口。"
        ;;
    esac
  fi
fi

# ---------- 4. 环境变量文件 ----------
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -f "$APP_DIR/.env.example" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    warn "已从 .env.example 生成 .env，请尽快编辑填入 DASHSCOPE_API_KEY 真实值："
    warn "  vi $APP_DIR/.env"
  else
    err ".env 与 .env.example 均不存在，无法继续。"
    exit 1
  fi
else
  log ".env 已存在，跳过生成。"
fi

if [ -n "${APP_PORT:-}" ]; then
  if grep -q '^QWEN_PROXY_PORT=' "$APP_DIR/.env"; then
    $SUDO sed -i "s/^QWEN_PROXY_PORT=.*/QWEN_PROXY_PORT=${APP_PORT}/" "$APP_DIR/.env"
  else
    echo "QWEN_PROXY_PORT=${APP_PORT}" >> "$APP_DIR/.env"
  fi
  log "已将 QWEN_PROXY_PORT 覆盖为 ${APP_PORT}"
fi

DASHSCOPE_KEY_SET="$(grep -E '^DASHSCOPE_API_KEY=.+' "$APP_DIR/.env" || true)"
if [ -z "$DASHSCOPE_KEY_SET" ]; then
  warn "DASHSCOPE_API_KEY 尚未在 .env 中配置真实值；服务会启动，但音频请求会报错，请尽快补全后 pm2 restart。"
fi

# ---------- 5. 安装项目依赖 ----------
mkdir -p "$APP_DIR/logs"
log "安装 npm 依赖 ..."
if [ -f "$APP_DIR/package-lock.json" ]; then
  npm ci --omit=dev --no-audit --no-fund
else
  npm install --omit=dev --no-audit --no-fund
fi

# ---------- 6. pm2 启动 / 重启 ----------
export PM2_APP_NAME
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  log "检测到已存在的 pm2 进程 [$PM2_APP_NAME]，执行 restart ..."
  pm2 restart "$PM2_APP_NAME" --update-env
else
  log "首次启动 pm2 进程 [$PM2_APP_NAME] ..."
  pm2 start "$APP_DIR/deploy/ecosystem.config.cjs"
fi
pm2 save

# ---------- 7. 开机自启（可选，幂等）----------
if [ "${SKIP_PM2_STARTUP:-0}" != "1" ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -n "$SUDO" -o "$(id -u)" -eq 0 ]; then
    STARTUP_CMD="$(pm2 startup 2>/dev/null | tail -n 1 || true)"
    if echo "$STARTUP_CMD" | grep -q '^sudo '; then
      log "配置 pm2 开机自启 ..."
      eval "$STARTUP_CMD" || warn "pm2 startup 自动执行失败，可忽略或手动执行上面的命令。"
    fi
  else
    warn "跳过 pm2 开机自启配置（无 systemctl 或权限不足），如需要请手动执行 'pm2 startup'。"
  fi
fi

# ---------- 8. 健康检查 ----------
PORT="$(grep -E '^QWEN_PROXY_PORT=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2)"
PORT="${PORT:-8787}"

sleep 2
log "健康检查 http://127.0.0.1:${PORT}/health ..."
if curl -fsS "http://127.0.0.1:${PORT}/health"; then
  echo
  log "部署完成，服务运行正常。"
else
  echo
  err "健康检查失败，请用 'pm2 logs ${PM2_APP_NAME}' 查看日志。"
  exit 1
fi

log "常用命令：pm2 status | pm2 logs ${PM2_APP_NAME} | pm2 restart ${PM2_APP_NAME}"
