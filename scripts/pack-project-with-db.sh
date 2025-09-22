#!/usr/bin/env bash
set -euo pipefail

# 打包当前项目 + 数据库快照（JSON），用于离线部署
# - 自动读取 tenant-dashboard/.env 的 MONGO_URI，找不到则用默认本地: mongodb://127.0.0.1:27017/tenantDB
# - 导出集合：students,tenants,roomflags
# - 产物：在仓库根目录生成 tenant-app-with-db-YYYYMMDDHHMMSS.tgz

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

TS=$(date +%Y%m%d%H%M%S)
OUT_TGZ="$ROOT_DIR/tenant-app-with-db-$TS.tgz"
WORKDIR=$(mktemp -d /tmp/tenant-pack-XXXXXX)
STAGE="$WORKDIR/tenant-app"
DUMP_DIR="$STAGE/db-dump"

echo "==> 读取数据库连接字符串..."
SRC_URI_DEFAULT="mongodb://127.0.0.1:27017/tenantDB"
if [ -f "$ROOT_DIR/tenant-dashboard/.env" ]; then
  # shellcheck disable=SC2046
  eval $(grep -E '^MONGO_URI=' "$ROOT_DIR/tenant-dashboard/.env" | sed 's/\r$//') || true
fi
SRC_URI="${MONGO_URI:-$SRC_URI_DEFAULT}"
echo "    SRC_URI=$SRC_URI"

echo "==> 搭建打包暂存目录: $STAGE"
mkdir -p "$STAGE"

if command -v rsync >/dev/null 2>&1; then
  echo "==> 复制项目文件 (rsync)"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'tenant-dashboard/node_modules' \
    --exclude 'tenant-frontend/node_modules' \
    --exclude 'docker/mongo-data' \
    --exclude '*.tgz' \
    --exclude '*.tar.gz' \
    --exclude 'deploy.tgz' \
    --exclude '.vercel' \
    --exclude 'logs' \
    --exclude '**/backend.log' \
    ./ "$STAGE/"
else
  echo "==> rsync 不可用，使用 tar 解包拷贝"
  TMP_TAR="$WORKDIR/src.tar"
  tar -czf "$TMP_TAR" \
    --exclude .git \
    --exclude node_modules \
    --exclude tenant-dashboard/node_modules \
    --exclude tenant-frontend/node_modules \
    --exclude docker/mongo-data \
    --exclude '*.tgz' \
    --exclude '*.tar.gz' \
    --exclude deploy.tgz \
    --exclude .vercel \
    --exclude logs \
    --exclude '**/backend.log' \
    .
  tar -xzf "$TMP_TAR" -C "$STAGE"
fi

echo "==> 导出数据库到 JSON: $DUMP_DIR"
mkdir -p "$DUMP_DIR"
COLLECTIONS="${COLLECTIONS:-students,tenants,roomflags}" \
SRC_URI="$SRC_URI" \
OUTPUT_DIR="$DUMP_DIR" \
node tenant-dashboard/scripts/export-db.js

echo "==> 生成打包文件: $OUT_TGZ"
tar -czf "$OUT_TGZ" -C "$WORKDIR" tenant-app

echo "==> 清理临时目录"
rm -rf "$WORKDIR"

echo "==> 打包完成: $OUT_TGZ"
du -h "$OUT_TGZ" | awk '{print "    大小: "$1}'
