#!/bin/bash

# 使用ssh zzy别名直接打包部署

set -e

TARBALL="/tmp/tenant-app-$(date +%Y%m%d%H%M%S).tgz"
APP_DIR="/opt/tenant-app"

echo "🚀 开始直接打包部署..."

echo "📦 打包当前项目..."
tar --exclude='.git' \
    --exclude='node_modules' \
    --exclude='tenant-dashboard/node_modules' \
    --exclude='tenant-frontend/node_modules' \
    --exclude='docker/mongo-data' \
    -czf "$TARBALL" .

echo "📤 上传到服务器..."
scp "$TARBALL" zzy:/tmp/

echo "🔧 在服务器上解压和部署..."
BASENAME=$(basename "$TARBALL")
ssh zzy "
set -e

# 停止现有服务
if pm2 describe tenant-dashboard >/dev/null 2>&1; then
    echo '🛑 停止现有tenant-dashboard服务...'
    pm2 stop tenant-dashboard
fi

# 创建应用目录
mkdir -p $APP_DIR

# 解压
cd /tmp
tar -xzf $BASENAME -C $APP_DIR --strip-components=1
rm -f $BASENAME

# 部署后端
cd $APP_DIR/tenant-dashboard

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
cd $APP_DIR/tenant-frontend
npm install
npm run build

# 安装PM2（如果未安装）
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi

# 启动服务
cd $APP_DIR
NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
pm2 save

echo '✅ 部署完成！'
echo '🌐 访问地址: http://服务器IP:5001'
"

echo "🧹 清理本地临时文件..."
rm -f "$TARBALL"

echo "🎉 部署完成！"