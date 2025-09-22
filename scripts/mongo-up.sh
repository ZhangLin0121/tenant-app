#!/usr/bin/env bash
set -euo pipefail

# 启动本机 MongoDB（非 Docker）。优先使用 Homebrew 服务；若不可用，则用内置临时目录启动 mongod。

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOCAL_DIR="$ROOT_DIR/local-mongo"
DATA_DIR="$LOCAL_DIR/data"
LOG_DIR="$LOCAL_DIR/logs"
PID_FILE="$LOCAL_DIR/mongod.pid"
PORT=27017

is_port_up() {
  nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
}

if is_port_up; then
  echo "[mongo-up] 发现 127.0.0.1:$PORT 已监听，MongoDB 已在运行。"
  exit 0
fi

if command -v brew >/dev/null 2>&1; then
  echo "[mongo-up] 尝试通过 Homebrew 启动 mongodb-community 服务..."
  if brew services start mongodb-community >/dev/null 2>&1; then
    :
  elif brew services start mongodb-community@7.0 >/dev/null 2>&1; then
    :
  elif brew services start mongodb-community@6.0 >/dev/null 2>&1; then
    :
  else
    echo "[mongo-up] 未能通过 Homebrew 启动 mongodb-community，改用内置目录启动 mongod。"
  fi
fi

if ! is_port_up; then
  if command -v mongod >/dev/null 2>&1; then
    echo "[mongo-up] 使用本地 mongod 启动..."
    mkdir -p "$DATA_DIR" "$LOG_DIR"
    mongod \
      --dbpath "$DATA_DIR" \
      --logpath "$LOG_DIR/mongod.log" \
      --fork \
      --bind_ip 127.0.0.1 \
      --port "$PORT" \
      --pidfilepath "$PID_FILE"
  else
    echo "[mongo-up] 未找到 mongod。请安装 MongoDB 社区版，示例：\n  brew tap mongodb/brew && brew install mongodb-community" >&2
    exit 1
  fi
fi

# 等待端口就绪
echo -n "[mongo-up] 等待 MongoDB 就绪"
for i in {1..20}; do
  if is_port_up; then echo " -> OK"; break; fi
  echo -n "."; sleep 0.5
done
if ! is_port_up; then
  echo "\n[mongo-up] 启动失败：端口 $PORT 未就绪。" >&2
  exit 1
fi

echo "[mongo-up] 已启动：mongodb -> mongodb://127.0.0.1:$PORT/tenantDB"
