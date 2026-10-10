Tenant App
================================

Overview
- Backend: `tenant-dashboard` (Node.js/Express/Mongoose/Puppeteer)
- Frontend: `tenant-frontend` (Vue 3/Vite/Tailwind/Axios)

Local Development
- Copy `tenant-dashboard/.env.example` to `tenant-dashboard/.env` and fill real values.
- Run `./start.sh` to start backend (5001) and frontend (5173). The frontend proxies `/api` to `http://localhost:5001`.
 
 Local MongoDB (no Docker)
 - Install MongoDB Community (macOS): `brew tap mongodb/brew && brew install mongodb-community`
 - Start MongoDB: `bash scripts/mongo-up.sh`
   - Exposes `mongodb://127.0.0.1:27017/tenantDB`
   - Data persists under `./local-mongo/data` when not using Homebrew service
 - Stop MongoDB: `bash scripts/mongo-down.sh`
 
 Backend .env important vars
 - `MONGO_URI=mongodb://127.0.0.1:27017/tenantDB`
 - `PLATFORM_USERNAME/PLATFORM_PASSWORD`
 - `PLATFORM_CONTRACT_ID` (e.g. 1489)

Environment & Secrets
- Do NOT commit `.env`. Real credentials must be stored outside git.
- If secrets were committed before, rotate them and purge history if needed.

Notes
- The frontend previously called `POST /api/tenants/external/removeGuest`, but the backend does not implement this endpoint. That call has been removed from the UI logic.
- For production, see `ecosystem.config.js` and deployment scripts. Validate paths/hosts before use.

Production (xiebin)
- Preferred: `scripts/deploy-xiebin.sh` (packs+uploads+builds+PM2 start). See `scripts/DEPLOYMENT.md` for the exact, tested steps and troubleshooting.
- Runtime URL: `http://<server>:5001` (backend serves API and static UI). Do not commit secrets; add platform credentials only on server `.env.production`.

---

## 生产访问信息

| 项目 | 值 |
|---|---|
| **线上入口** | https://www.cacophonyem.me/tenant/ |
| 服务器 | s131（8.162.5.131） |
| 服务器目录 | `/opt/tenant-app` |
| 运行方式 | PM2 `tenant-dashboard`（端口 5001） |

> 本仓库是 s131 上「��的源码镜像，与服务器目录保持同步；改动请两边同步后提交。
