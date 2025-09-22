#!/bin/bash

# 标准Git部署脚本
# 本地→GitHub→服务器

set -e

SERVER_IP="${SERVER_IP:-192.168.0.177}"
SSH_USER="root"
REMOTE_DIR="/opt/tenant-app"
# 使用当前仓库远端（可通过环境变量覆盖）
REPO_URL="${REPO_URL:-$(git config --get remote.origin.url 2>/dev/null || echo https://github.com/ZhangLin0121/tenant-app.git)}"

echo "🚀 开始标准Git部署流程..."

# 1. 检查本地更改并提交
if [[ -n $(git status --porcelain) ]]; then
    echo "📋 检测到未提交的更改，准备提交..."
    git add .
    read -p "请输入提交信息: " commit_msg
    if [[ -z "$commit_msg" ]]; then
      commit_msg="chore: deploy $(date +%Y-%m-%d' '%H:%M:%S)"
    fi
    git commit -m "$commit_msg"
fi

# 2. 推送到GitHub
echo "📤 推送到GitHub..."
git push origin main

# 3a. 服务器端拉取代码并安装依赖（不启动）
ssh ${SSH_USER}@${SERVER_IP} << 'ENDSSH'
    set -e
    
    echo "🔄 服务器端开始部署..."
    
    # 如果目录不存在，克隆仓库
    if [ ! -d "$REMOTE_DIR/.git" ]; then
        echo "📦 首次克隆仓库..."
        rm -rf $REMOTE_DIR
        git clone $REPO_URL $REMOTE_DIR
    else
        echo "📥 拉取最新代码..."
        cd $REMOTE_DIR
        git pull origin main
    fi
    
    # 安装PM2（如果未安装）
    npm install -g pm2
    
    # 部署后端
    echo "🔧 部署后端服务..."
    cd $REMOTE_DIR/tenant-dashboard
    npm install --production
    if [ ! -f ".env" ] && [ ! -f ".env.production" ]; then
        echo "⚠️  提示：未检测到 tenant-dashboard/.env 或 .env.production。"
        echo "   请在服务器上创建并填写 Mongo 与平台账号，例如："
        echo "   MONGO_URI=mongodb://127.0.0.1:27017/tenantDB"
        echo "   PLATFORM_USERNAME=你的账号"
        echo "   PLATFORM_PASSWORD=你的密码"
    fi
    
    # 部署前端
    echo "🎨 部署前端服务..."
    cd $REMOTE_DIR/tenant-frontend
    npm install
    npm run build
ENDSSH

# 3b. 传输生产环境变量文件（如存在本地 scripts/.deploy.env）
if [ -f "scripts/.deploy.env" ]; then
  echo "🔐 传输生产环境变量到服务器..."
  scp scripts/.deploy.env ${SSH_USER}@${SERVER_IP}:$REMOTE_DIR/tenant-dashboard/.env.production
fi

# 3c. 启动/重启 PM2 服务（读取生产环境变量）
ssh ${SSH_USER}@${SERVER_IP} << 'ENDSSH'
    set -e
    
    echo "▶️ 启动/重启服务..."
    cd $REMOTE_DIR
    pm2 stop tenant-dashboard tenant-frontend 2>/dev/null || true
    pm2 start ecosystem.config.js --env production
    pm2 save
    pm2 startup
    
    echo "✅ 部署完成！"
    echo "📊 后端API: http://$SERVER_IP:5001"
    echo "🌐 前端页面: http://$SERVER_IP:5000"
ENDSSH

echo "🎉 标准Git部署流程完成！"
echo "🔍 查看服务状态: pm2 status"
