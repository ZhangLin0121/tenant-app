知寓同步改造 —— 回滚说明（2026-09-30）

改动内容：
  1) 新增 services/httpClient.js —— 纯 HTTP 登录 + 抓取
     登录复刻自前端算法：checkcode=((25214903917*m1)&65535)%1e6
     密码加密 AES-128-ECB/PKCS7，密钥 "EMCP.WebApi.Auth"
     登录接口 GET /apiv3/auth/Login?id=&pwd=&checkcode=&opt=3
  2) services/syncService.js 改用纯 HTTP 抓取，Puppeteer 降级为兜底

回滚步骤：
  cd /opt/tenant-app/tenant-dashboard/services
  cp syncService.js.bak.<时间戳> syncService.js
  rm -f httpClient.js
  pm2 restart tenant-dashboard

临时回退到旧方式（不删代码）：
  在 .env 中加 SYNC_USE_HTTP=false
  pm2 restart tenant-dashboard --update-env

注意：Puppeteer 兜底路径仍需要 Chrome，若已卸载 /opt/google/chrome 请勿使用兜底。
