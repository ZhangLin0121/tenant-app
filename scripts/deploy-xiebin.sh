#!/usr/bin/env bash
set -euo pipefail

# 部署到内网服务器（xiebin@192.168.0.177）
# 说明：
# - 使用当前工作副本打包上传，不依赖远端 git
# - 服务器端使用本机 MongoDB（非 Docker），通过 .env.production 指定连接串
# - 后端同时托管前端构建产物（访问 5001 端口即可）

HOST="192.168.0.177"
USER="xiebin"
# 使用用户家目录以兼容 Linux/macOS 远端
APP_DIR="~/tenant-app"
TARBALL="/tmp/tenant-app-$(date +%Y%m%d%H%M%S).tgz"

# 可选：本地通过环境变量注入之寓平台账号（仅用于远端 .env.production 写入，不会记录到仓库）
PU="${PLATFORM_USERNAME:-}"
PP="${PLATFORM_PASSWORD:-}"

echo "==> 打包当前项目..."
tar --exclude='.git' \
    --exclude='node_modules' \
    --exclude='tenant-dashboard/node_modules' \
    --exclude='tenant-frontend/node_modules' \
    --exclude='docker/mongo-data' \
    -czf "$TARBALL" .

echo "==> 创建远端目录: ${USER}@${HOST}:${APP_DIR}"
# 预先声明数组，避免 set -u 在空数组展开时报未绑定变量
declare -a SSHPASS_CMD=()
if [ -n "${SSHPASS:-}" ] && command -v sshpass >/dev/null 2>&1; then
  SSHPASS_CMD=(sshpass -e)
fi

# 小助手：在存在 sshpass 配置时为命令加前缀，否则直接执行
ssh_wrap() {
  if [ ${#SSHPASS_CMD[@]} -gt 0 ]; then
    "${SSHPASS_CMD[@]}" "$@"
  else
    "$@"
  fi
}

ssh_wrap ssh -o StrictHostKeyChecking=no ${USER}@${HOST} "mkdir -p ${APP_DIR}"

echo "==> 上传包到远端..."
ssh_wrap scp -o StrictHostKeyChecking=no "$TARBALL" ${USER}@${HOST}:/tmp/

echo "==> 远端解压并安装依赖..."
# 解压包（先取 tar 包文件名）
BASENAME=$(basename "$TARBALL")
ssh_wrap ssh -o StrictHostKeyChecking=no ${USER}@${HOST} "mkdir -p ${APP_DIR} && tar -xzf /tmp/${BASENAME} -C ${APP_DIR} --strip-components=1 && rm -f /tmp/${BASENAME}"

# 使用 heredoc 执行复杂远端步骤，避免引号/转义问题
# 使用登录 shell 执行远端脚本，确保 PATH 等环境变量正确（如 /opt/homebrew/bin）
ssh_wrap ssh -o StrictHostKeyChecking=no ${USER}@${HOST} "PU='${PU}' PP='${PP}' bash -l -s" <<'REMOTE_CMDS'
set -e
APP_DIR=$HOME/tenant-app
cd "$APP_DIR/tenant-dashboard"

ENV_FILE=".env.production"
touch "$ENV_FILE"

# 始终更新 Mongo 与端口；保留其余配置
TMP_FILE="$(mktemp)"
grep -v '^[[:space:]]*MONGO_URI=' "$ENV_FILE" | \
grep -v '^[[:space:]]*PORT=' > "$TMP_FILE" || true
mv "$TMP_FILE" "$ENV_FILE"
{
  echo "MONGO_URI=mongodb://localhost:27017/tenant_dashboard"
  echo "PORT=5001"
} >> "$ENV_FILE"

# 如本地提供平台账号/密码，则覆盖远端；否则保持现状
if [ -n "${PU:-}" ]; then
  sed -i.bak '/^[[:space:]]*PLATFORM_USERNAME=/d' "$ENV_FILE" || true
  echo "PLATFORM_USERNAME=${PU}" >> "$ENV_FILE"
fi
if [ -n "${PP:-}" ]; then
  sed -i.bak '/^[[:space:]]*PLATFORM_PASSWORD=/d' "$ENV_FILE" || true
  echo "PLATFORM_PASSWORD=${PP}" >> "$ENV_FILE"
fi
rm -f "$ENV_FILE.bak" 2>/dev/null || true

# 安装后端依赖（跳过 Puppeteer 浏览器下载）
if command -v npm >/dev/null 2>&1; then
  PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev || npm install --production
else
  echo '未检测到 Node/npm，请先在服务器安装 Node.js (>=16)'; exit 1
fi

# 构建前端
cd "$APP_DIR/tenant-frontend"
npm ci || npm install
npm run build

# 启动/重启 PM2 后端，仅用后端提供静态文件（访问 5001）
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
cd "$APP_DIR"
pm2 describe tenant-dashboard >/dev/null 2>&1 && pm2 stop tenant-dashboard && pm2 delete tenant-dashboard || true
NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
pm2 save
echo "部署完成：后端监听 http://127.0.0.1:5001"
REMOTE_CMDS

echo "==> 完成。请访问 http://${HOST}:5001"
