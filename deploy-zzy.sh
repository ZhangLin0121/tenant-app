#!/bin/bash

# 使用ssh zzy别名部署到服务器
# 确保不影响其他服务

set -e

echo "🚀 开始部署到服务器 (使用ssh zzy)..."

# 使用现有的部署脚本，但修改为使用ssh zzy
# 首先检查服务器上是否已有tenant-app服务
ssh zzy "
set -e

APP_DIR=\"/opt/tenant-app\"

# 检查是否已有tenant-app服务在运行
if pm2 describe tenant-dashboard >/dev/null 2>&1; then
    echo '🛑 停止现有tenant-dashboard服务...'
    pm2 stop tenant-dashboard
fi

# 如果目录不存在，克隆仓库
if [ ! -d \"\$APP_DIR/.git\" ]; then
    echo '📦 首次克隆仓库...'
    rm -rf \$APP_DIR
    git clone https://github.com/ZhangLin0121/tenant-app.git \$APP_DIR
else
    echo '📥 更新代码...'
    cd \$APP_DIR
    git pull origin main
fi

# 部署后端
cd \$APP_DIR/tenant-dashboard

# 如果不存在环境文件，创建基础配置
if [ ! -f \".env.production\" ]; then
    echo '⚙️ 创建环境配置文件...'
    cat > .env.production << 'EOF'
MONGO_URI=mongodb://localhost:27017/tenant_dashboard
PORT=5001
PLATFORM_USERNAME=your_username
PLATFORM_PASSWORD=your_password
PLATFORM_CONTRACT_ID=1489
EOF
    echo '⚠️  请编辑 .env.production 文件，填入真实的平台账号密码'
fi

# 安装后端依赖
PUPPETEER_SKIP_DOWNLOAD=1 npm install --production

# 部署前端
cd \$APP_DIR/tenant-frontend
npm install
npm run build

# 安装PM2（如果未安装）
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi

# 启动服务
cd \$APP_DIR
NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
pm2 save

echo '✅ 部署完成！'
echo '🌐 访问地址: http://服务器IP:5001'
"

echo "🎉 部署完成！"