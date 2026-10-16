#!/usr/bin/env bash
#
# 工程硕博楼租户展示系统 部署到 s131
#
# 部署模型：本地 push → 服务器 git pull 源码 ＋ 本地构建产物同步
# ---------------------------------------------------------------
# 本仓库是「单体双应用」的 monorepo：
#
#   tenant-dashboard   后端（Express + Mongoose，纯 JS，无需构建）
#                      PM2 托管，监听 127.0.0.1:5001
#                      同时在 index.js 里直接托管前端静态（读 ../tenant-frontend/dist）
#
#   tenant-frontend    前端（Vue3 + Vite，需要构建）
#                      产物 dist/ 被后端读取后对外提供
#
# 因此只用一个目录：/opt/tenant-app 既是 git 工作区、也是运行目录
#
#   /opt/tenant-app                git 工作区（整仓源码）
#       ssh s131 'cd /opt/tenant-app && git log -1'
#    └─ tenant-dashboard/          后端源码（.env / .env.production 服务器专有）
#    └─ tenant-frontend/dist/      前端构建产物，由本脚本 rsync 同步（不在 Git 里）
#
# 为什么前端仍走 rsync 而不 pull：
#   Vite 需要 npm run build，服务器只有 1.6G 内存、2 核，绝不能远程构建。
#   所以「源码走 Git、构建产物走 rsync」——即标准 CI/CD 的形态。
#
# 运行方式：PM2 id 0，fork 模式，script=./tenant-dashboard/index.js，
#           cwd=/opt/tenant-app/tenant-dashboard，NODE_ENV=production，PORT=5001
# 对外入口：https://www.cacophonyem.me/tenant/
#           （nginx 443 块 location /tenant/ → localhost:5001/）
# 数据库：  外部 MongoDB，/opt/mongodb/bin/mongod --dbpath /data/db
#           （不在本项目目录内，部署不涉及）
#
# 数据边界（坚决不动）：
#   /opt/tenant-app/tenant-dashboard/.env             服务器专有（600）
#   /opt/tenant-app/tenant-dashboard/.env.production  服务器专有（生产覆盖）
#   两者部署前后各比对 md5，一旦被改动立即中止。
#
# 用法：./deploy-s131.sh
#      DEPLOY_HOST=别的别名  ./deploy-s131.sh
#      SKIP_BUILD=1          ./deploy-s131.sh  跳过本地构建，同步现有 dist/
#      SKIP_GIT_CHECK=1      ./deploy-s131.sh  应急跳过闸门

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${DEPLOY_HOST:-s131}"
APP_DIR="/opt/tenant-app"
BRANCH="main"
PM2_APP="tenant-dashboard"
BASE_PATH="/tenant"
HEALTH_URL="http://127.0.0.1:5001/api/health"
FRONTEND="$ROOT/tenant-frontend"
DIST="$FRONTEND/dist"
cd "$ROOT"

# ---- 前置闸门：保证「线上代码 = Git 里的代码」 ----
check_git_sync() {
  if [ "${SKIP_GIT_CHECK:-0}" = "1" ]; then
    echo "    [git] SKIP_GIT_CHECK=1，已跳过一致性检查"
    return 0
  fi
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "!! [git] 当前目录不是 git 仓库，无法部署"
    return 1
  fi

  if [ -n "$(git status --porcelain)" ]; then
    echo "!! [git] 存在未提交改动，拒绝部署。"
    echo "   理由：这些改动会直接上线，但 Git 中查无此版本，线上将无法追溯。"
    git status --short | sed 's/^/     /'
    echo "   请先 commit，或设 SKIP_GIT_CHECK=1 强制部署。"
    return 1
  fi

  branch="$(git rev-parse --abbrev-ref HEAD)"
  if upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    ahead="$(git rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)"
    if [ "${ahead:-0}" -gt 0 ]; then
      echo "    [git] 本地领先 ${upstream} ${ahead} 个提交，自动补推…"
      if ! git push origin "$branch"; then
        echo "!! [git] 推送失败，拒绝部署（服务器要从 GitHub 拉取）。"
        return 1
      fi
      echo "    [git] 已推送，GitHub 与本地一致"
    else
      echo "    [git] 已与 ${upstream} 同步"
    fi
  else
    echo "!! [git] 当前分支未设置上游，服务器拉不到，拒绝部署"
    return 1
  fi
  return 0
}

echo "==> [闸门] 检查 Git 同步状态"
check_git_sync || exit 1

# ---- 取部署前指纹 ----
env_md5_before="$(ssh "$HOST" "md5sum '$APP_DIR/tenant-dashboard/.env' 2>/dev/null | cut -d' ' -f1")"
envp_md5_before="$(ssh "$HOST" "md5sum '$APP_DIR/tenant-dashboard/.env.production' 2>/dev/null | cut -d' ' -f1")"
src_head_before="$(ssh "$HOST" "cd '$APP_DIR' && git rev-parse --short HEAD")"
echo "==> [远程] 运行目录当前版本: $src_head_before"
if [ -z "$env_md5_before" ]; then
  echo "!! $APP_DIR/tenant-dashboard/.env 读不到，立即中止（后端凭据来源）"
  exit 1
