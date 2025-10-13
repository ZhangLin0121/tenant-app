const mongoose = require('mongoose');

// 学生名单 - 22级硕博士
const studentsToTag = [
  "李文琴", "邬雨蝶", "郑晨旭", "程婧怡", "张宇恒", "张家豪",
  "袁旭阳", "易世豪", "胡乃文", "陈秋桦", "杨秉锟", "程俊雷",
  "许仕康", "谭正辉", "刘湘粤", "彭健", "杨宏潇", "金昊宇",
  "罗洋", "曹仁俊", "李弘毅", "刘雨廷", "杨东凝", "肖勇开",
  "胡慧", "孙雪寒", "刘昌龙", "李云龙", "兰小斌", "唐加伟",
  "孔文超", "朱景润", "韩国强", "邹砚成", "刘子正", "黄睿",
  "简昕玥", "陈贤文", "戴宇峰", "王春龙", "段鑫", "夏学志",
  "傅嘉恒", "王翠香", "徐婷", "陈轩妮", "匡霞", "孔德馨",
  "樊齐静", "刘卓凡", "梁雪词", "叶语涵", "胡泊", "张铁华",
  "叶子俊", "王向阳", "张道航", "路旭辉", "杨海航", "孔程浩",
  "王宜州", "任翔宇", "王辉鹏"
];

const tag = "22级硕博士"; // 清除空格

async function updateStudentTags() {
  try {
    // 连接数据库
    console.log('正在连接数据库...');
    await mongoose.connect('mongodb://127.0.0.1:27017/tenantDB');

    console.log('数据库连接成功');

    // 导入Student模型
    const Student = require('./models/student.model');

    let updatedCount = 0;
    let notFoundCount = 0;

    // 为每个学生更新标签
    for (const studentName of studentsToTag) {
      const result = await Student.updateMany(
        { name: studentName },
        { $set: { tag: tag } }
      );

      if (result.modifiedCount > 0) {
        console.log(`✓ 已更新 ${studentName} 的标签为 "${tag}"`);
        updatedCount += result.modifiedCount;
      } else {
        // 检查是否有这个学生
        const student = await Student.findOne({ name: studentName });
        if (!student) {
          console.log(`⚠️ 未找到学生: ${studentName}`);
          notFoundCount++;
        } else {
          console.log(`ℹ️ ${studentName} 的标签已经是 "${tag}"`);
        }
      }
    }

    console.log('\n=== 更新完成 ===');
    console.log(`成功更新: ${updatedCount} 个学生`);
    console.log(`未找到: ${notFoundCount} 个学生`);

  } catch (error) {
    console.error('更新失败:', error);
  } finally {
    await mongoose.connection.close();
    console.log('数据库连接已关闭');
  }
}

// 运行更新
updateStudentTags();