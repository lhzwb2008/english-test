#!/bin/bash

# English Voice Tutor 一键启动/重启脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 加载环境变量
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

VITE_PORT=${VITE_PORT:-3000}
PROXY_PORT=${PROXY_PORT:-3001}

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  English Voice Tutor 启动脚本${NC}"
echo -e "${GREEN}================================${NC}"
echo ""

# 停止现有进程
echo -e "${YELLOW}[1/4] 停止现有进程...${NC}"

# 停止占用 VITE_PORT 的进程
if lsof -ti:$VITE_PORT > /dev/null 2>&1; then
  echo "  - 停止端口 $VITE_PORT 上的进程"
  kill $(lsof -ti:$VITE_PORT) 2>/dev/null || true
  sleep 1
fi

# 停止占用 PROXY_PORT 的进程
if lsof -ti:$PROXY_PORT > /dev/null 2>&1; then
  echo "  - 停止端口 $PROXY_PORT 上的进程"
  kill $(lsof -ti:$PROXY_PORT) 2>/dev/null || true
  sleep 1
fi

echo -e "  ${GREEN}✓ 进程已停止${NC}"

# 检查依赖
echo -e "${YELLOW}[2/4] 检查依赖...${NC}"
if [ ! -d "node_modules" ]; then
  echo "  - 安装依赖..."
  npm install
else
  echo -e "  ${GREEN}✓ 依赖已存在${NC}"
fi

# 启动代理服务器
echo -e "${YELLOW}[3/4] 启动代理服务器 (端口 $PROXY_PORT)...${NC}"
node --env-file=.env server.js > /dev/null 2>&1 &
PROXY_PID=$!
sleep 1

if kill -0 $PROXY_PID 2>/dev/null; then
  echo -e "  ${GREEN}✓ 代理服务器已启动 (PID: $PROXY_PID)${NC}"
else
  echo -e "  ${RED}✗ 代理服务器启动失败${NC}"
  exit 1
fi

# 启动 Vite 开发服务器
echo -e "${YELLOW}[4/4] 启动前端服务器 (端口 $VITE_PORT)...${NC}"
npx vite > /dev/null 2>&1 &
VITE_PID=$!
sleep 2

if kill -0 $VITE_PID 2>/dev/null; then
  echo -e "  ${GREEN}✓ 前端服务器已启动 (PID: $VITE_PID)${NC}"
else
  echo -e "  ${RED}✗ 前端服务器启动失败${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  启动成功！${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "  前端地址: ${GREEN}http://localhost:$VITE_PORT${NC}"
echo -e "  代理地址: ${GREEN}ws://localhost:$PROXY_PORT/ws${NC}"
echo ""
echo -e "  ${YELLOW}提示: 按 Ctrl+C 停止所有服务${NC}"
echo ""

# 捕获退出信号，清理进程
cleanup() {
  echo ""
  echo -e "${YELLOW}正在停止服务...${NC}"
  kill $PROXY_PID 2>/dev/null || true
  kill $VITE_PID 2>/dev/null || true
  echo -e "${GREEN}服务已停止${NC}"
  exit 0
}

trap cleanup SIGINT SIGTERM

# 等待进程
wait
