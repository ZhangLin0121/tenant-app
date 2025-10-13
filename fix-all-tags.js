// 修复所有学生标签，确保所有旧标签都更新为新标签
const tagMappings = [
  { oldTag: "22级硕博士", newTag: "2022级工程硕博士" },
  { oldTag: "23级硕博士", newTag: "2023级工程硕博士" },
  { oldTag: "24级硕博士", newTag: "2024级工程硕博士" }
];

async function fixAllTags() {
  const baseURL = 'http://localhost:5001';

  for (const mapping of tagMappings) {
    console.log(`\n正在修复标签: "${mapping.oldTag}" -> "${mapping.newTag}"`);

    try {
      // 获取所有带有旧标签的学生
      const response = await fetch(`${baseURL}/api/students?tag=${encodeURIComponent(mapping.oldTag)}`);
      const result = await response.json();

      if (result.success && result.data && result.data.items && result.data.items.length > 0) {
        console.log(`找到 ${result.data.items.length} 个学生需要修复`);

        let updatedCount = 0;
        // 批量更新这些学生
        for (const student of result.data.items) {
          try {
            const updateResponse = await fetch(`${baseURL}/api/students/by-tenant/${student._id}/tag`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ tag: mapping.newTag }),
            });

            const updateResult = await updateResponse.json();
            if (updateResult.success) {
              console.log(`✓ 已修复 ${student.name} 的标签为 "${mapping.newTag}"`);
              updatedCount++;
            } else {
              console.log(`✗ 修复 ${student.name} 失败: ${updateResult.message}`);
            }
          } catch (error) {
            console.log(`✗ 修复 ${student.name} 时出错: ${error.message}`);
          }

          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 30));
        }

        console.log(`✓ 成功修复了 ${updatedCount} 个学生的标签`);
      } else {
        console.log(`没有找到标签为 "${mapping.oldTag}" 的学生`);
      }
    } catch (error) {
      console.error(`获取学生列表失败: ${error.message}`);
    }
  }

  console.log('\n=== 所有标签修复完成 ===');
}

// 运行修复
fixAllTags();