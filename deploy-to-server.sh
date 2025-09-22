#!/bin/bash

# 服务器部署脚本
# 在服务器上拉取GitHub代码并部署

set -e

# 可通过环境变量覆盖：SERVER_IP/SSH_USER/REPO_URL/APP_DIR
SERVER_IP="${SERVER_IP:-192.168.0.177}"
SSH_USER="${SSH_USER:-root}"
REPO_URL="${REPO_URL:-https://github.com/ZhangLin0121/tenant-app.git}"
APP_DIR="${APP_DIR:-/opt/tenant-app}"

echo "🚀 开始从GitHub拉取并部署Tenant App..."

# SSH到服务器执行完整部署
ssh ${SSH_USER}@${SERVER_IP} << 'ENDSSH'
    set -e
    
    echo "🔄 服务器部署开始..."
    
    # 安装Node.js 18.x（如果未安装）
    if ! command -v node >/dev/null 2>&1; then
        echo "📦 安装Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
    fi
    
    # 安装PM2（如果未安装）
    if ! command -v pm2 >/dev/null 2>&1; then
        echo "📦 安装PM2..."
        npm install -g pm2
    fi
    
    # 克隆或更新代码
    if [ ! -d "$APP_DIR/.git" ]; then
        echo "📦 首次克隆仓库..."
        rm -rf $APP_DIR
        git clone $REPO_URL $APP_DIR
    else
        echo "📥 更新代码..."
        cd $APP_DIR
        git pull origin main
    fi
    
    # 停止现有服务
    echo "🛑 停止现有服务..."
    pm2 stop tenant-dashboard 2>/dev/null || true
    pm2 stop tenant-frontend 2>/dev/null || true
    
    # 部署后端
    echo "🔧 部署后端服务..."
    cd $APP_DIR/tenant-dashboard
    
    # 创建环境配置文件
    if [ ! -f ".env" ]; then
        echo "⚙️ 创建环境配置文件..."
        cat > .env << 'EOF'
# 数据库配置
MONGO_URI=mongodb://localhost:27017/tenant_dashboard

# 服务器端口
PORT=5001

# 日志配置
LOG_LEVEL=info
EOF
    fi
    
    echo "📦 安装后端依赖..."
    npm install --production
    
    # 部署前端
    echo "🎨 部署前端服务..."
    cd $APP_DIR/tenant-frontend
    
    echo "📦 安装前端依赖..."
    npm install
    
    echo "🏗️ 构建前端..."
    npm run build
    
    # 启动服务
    echo "▶️ 启动服务..."
    cd $APP_DIR
    
    # 使用PM2启动后端
    pm2 start tenant-dashboard/index.js --name tenant-dashboard --env production --watch
    
    # 使用PM2启动前端静态服务
    pm2 serve tenant-frontend/dist 5000 --name tenant-frontend --spa
    
    # 保存PM2配置并设置开机启动
    pm2 save
    pm2 startup systemd -u root --hp /root
    
    echo "✅ 部署完成！"
    echo ""
    echo "📊 服务状态:"
    pm2 status
    echo ""
    echo "🌐 访问地址:"
    echo "   前端页面: http://$SERVER_IP:5000"
    echo "   后端API: http://$SERVER_IP:5001"
    echo ""
    echo "📋 常用命令:"
    echo "   查看日志: pm2 logs"
    echo "   重启服务: pm2 restart tenant-dashboard tenant-frontend"
    echo "   停止服务: pm2 stop tenant-dashboard tenant-frontend"
ENDSSH

echo "🎉 部署完成！请访问 http://$SERVER_IP:5000 查看应用"
