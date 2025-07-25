const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB 连接成功...');
  } catch (err) {
    console.error('MongoDB 连接失败:', err.message);
    // 连接失败时退出进程
    process.exit(1);
  }
};

module.exports = connectDB;