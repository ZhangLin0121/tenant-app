#!/bin/bash

# 标准Git部署脚本
# 本地→GitHub→服务器

set -e

SERVER_IP="47.122.68.192"
SSH_USER="root"
REMOTE_DIR="/opt/tenant-app"
REPO_URL="https://github.com/yourusername/tenant-app.git"

echo "🚀 开始标准Git部署流程..."

# 1. 检查本地更改并提交
if [[ -n $(git status --porcelain) ]]; then
    echo "📋 检测到未提交的更改，准备提交..."
    git add .
    read -p "请输入提交信息: " commit_msg
    git commit -m "${commit_msg:-'Update: $(date +%Y-%m-%d %H:%M:%S)'})"
fi

# 2. 推送到GitHub
echo "📤 推送到GitHub..."
git push origin main

# 3. 服务器端拉取并部署
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
    
    # 停止现有服务
    pm2 stop tenant-dashboard tenant-frontend 2>/dev/null || true
    
    # 部署后端
    echo "🔧 部署后端服务..."
    cd $REMOTE_DIR/tenant-dashboard
    npm install --production
    
    # 部署前端
    echo "🎨 部署前端服务..."
    cd $REMOTE_DIR/tenant-frontend
    npm install
    npm run build
    
    # 启动服务
    echo "▶️ 启动服务..."
    cd $REMOTE_DIR
    pm2 start ecosystem.config.js --env production
    
    # 保存PM2配置
    pm2 save
    pm2 startup
    
    echo "✅ 部署完成！"
    echo "📊 后端API: http://$SERVER_IP:5001"
    echo "🌐 前端页面: http://$SERVER_IP:5000"
ENDSSH

echo "🎉 标准Git部署流程完成！"
echo "🔍 查看服务状态: pm2 status"