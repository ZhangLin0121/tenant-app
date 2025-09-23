const path = require('path');
const fs = require('fs');
// 基础环境变量（开发）
require('dotenv').config({ path: path.join(__dirname, '.env') });
// 生产环境覆盖（若存在）
if (process.env.NODE_ENV === 'production') {
  const prodEnv = path.join(__dirname, '.env.production');
  if (fs.existsSync(prodEnv)) {
    require('dotenv').config({ path: prodEnv, override: true });
  }
}

const express = require('express');
const connectDB = require('./config/db');
const { runSync, reconcileStudentsWithTenants } = require('./services/syncService.js');
const roomRoutes = require('./routes/room.routes');
const Student = require('./models/student.model');
const Tenant = require('./models/tenant.model');
// === 已修复：使用您项目中的正确文件名 ===
const tenantRoutes = require('./routes/tenant.routes.js'); 
const studentRoutes = require('./routes/student.routes.js');

// ---- 启动后台服务 ----
connectDB();
const app = express();
// Increase body limits to support bulk JSON import
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---- API 路由 ----
app.use('/api/tenants', tenantRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/rooms', roomRoutes);

// ----- 同步状态：用于前端展示与限流 -----
let isSyncing = false;
let lastSyncAt = null; // ISO 字符串，记录最近一次同步完成时间
let cooldownUntil = 0; // 毫秒时间戳：冷却期内拒绝触发，但不算正在同步

// 状态查询（若内存无时间，则回退到 DB 最新快照时间）
app.get('/api/sync/status', async (_req, res) => {
  try {
    const now = Date.now();
    const cooldownRemainingMs = Math.max(0, cooldownUntil - now);
    let effectiveLast = lastSyncAt;
    if (!effectiveLast) {
      const latest = await Tenant.findOne({}, { updatedAt: 1 }, { sort: { updatedAt: -1 } }).lean();
      if (latest?.updatedAt) effectiveLast = new Date(latest.updatedAt).toISOString();
    }
    res.json({ success: true, data: { isSyncing, lastSyncAt: effectiveLast || null, cooldownRemainingMs } });
  } catch (e) {
    res.json({ success: true, data: { isSyncing, lastSyncAt: lastSyncAt || null, cooldownRemainingMs: Math.max(0, cooldownUntil - Date.now()) } });
  }
});

// 手动触发同步
app.post('/api/sync', async (req, res) => {
  if (!process.env.PLATFORM_USERNAME || !process.env.PLATFORM_PASSWORD) {
    return res.status(400).json({ success: false, message: '未配置平台账号密码，请先在 tenant-dashboard/.env 或 .env.production 中设置 PLATFORM_USERNAME/PLATFORM_PASSWORD 后再重试。' });
  }
  if (isSyncing) {
    return res.status(429).json({ success: false, message: '同步任务正在进行中，请稍后再试。' });
  }
  if (Date.now() < cooldownUntil) {
    return res.status(429).json({ success: false, message: '同步触发过于频繁，请稍后再试。' });
  }
  
  try {
    isSyncing = true;
    console.log('收到手动刷新指令，开始执行数据同步...');
    runSync()
      .then((ok) => {
        console.log('手动刷新任务在后台执行完毕。');
        if (ok) lastSyncAt = new Date().toISOString();
      })
      .catch(() => {})
      .finally(() => {
        isSyncing = false; // 运行结束即恢复可用状态
        // 设置冷却 5 分钟，防止频繁触发
        cooldownUntil = Date.now() + 5 * 60 * 1000;
      });
    res.json({ success: true, message: '已成功触发后台同步任务，数据将在稍后更新。' });
  } catch (error) {
    res.status(500).json({ success: false, message: '触发同步任务失败。' });
  }
});

// 仅对账：将学生主档的标签/入住信息回写到租客快照（不触发抓取）
app.post('/api/sync/reconcile', async (_req, res) => {
  try {
    await reconcileStudentsWithTenants();
    res.json({ success: true, message: '已完成学生与租客快照的对账更新。' });
  } catch (e) {
    console.error('对账接口执行失败:', e);
    res.status(500).json({ success: false, message: '对账失败' });
  }
});

// 统计概览：累计与当前在住的标签分布
app.get('/api/stats', async (_req, res) => {
  try {
    const [totalStudents, perTagTotal, checkedIn, perTagCheckedIn] = await Promise.all([
      Student.countDocuments({}),
      Student.aggregate([{ $group: { _id: '$tag', count: { $sum: 1 } } }]),
      Student.countDocuments({ isCheckedIn: true }),
      Student.aggregate([{ $match: { isCheckedIn: true } }, { $group: { _id: '$tag', count: { $sum: 1 } } }]),
    ]);

    const mapAgg = (arr) => arr.reduce((acc, it) => { acc[it._id || ''] = it.count; return acc; }, {});
    res.json({ success: true, data: {
      totalStudents,
      perTagTotal: mapAgg(perTagTotal),
      checkedIn,
      perTagCheckedIn: mapAgg(perTagCheckedIn),
    }});
  } catch (e) {
    console.error('统计接口失败:', e);
    res.status(500).json({ success: false, message: '统计失败' });
  }
});


// ---- 根路由 ----
// ---- 前端静态资源（如果存在 dist，则直接提供前端）----
const distDir = path.resolve(__dirname, '../tenant-frontend/dist');
app.use('/assets', express.static(path.join(distDir, 'assets')));
app.get('/', (_req, res) => {
  const idx = path.join(distDir, 'index.html');
  res.sendFile(idx, (err) => {
    if (err) res.status(200).send('租客看板后台服务已启动。');
  });
});
app.get('/index.html', (_req, res) => {
  const idx = path.join(distDir, 'index.html');
  res.sendFile(idx, (err) => {
    if (err) res.status(404).send('Not Found');
  });
});
// 前端路由回退（避免刷新 404），排除 /api 前缀
app.get(/^\/(?!api).*/, (_req, res) => {
  const idx = path.join(distDir, 'index.html');
  res.sendFile(idx, (err) => {
    if (err) res.status(404).send('Not Found');
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`服务运行在端口 ${PORT}。`));


// ---- 同步任务 ----
if (process.env.PLATFORM_USERNAME && process.env.PLATFORM_PASSWORD) {
  console.log('服务启动，检测到平台账户，执行一次初始数据同步...');
  runSync()
    .then((ok) => { if (ok) lastSyncAt = new Date().toISOString(); })
    .catch(() => {});
} else {
  console.log('服务启动，跳过自动同步：未配置平台账户。');
}

console.log('后台服务已配置完毕，已移除定时同步任务。');
