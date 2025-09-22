#!/usr/bin/env bash
set -euo pipefail

# 将本地 MongoDB 导出为 JSON 后打包上传到服务器并在服务器还原
# 依赖：本地与服务器均已安装 Node.js；服务器运行 PM2 的 tenant-dashboard

HOST="${HOST:-192.168.0.177}"
USER="${USER_AT_REMOTE:-xiebin}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-~/tenant-app}"
SRC_URI="${SRC_URI:-mongodb://127.0.0.1:27017/tenantDB}"
DEST_URI="${DEST_URI:-mongodb://127.0.0.1:27017/tenant_dashboard}"
COLLECTIONS="${COLLECTIONS:-students,tenants,roomflags}"

WORK_DIR="/tmp/tenant-dump-$(date +%Y%m%d%H%M%S)"
OUT_DIR="$WORK_DIR/dump"
TARBALL="$WORK_DIR.tar.gz"

echo "==> 导出本地数据库 ($SRC_URI) 到 $OUT_DIR"
mkdir -p "$OUT_DIR"
COLLECTIONS="$COLLECTIONS" SRC_URI="$SRC_URI" OUTPUT_DIR="$OUT_DIR" \
  node tenant-dashboard/scripts/export-db.js

echo "==> 打包 $OUT_DIR -> $TARBALL"
tar -czf "$TARBALL" -C "$WORK_DIR" dump

echo "==> 上传到服务器 $USER@$HOST:/tmp/"
if [ -n "${SSHPASS:-}" ] && command -v sshpass >/dev/null 2>&1; then
  SSHPASS_CMD=(sshpass -e)
else
  SSHPASS_CMD=()
fi

"${SSHPASS_CMD[@]}" scp -o StrictHostKeyChecking=no "$TARBALL" "$USER@$HOST:/tmp/"

REMOTE_TARBALL="/tmp/$(basename "$TARBALL")"

echo "==> 服务器端还原到 $DEST_URI"
"${SSHPASS_CMD[@]}" ssh -o StrictHostKeyChecking=no "$USER@$HOST" bash -lc "\
  set -e; \
  # 尝试加载常见 shell 配置，确保 node/pm2 在 PATH 中\
  for f in ~/.bash_profile ~/.bashrc ~/.zprofile ~/.zshrc ~/.profile; do \
    [ -f \"\$f\" ] && . \"\$f\" || true; \
  done; \
  export PATH=\"/opt/homebrew/bin:/usr/local/bin:\$PATH\"; \
  NODE_BIN=\$(command -v node || true); \
  PM2_BIN=\$(command -v pm2 || true); \
  if [ -z \"\$NODE_BIN\" ]; then echo '远端未找到 node，请确认已安装 Node.js'; exit 1; fi; \
  if [ -z \"\$PM2_BIN\" ]; then echo '远端未找到 pm2，将尝试全局安装'; npm install -g pm2; PM2_BIN=\$(command -v pm2 || true); fi; \
  TMP_DIR=\$(mktemp -d /tmp/tenant-restore-XXXX); \
  tar -xzf '$REMOTE_TARBALL' -C \"\$TMP_DIR\"; \
  COLLECTIONS='$COLLECTIONS' DEST_URI='$DEST_URI' INPUT_DIR=\"\$TMP_DIR/dump\" \
    \"\$NODE_BIN\" ${REMOTE_APP_DIR}/tenant-dashboard/scripts/restore-db.js; \
  rm -f '$REMOTE_TARBALL'; rm -rf \"\$TMP_DIR\"; \
  \"\$PM2_BIN\" restart tenant-dashboard --update-env || true; \
  echo RESTORE_OK\
"

echo "==> 完成，服务器已与本地一致"
