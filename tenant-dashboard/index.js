require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const connectDB = require('./config/db');
const { runSync } = require('./services/syncService.js');
const tenantRoutes = require('./routes/tenant.routes.js');

// ---- 启动后台服务 ----
connectDB();
const app = express();
app.use(express.json());

// ---- API 路由 ----
app.use('/api/tenants', tenantRoutes);

// ----- 新增：用于手动触发同步的 API 端点 -----
let isSyncing = false; // 添加一个状态锁，防止重复触发
app.post('/api/sync', async (req, res) => {
  if (isSyncing) {
    // 如果已经在同步中，则返回提示，避免重复执行
    return res.status(429).json({ success: false, message: '同步任务正在进行中，请稍后再试。' });
  }
  
  try {
    isSyncing = true;
    console.log('收到手动刷新指令，开始执行数据同步...');
    // 异步执行，立即返回响应给前端
    runSync().then(() => {
        console.log('手动刷新任务在后台执行完毕。');
    });
    res.json({ success: true, message: '已成功触发后台同步任务，数据将在稍后更新。' });
  } catch (error) {
    res.status(500).json({ success: false, message: '触发同步任务失败。' });
  } finally {
    // 无论成功与否，一段时间后都应该释放锁，例如5分钟后
    // 这是一个简单的保护，防止任务失败后锁一直存在
    setTimeout(() => {
        isSyncing = false;
    }, 300000); // 5 minutes
  }
});


// ---- 根路由 ----
app.get('/', (req, res) => {
  res.send('租客看板后台服务已启动。');
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`服务运行在端口 ${PORT}。`));


// ---- 定时同步任务 ----

// 1. 在服务启动时，为方便开发，可以先执行一次
// 在生产环境中，可以注释掉这一行，完全依赖定时任务
console.log('服务启动，为确保数据存在，立即执行一次初始数据同步...');
runSync();

// 2. 将定时任务修改为每天的 0点0分 执行
// '0 0 * * *' 是 Cron 表达式，代表 "在 0分, 0点, 对于任何月, 对于任何星期"
cron.schedule('0 0 * * *', () => {
  console.log('【定时任务触发】：开始执行每日的数据同步...');
  runSync();
}, {
  scheduled: true,
  timezone: "Asia/Shanghai" // 建议指定时区，确保是北京时间的0点
});

console.log('后台服务已配置完毕，定时同步任务已设定为每天 00:00 执行。');