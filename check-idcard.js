const mongoose = require('mongoose');
const Student = require('./tenant-dashboard/models/student.model');
const config = require('./tenant-dashboard/config/db');

async function checkIdCardData() {
  try {
    await mongoose.connect(config.mongoURI);
    console.log('数据库连接成功');

    const students = await Student.find({}).select('name mobile idCard').limit(5);
    console.log('学生数据样本:');
    console.log(JSON.stringify(students, null, 2));

    const withIdCard = await Student.countDocuments({ idCard: { $exists: true, $ne: '' } });
    const total = await Student.countDocuments();
    console.log('\n统计:');
    console.log('总学生数:', total);
    console.log('有身份证的学生数:', withIdCard);

    // 检查最近的同步日志
    console.log('\n检查同步日志...');

  } catch (err) {
    console.error('错误:', err);
  } finally {
    await mongoose.connection.close();
  }
}

checkIdCardData();