const students = [
  { name: "李文琴", tag: "22级硕博士" },
  { name: "邬雨蝶", tag: "22级硕博士" },
  { name: "郑晨旭", tag: "22级硕博士" },
  { name: "程婧怡", tag: "22级硕博士" },
  { name: "张宇恒", tag: "22级硕博士" },
  { name: "张家豪", tag: "22级硕博士" },
  { name: "袁旭阳", tag: "22级硕博士" },
  { name: "易世豪", tag: "22级硕博士" },
  { name: "胡乃文", tag: "22级硕博士" },
  { name: "陈秋桦", tag: "22级硕博士" },
  { name: "杨秉锟", tag: "22级硕博士" },
  { name: "程俊雷", tag: "22级硕博士" },
  { name: "许仕康", tag: "22级硕博士" },
  { name: "谭正辉", tag: "22级硕博士" },
  { name: "刘湘粤", tag: "22级硕博士" },
  { name: "彭健", tag: "22级硕博士" },
  { name: "杨宏潇", tag: "22级硕博士" },
  { name: "金昊宇", tag: "22级硕博士" },
  { name: "罗洋", tag: "22级硕博士" },
  { name: "曹仁俊", tag: "22级硕博士" },
  { name: "李弘毅", tag: "22级硕博士" },
  { name: "刘雨廷", tag: "22级硕博士" },
  { name: "杨东凝", tag: "22级硕博士" },
  { name: "肖勇开", tag: "22级硕博士" },
  { name: "胡慧", tag: "22级硕博士" },
  { name: "孙雪寒", tag: "22级硕博士" },
  { name: "刘昌龙", tag: "22级硕博士" },
  { name: "李云龙", tag: "22级硕博士" },
  { name: "兰小斌", tag: "22级硕博士" },
  { name: "唐加伟", tag: "22级硕博士" },
  { name: "孔文超", tag: "22级硕博士" },
  { name: "朱景润", tag: "22级硕博士" },
  { name: "韩国强", tag: "22级硕博士" },
  { name: "邹砚成", tag: "22级硕博士" },
  { name: "刘子正", tag: "22级硕博士" },
  { name: "黄睿", tag: "22级硕博士" },
  { name: "简昕玥", tag: "22级硕博士" },
  { name: "陈贤文", tag: "22级硕博士" },
  { name: "戴宇峰", tag: "22级硕博士" },
  { name: "王春龙", tag: "22级硕博士" },
  { name: "段鑫", tag: "22级硕博士" },
  { name: "夏学志", tag: "22级硕博士" },
  { name: "傅嘉恒", tag: "22级硕博士" },
  { name: "王翠香", tag: "22级硕博士" },
  { name: "徐婷", tag: "22级硕博士" },
  { name: "陈轩妮", tag: "22级硕博士" },
  { name: "匡霞", tag: "22级硕博士" },
  { name: "孔德馨", tag: "22级硕博士" },
  { name: "樊齐静", tag: "22级硕博士" },
  { name: "刘卓凡", tag: "22级硕博士" },
  { name: "梁雪词", tag: "22级硕博士" },
  { name: "叶语涵", tag: "22级硕博士" },
  { name: "胡泊", tag: "22级硕博士" },
  { name: "张铁华", tag: "22级硕博士" },
  { name: "叶子俊", tag: "22级硕博士" },
  { name: "王向阳", tag: "22级硕博士" },
  { name: "张道航", tag: "22级硕博士" },
  { name: "路旭辉", tag: "22级硕博士" },
  { name: "杨海航", tag: "22级硕博士" },
  { name: "孔程浩", tag: "22级硕博士" },
  { name: "王宜州", tag: "22级硕博士" },
  { name: "任翔宇", tag: "22级硕博士" },
  { name: "王辉鹏", tag: "22级硕博士" }
];

// 分批导入，避免请求过大
const batchSize = 20;

async function importStudents() {
  console.log(`开始导入 ${students.length} 个学生...`);

  for (let i = 0; i < students.length; i += batchSize) {
    const batch = students.slice(i, i + batchSize);

    try {
      const response = await fetch('http://localhost:5001/api/students/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`批次 ${Math.floor(i/batchSize) + 1}: 成功导入 ${batch.length} 个学生`);
        console.log(`  新增: ${result.data.upserted}, 更新: ${result.data.modified}, 匹配: ${result.data.matched}`);
      } else {
        console.error(`批次 ${Math.floor(i/batchSize) + 1}: 导入失败 - ${result.message}`);
      }

    } catch (error) {
      console.error(`批次 ${Math.floor(i/batchSize) + 1}: 请求失败 - ${error.message}`);
    }

    // 等待一下避免请求过快
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('导入完成！');
}

importStudents();