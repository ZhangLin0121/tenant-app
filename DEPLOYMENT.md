Tenant App Deployment Guide (macOS Server)

This guide records the exact steps and assumptions to deploy and operate the app on your server so future automation/AI can follow it reliably.

Scope
- Backend: tenant-dashboard (Node.js/Express + Mongoose + Puppeteer)
- Frontend: tenant-frontend (Vite build served by backend)
- Server OS: macOS (Homebrew), user e.g. xiebin
- Target root: /opt/tenant-app

Prerequisites (server)
- Homebrew installed.
- Node.js 18+ and npm via Homebrew.
- PM2 installed globally: npm i -g pm2
- MongoDB running locally on 127.0.0.1:27017 (your data already exists).
- Google Chrome or Chromium installed (backend prefers system Chrome; skips downloading Chromium).

Directory layout (server)
- /opt/tenant-app
  - tenant-dashboard
  - tenant-frontend
  - ecosystem.config.js (optional; PM2 can also start directly)

Initial server setup
1) Create target directory and clone or sync the repo content:
   - mkdir -p /opt/tenant-app
   - git clone <repo> /opt/tenant-app  (or rsync from local, excluding .env files and node_modules)

2) Create backend production env: /opt/tenant-app/tenant-dashboard/.env.production
   - MONGO_URI=mongodb://127.0.0.1:27017/tenantDB
   - PLATFORM_USERNAME=<your_zhiyu_user>
   - PLATFORM_PASSWORD=<your_zhiyu_password>
   - PORT=5001
   - PLATFORM_ENTERPRISE_IDS=227
   - PLATFORM_CONTRACT_ID=1489

3) Install dependencies
   - Backend (skip Chromium download and use system Chrome):
     cd /opt/tenant-app/tenant-dashboard
     PUPPETEER_SKIP_DOWNLOAD=1 npm install --production
   - Frontend (build static assets):
     cd /opt/tenant-app/tenant-frontend
     npm install
     npm run build

Run with PM2 (recommended)
- Start in fork mode (stable on macOS):
  PORT=5001 NODE_ENV=production pm2 start /opt/tenant-app/tenant-dashboard/index.js --name tenant-dashboard --update-env
  pm2 save

- Check:
  - Port: lsof -nP -iTCP:5001 -sTCP:LISTEN
  - Status: curl http://127.0.0.1:5001/api/sync/status
  - App root: curl -I http://127.0.0.1:5001/

What the backend serves
- Serves frontend from tenant-frontend/dist at / (index.html) if present.
- API under /api (see below).

Sync behavior & API
- On backend start (with PLATFORM_USERNAME/PASSWORD present): runSync() triggers one initial sync.
- Cooldown: 5 minutes after a sync to prevent rapid re-trigger.
- Endpoints:
  - GET /api/sync/status → { isSyncing, lastSyncAt, cooldownRemainingMs }
  - POST /api/sync → trigger sync (honors cooldown)
  - GET /api/tenants → building grid data
  - GET /api/stats → summary stats for UI
  - GET /api/rooms/flags → room flags list
  - PUT /api/rooms/flags/:roomNumber { type } → set flag (stored as 'vip' for unavailable)
  - DELETE /api/rooms/flags/:roomNumber → clear flag
  - PUT /api/rooms/tags/:roomNumber { roomTag } → optional display tag fallback

Room flags (unavailable)
- The system uses a single unavailable marker: type 'vip'.
- The frontend hides occupants for any flagged room (type !== 'none'), colors the cell red, and excludes it from certain stats.

Frontend behavior
- On page open: silently auto-trigger /api/sync when not in cooldown (gated via /api/sync/status).
- UI shows lastSyncAt; if backend just restarted, it falls back to DB latest Tenant.updatedAt.
- Grid cells:
  - Unavailable rooms (flagged) do NOT show occupant names.
  - Room detail modal for flagged rooms shows “该房间有其他用途” (no occupant details).

Operations
- Logs:
  - PM2 logs: pm2 logs tenant-dashboard --lines 200
  - Backend logs/snapshots: tenant-dashboard/logs/* (guestsSnapshot.json, fetchStats.json, error.png)
- Restart backend:
  pm2 restart tenant-dashboard
- Update code (from local): rsync the repo to /opt/tenant-app, rebuild frontend, restart PM2.

Deployment from local (example)
- Sync code (exclude secrets and node_modules):
  rsync -az --delete \
    --exclude '.git' --exclude 'node_modules' --exclude '.vercel' \
    --exclude 'tenant-dashboard/.env' --exclude 'tenant-dashboard/.env.production' \
    ./ user@server:/opt/tenant-app/
- Server build & restart:
  ssh user@server <<'EOS'
  set -euo pipefail
  export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH
  cd /opt/tenant-app/tenant-dashboard && PUPPETEER_SKIP_DOWNLOAD=1 npm install --production
  cd /opt/tenant-app/tenant-frontend && npm install && npm run build
  PORT=5001 NODE_ENV=production pm2 restart tenant-dashboard --update-env || PORT=5001 NODE_ENV=production pm2 start /opt/tenant-app/tenant-dashboard/index.js --name tenant-dashboard --update-env
  pm2 save
  curl -sS http://127.0.0.1:5001/api/sync/status || true
  EOS

Troubleshooting
- Port 5001 in use (EADDRINUSE):
  - lsof -nP -iTCP:5001 -sTCP:LISTEN
  - kill the rogue process; ensure no LaunchDaemon auto-starts an old app.
  - Start with PM2 in fork mode as above.
- Puppeteer/Chromium download failures:
  - Use system Chrome/Chromium and set PUPPETEER_SKIP_DOWNLOAD=1 at install time.
- No lastSyncAt showing:
  - Trigger POST /api/sync and watch /api/sync/status; cooldown applies.
  - Check backend logs and logs/error.png.

Optional: Reverse proxy to 5001
- If you want :80/:443, place Nginx/Caddy in front to proxy to 127.0.0.1:5001. Keep PM2 backend unchanged.

Security
- Never commit .env or credentials. Keep .env.production only on server.

