#!/usr/bin/env bash
set -euo pipefail

# 停止本机 MongoDB（非 Docker）。优先停止 Homebrew 服务；否则尝试结束本地 mongod 进程。

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOCAL_DIR="$ROOT_DIR/local-mongo"
PID_FILE="$LOCAL_DIR/mongod.pid"
PORT=27017

if command -v brew >/dev/null 2>&1; then
  if brew services list | rg -q "mongodb-community"; then
    echo "[mongo-down] 通过 Homebrew 停止 mongodb-community..."
    brew services stop mongodb-community || true
    brew services stop mongodb-community@7.0 || true
    brew services stop mongodb-community@6.0 || true
  fi
fi

# 若为脚本启动的 mongod，尝试用 pid 文件停止
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "${PID:-}" ] && ps -p "$PID" >/dev/null 2>&1; then
    echo "[mongo-down] 结束 mongod 进程: $PID"
    kill "$PID" || true
    sleep 1
  fi
  rm -f "$PID_FILE" || true
fi

# 兜底：结束占用 27017 的进程（谨慎）
if lsof -ti :$PORT >/dev/null 2>&1; then
  echo "[mongo-down] 结束占用端口 $PORT 的进程..."
  lsof -ti :$PORT | xargs -r kill -9 || true
fi

echo "[mongo-down] 已停止。保留数据目录：$ROOT_DIR/local-mongo/data"