fi

# ---- 本地构建前端 ----
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "==> [构建] SKIP_BUILD=1，跳过本地构建（同步现有 dist/）"
else
  if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "!! 本地 $FRONTEND/node_modules 不存在，无法构建。"
    echo "   请先执行：npm --prefix tenant-frontend ci"
    exit 1
  fi
  echo "==> [构建] 本地 vite build（服务器内存小，绝不远程构建）"
  ( cd "$FRONTEND" && npm run build )
fi
if [ ! -f "$DIST/index.html" ]; then
  echo "!! $DIST/index.html 不存在，构建失败，中止。"
  exit 1
fi
echo "    产物：$(find "$DIST" -type f | wc -l | tr -d ' ') 个文件 / $(du -sh "$DIST" | cut -f1)"

# ---- 服务器拉取源码 ----
echo "==> [远程] $HOST:$APP_DIR 拉取 origin/$BRANCH"
ssh "$HOST" "cd '$APP_DIR' && git fetch --prune origin && git reset --hard 'origin/$BRANCH'"
ssh "$HOST" "cd '$APP_DIR' && echo '    拉取后源码版本: '\$(git log --oneline -1)"

dirty="$(ssh "$HOST" "cd '$APP_DIR' && git status --porcelain")"
if [ -n "$dirty" ]; then
  echo "!! 运行目录拉取后仍不干净，请人工确认："
  echo "$dirty" | sed 's/^/     /'
  exit 1
fi

# ---- 同步前端产物 ----
echo "==> [同步] tenant-frontend/dist/ -> $HOST:$APP_DIR/tenant-frontend/dist"
rsync -rlptz --delete "$DIST/" "$HOST:$APP_DIR/tenant-frontend/dist/"

# ---- 数据边界 + 一致性校验 ----
echo "==> [校验]"
env_md5_after="$(ssh "$HOST" "md5sum '$APP_DIR/tenant-dashboard/.env' 2>/dev/null | cut -d' ' -f1")"
if [ "$env_md5_before" != "$env_md5_after" ]; then
  echo "!! tenant-dashboard/.env 被改动（$env_md5_before -> ${env_md5_after}），立即中止"
  exit 1
fi
echo "    .env                     未被改动"

if [ -n "$envp_md5_before" ]; then
  envp_md5_after="$(ssh "$HOST" "md5sum '$APP_DIR/tenant-dashboard/.env.production' 2>/dev/null | cut -d' ' -f1")"
  if [ "$envp_md5_before" != "$envp_md5_after" ]; then
    echo "!! tenant-dashboard/.env.production 被改动（$envp_md5_before -> ${envp_md5_after}），立即中止"
    exit 1
  fi
  echo "    .env.production          未被改动"
fi

local_rev="$(git rev-parse HEAD)"
src_rev="$(ssh "$HOST" "cd '$APP_DIR' && git rev-parse HEAD")"
if [ "$local_rev" = "$src_rev" ]; then
  echo "    源码版本一致: ${local_rev:0:7}"
else
  echo "!! 源码版本不一致  本地 ${local_rev:0:7} / 线上 ${src_rev:0:7}"
  exit 1
fi

echo "    线上前端首页: $(ssh "$HOST" "md5sum '$APP_DIR/tenant-frontend/dist/index.html' | cut -d' ' -f1")"
echo "    本地前端首页: $(md5 -q "$DIST/index.html" 2>/dev/null || md5sum "$DIST/index.html" | cut -d' ' -f1)"

# ---- 重启后端 ----
echo "==> [重启] PM2 $PM2_APP"
ssh "$HOST" "pm2 restart $PM2_APP --update-env >/dev/null && echo '    已重启'"
sleep 3

# ---- 健康检查 ----
echo "==> [验证]"
BACKEND_CODE="$(ssh "$HOST" "curl -s -o /dev/null -m 15 -w '%{http_code}' '$HEALTH_URL'")"
echo "    直连 127.0.0.1:5001/api/health    $BACKEND_CODE"
if [ "$BACKEND_CODE" != "200" ]; then
  echo "!! 后端健康检查未通过，最近日志："
  ssh "$HOST" "pm2 logs $PM2_APP --lines 30 --nostream" || true
  exit 1
fi
ssh "$HOST" "curl -s -m 15 '$HEALTH_URL'" | sed 's/^/    健康详情: /'
ssh "$HOST" "curl -sk -o /dev/null -m 15 -w '    经 nginx $BASE_PATH/              %{http_code}\n' -H 'Host: www.cacophonyem.me' https://127.0.0.1$BASE_PATH/
  curl -sk -o /dev/null -m 15 -w '    经 nginx $BASE_PATH/api/health     %{http_code}\n' -H 'Host: www.cacophonyem.me' https://127.0.0.1$BASE_PATH/api/health"

echo "==> 完成：https://www.cacophonyem.me$BASE_PATH/"
