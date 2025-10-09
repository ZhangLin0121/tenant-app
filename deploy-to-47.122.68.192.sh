#!/bin/bash

# 部署到服务器 47.122.68.192
# 使用密码认证方式

set -e

SERVER_IP="47.122.68.192"
SSH_USER="root"
APP_DIR="/opt/tenant-app"
TARBALL="/tmp/tenant-app-$(date +%Y%m%d%H%M%S).tgz"

# 可选：通过环境变量注入平台账号
PU="${PLATFORM_USERNAME:-}"
PP="${PLATFORM_PASSWORD:-}"

# 检查是否有未提交的更改
if [[ -n $(git status --porcelain) ]]; then
    echo "📋 检测到未提交的更改，准备提交..."
    git add .
    git commit -m "chore: deploy $(date +%Y-%m-%d' '%H:%M:%S)"
fi

echo "==> 打包当前项目..."
tar --exclude='.git' \
    --exclude='node_modules' \
    --exclude='tenant-dashboard/node_modules' \
    --exclude='tenant-frontend/node_modules' \
    --exclude='docker/mongo-data' \
    -czf "$TARBALL" .

echo "==> 创建远端目录: ${SSH_USER}@${SERVER_IP}:${APP_DIR}"

# 使用sshpass进行密码认证
echo "🔐 请输入服务器密码:"
read -s SSHPASS

export SSHPASS

sshpass -e ssh -o StrictHostKeyChecking=no ${SSH_USER}@${SERVER_IP} "mkdir -p ${APP_DIR}"

echo "==> 上传包到远端..."
sshpass -e scp -o StrictHostKeyChecking=no "$TARBALL" ${SSH_USER}@${SERVER_IP}:/tmp/

echo "==> 远端解压并安装依赖..."
BASENAME=$(basename "$TARBALL")
sshpass -e ssh -o StrictHostKeyChecking=no ${SSH_USER}@${SERVER_IP} "mkdir -p ${APP_DIR} && tar -xzf /tmp/${BASENAME} -C ${APP_DIR} --strip-components=1 && rm -f /tmp/${BASENAME}"

# 执行远端部署步骤
echo "==> 执行远端部署..."
sshpass -e ssh -o StrictHostKeyChecking=no ${SSH_USER}@${SERVER_IP} "PU='${PU}' PP='${PP}' bash -s" <<'REMOTE_CMDS'
set -e
APP_DIR="/opt/tenant-app"

# 检查并安装Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "📦 安装Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get update
    apt-get install -y nodejs
fi

# 部署后端
cd "$APP_DIR/tenant-dashboard"

ENV_FILE=".env.production"
touch "$ENV_FILE"

# 配置环境变量
TMP_FILE="$(mktemp)"
grep -v '^[[:space:]]*MONGO_URI=' "$ENV_FILE" | \
grep -v '^[[:space:]]*PORT=' > "$TMP_FILE" || true
mv "$TMP_FILE" "$ENV_FILE"
{
  echo "MONGO_URI=mongodb://localhost:27017/tenant_dashboard"
  echo "PORT=5001"
} >> "$ENV_FILE"

# 如提供平台账号/密码，则覆盖
if [ -n "${PU:-}" ]; then
  sed -i.bak '/^[[:space:]]*PLATFORM_USERNAME=/d' "$ENV_FILE" || true
  echo "PLATFORM_USERNAME=${PU}" >> "$ENV_FILE"
fi
if [ -n "${PP:-}" ]; then
  sed -i.bak '/^[[:space:]]*PLATFORM_PASSWORD=/d' "$ENV_FILE" || true
  echo "PLATFORM_PASSWORD=${PP}" >> "$ENV_FILE"
fi
rm -f "$ENV_FILE.bak" 2>/dev/null || true

# 安装后端依赖
PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev || npm install --production

# 部署前端
cd "$APP_DIR/tenant-frontend"
npm ci || npm install
npm run build

# 安装并配置PM2
npm install -g pm2

# 启动/重启服务
cd "$APP_DIR"
pm2 describe tenant-dashboard >/dev/null 2>&1 && pm2 stop tenant-dashboard && pm2 delete tenant-dashboard || true
NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
pm2 save
pm2 startup

echo "✅ 部署完成！"
echo "🌐 前端页面: http://${SERVER_IP}:5001"
echo "🔧 后端API: http://${SERVER_IP}:5001/api"
REMOTE_CMDS

echo "==> 清理本地临时文件..."
rm -f "$TARBALL"

echo "🎉 部署完成！请访问 http://${SERVER_IP}:5001"