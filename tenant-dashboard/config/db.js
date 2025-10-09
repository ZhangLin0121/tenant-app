const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB 连接成功...');
  } catch (err) {
    console.error('MongoDB 连接失败:', err.message);
    console.log('应用将继续运行，但数据库功能不可用');
    // 连接失败时不退出进程，让应用继续运行
  }
};

module.exports = connectDB;