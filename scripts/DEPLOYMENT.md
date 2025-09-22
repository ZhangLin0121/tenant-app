Deployment Record (xiebin)

Target Host
- Host: 192.168.0.177
- User: xiebin
- Ports: backend 5001 (serves API + static UI); optional old frontend on 5000

Paths
- App home: ~/tenant-app (user: xiebin)
- Backend: ~/tenant-app/tenant-dashboard
- Frontend: ~/tenant-app/tenant-frontend

Runtime
- Process manager: PM2
- Start backend: NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
- Access URL: http://192.168.0.177:5001

Environment
- Backend reads MONGO_URI/PORT from tenant-dashboard/.env.production when NODE_ENV=production
- Do NOT commit secrets; maintain credentials only on server

One‑Shot Manual Deploy (proven working)
1) Package locally
   - tar current repo (exclude node_modules) to /tmp/tenant-app-<ts>.tgz
2) Copy + extract on server
   - scp /tmp/tenant-app-*.tgz to xiebin@192.168.0.177:/tmp/
   - ssh: mkdir -p ~/tenant-app && tar -xzf /tmp/<pkg>.tgz -C ~/tenant-app --strip-components=1
3) Configure env
   - On server: create/update ~/tenant-app/tenant-dashboard/.env.production
     - MONGO_URI=mongodb://localhost:27017/tenant_dashboard
     - PORT=5001
     - (optional) PLATFORM_USERNAME=... / PLATFORM_PASSWORD=...
4) Install deps
   - Backend: PUPPETEER_SKIP_DOWNLOAD=1 npm install --omit=dev (skip Chromium)
   - Frontend: npm ci || npm install && npm run build
5) Start with PM2
   - pm2 stop/delete tenant-dashboard || true
   - NODE_ENV=production pm2 start tenant-dashboard/index.js --name tenant-dashboard
   - pm2 save
6) Verify
   - curl http://127.0.0.1:5001/api/sync/status
   - pm2 status; lsof -nP -iTCP:5001 -sTCP:LISTEN

Primary Script (preferred)
- scripts/deploy-xiebin.sh
  - Packs, uploads, extracts, writes .env.production (MONGO_URI/PORT), installs deps (skips Chromium), builds frontend, and starts PM2 with NODE_ENV=production.
  - Supports sshpass via SSHPASS env var (optional).

Secrets
- Store platform credentials only on server in .env.production
- After editing, restart backend: pm2 restart tenant-dashboard --update-env

Troubleshooting
- Puppeteer download blocked: set PUPPETEER_SKIP_DOWNLOAD=1 for npm install
- Port 5001 in use: lsof -ti :5001 | xargs -r kill -9; pm2 restart tenant-dashboard
- Missing PM2: npm install -g pm2
