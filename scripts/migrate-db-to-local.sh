#!/usr/bin/env bash
set -euo pipefail

# 一键将当前数据库从 Docker 环境迁移到本地 MongoDB（非 Docker）。
# 步骤：
# 1) 从源库导出 JSON（默认：mongodb://127.0.0.1:27017/tenantDB —— 即当前 Docker 暴露端口）
# 2) 若存在名为 tenant-mongo 的容器且在运行，则停止它
# 3) 启动本地 MongoDB（scripts/mongo-up.sh）
# 4) 还原到本地库（默认同名 URI）
#
# 可用环境变量：
#   SRC_URI  源库连接串（默认：mongodb://127.0.0.1:27017/tenantDB）
#   DEST_URI 目标库连接串（默认：mongodb://127.0.0.1:27017/tenantDB）
#   COLLECTIONS 导出的集合（默认：students,tenants,roomflags）

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

SRC_URI="${SRC_URI:-mongodb://127.0.0.1:27017/tenantDB}"
DEST_URI="${DEST_URI:-mongodb://127.0.0.1:27017/tenantDB}"
COLLECTIONS="${COLLECTIONS:-students,tenants,roomflags}"

WORK_DIR=$(mktemp -d /tmp/tenant-migrate-XXXXXX)
DUMP_DIR="$WORK_DIR/dump"

echo "==> 导出源数据库 ($SRC_URI) 到 $DUMP_DIR"
mkdir -p "$DUMP_DIR"
COLLECTIONS="$COLLECTIONS" SRC_URI="$SRC_URI" OUTPUT_DIR="$DUMP_DIR" \
  node tenant-dashboard/scripts/export-db.js

if command -v docker >/dev/null 2>&1; then
  # 如果有名为 tenant-mongo 的容器在跑，先停掉，释放 27017 端口
  if docker ps --format '{{.Names}}' | rg -xq 'tenant-mongo'; then
    echo "==> 停止 Docker 容器 tenant-mongo"
    docker stop tenant-mongo || true
  fi
fi

echo "==> 启动本地 MongoDB（非 Docker）"
bash scripts/mongo-up.sh

echo "==> 还原到本地数据库 ($DEST_URI)"
COLLECTIONS="$COLLECTIONS" DEST_URI="$DEST_URI" INPUT_DIR="$DUMP_DIR" \
  node tenant-dashboard/scripts/restore-db.js

echo "==> 清理临时目录: $WORK_DIR"
rm -rf "$WORK_DIR"

echo "==> 迁移完成。现在可使用 $DEST_URI 运行应用。"

