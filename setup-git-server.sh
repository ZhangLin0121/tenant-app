#!/bin/bash

# 在服务器上设置Git仓库的脚本
# 先在服务器上运行这个脚本，再配置本地推送

SERVER_IP="47.122.68.192"
SSH_USER="root"
REPO_NAME="tenant-app"

echo "🔧 在服务器上设置Git仓库..."

ssh ${SSH_USER}@${SERVER_IP} << 'ENDSSH'
    set -e
    
    # 创建git仓库目录
    mkdir -p /opt/git
    cd /opt/git
    
    # 创建裸仓库
    git init --bare ${REPO_NAME}.git
    
    # 创建钩子脚本，自动部署到指定目录
    cat > ${REPO_NAME}.git/hooks/post-receive << 'EOF'
#!/bin/bash
TARGET_DIR="/opt/tenant-app"
GIT_DIR="/opt/git/tenant-app.git"

# 检出代码到工作目录
git --work-tree=$TARGET_DIR --git-dir=$GIT_DIR checkout -f

echo "📥 代码已检出到 $TARGET_DIR"

# 进入工作目录
cd $TARGET_DIR

# 安装依赖和启动服务
echo "🔧 开始部署..."

# 安装PM2（如果未安装）
command -v pm2 >/dev/null || npm install -g pm2

# 停止现有服务
pm2 stop tenant-dashboard tenant-frontend 2>/dev/null || true

# 部署后端
echo "🔧 部署后端服务..."
cd tenant-dashboard
npm install --production

# 部署前端
echo "🎨 部署前端服务..."
cd ../tenant-frontend
npm install
npm run build

# 启动服务
echo "▶️ 启动服务..."
cd ..
pm2 start ecosystem.config.js --env production

# 保存PM2配置
pm2 save
pm2 startup systemv

echo "✅ 自动部署完成！"
EOF
    
    chmod +x ${REPO_NAME}.git/hooks/post-receive
    
    echo "✅ Git仓库已创建：/opt/git/${REPO_NAME}.git"
    echo "📋 请在本地运行："
    echo "git remote add production root@47.122.68.192:/opt/git/tenant-app.git"
    echo "然后就可以：git push production main"
ENDSSH

echo "🎉 服务器Git仓库配置完成！"