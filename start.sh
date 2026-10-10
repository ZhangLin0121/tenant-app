#!/bin/bash

# --- 脚本说明 ---
# V5.0 - 简化版
# 一键启动 tenant-dashboard 项目的后端和前端开发服务器。
#
# 用法:
#   启动: ./start.sh
#   停止: ./start.sh stop

# --- 配置 ---
BACKEND_DIR="tenant-dashboard"
FRONTEND_DIR="tenant-frontend"
BACKEND_PORT=5001
FRONTEND_PORT=5173

# 日志文件
BACKEND_LOG_FILE="backend.log"
FRONTEND_LOG_FILE="frontend.log"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# --- 停止函数 ---
stop_services() {
    echo -e "${RED}🛑 正在停止所有相关服务...${NC}"
    lsof -ti :${BACKEND_PORT} | xargs -r kill -9
    lsof -ti :${FRONTEND_PORT} | xargs -r kill -9
    echo -e "${GREEN}✅ 所有服务已停止。${NC}"
}

# --- 启动函数 ---
start_services() {
    echo -e "${GREEN}✅ 依赖检查通过。${NC}\n"

    # 2. 启动后端
    echo -e "${GREEN}🚀 正在启动后端服务 (端口: ${BACKEND_PORT})...${NC}"
    cd "$BACKEND_DIR"
    nohup node index.js > $BACKEND_LOG_FILE 2>&1 &
    echo -e "后端服务已在后台启动, 日志: ${BLUE}${BACKEND_DIR}/${BACKEND_LOG_FILE}${NC}\n"

    # 3. 启动前端
    echo -e "${GREEN}🚀 正在启动前端服务 (端口: ${FRONTEND_PORT})...${NC}"
    cd "$FRONTEND_DIR"
    nohup pnpm run dev > $FRONTEND_LOG_FILE 2>&1 &
    echo -e "前端服务已在后台启动, 日志: ${BLUE}${FRONTEND_DIR}/${FRONTEND_LOG_FILE}${NC}\n"

    echo -e "\n🎉 ${GREEN}太棒了！所有服务已就绪。${NC}"
    echo -e "--------------------------------------------------"
    echo -e "  本地访问地址: ${YELLOW}http://localhost:${FRONTEND_PORT}${NC}"
    echo -e "--------------------------------------------------"
}

# --- 主逻辑 ---
if [ "$1" = "stop" ]; then
    stop_services
else
    echo "--- 租客看板开发环境一键启动 (V5.0 - 简化版) ---"
    stop_services
    echo ""
    start_services
fi
