<script setup>
import { ref, onMounted, computed } from 'vue';
import api from '../utils/api.js';

const items = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const tags = ref([]);
const activeTag = ref('');
const q = ref('');
const loading = ref(false);
const isCheckedInFilter = ref('all'); // 'all' | 'true' | 'false'
const onlyTagged = ref(true); // “仅有标签”统计（默认开启，满足“已入住且有标签”的口径）

const showModal = ref(false);
const showImport = ref(false);
const editing = ref(null);
const form = ref({
  name: '', mobile: '', idCard: '', education: '', university: '', practiceCompany: '',
  isCheckedIn: false, roomNumber: '', checkInAt: '', checkOutAt: '',
  tag: '', studentNo: '', grade: '', major: '', email: ''
});
const bulkJsonText = ref('[\n  { "姓名": "张三", "电话": "13800000001", "身份证": "4201...", "学历": "硕士", "毕业院校": "XX大学", "实践企业": "XX公司", "是否入住": "是", "入住房间号": "1203", "入住时间": "2024-09-01", "离开时间": "" }\n]');

// 常用标签（与看板一致）+ 当前已有标签去重合并，供编辑选择
const allowedTags = ['2022级工程硕博士','2023级工程硕博士','2024级工程硕博士','实习实践'];
const editTagOptions = computed(() => {
  const set = new Set([...(tags.value || []).filter(Boolean), ...allowedTags]);
  return Array.from(set.values());
});

// 标签选择菜单
const showTagMenu = ref(false);
const showAllTagOptions = ref(false); // 点击“▼”时展示全部；输入时按关键字过滤
const toggleTagMenu = () => {
  if (showTagMenu.value) { showTagMenu.value = false; return; }
  showAllTagOptions.value = true;
  showTagMenu.value = true;
};
const pickTag = (t) => { form.value.tag = t; showTagMenu.value = false; };
const openTagMenu = () => { showAllTagOptions.value = false; showTagMenu.value = true; };
const onTagInput = () => { showAllTagOptions.value = false; showTagMenu.value = true; };
const filteredTagOptions = computed(() => {
  const opts = editTagOptions.value;
  if (showAllTagOptions.value) return opts;
  const kw = String(form.value.tag || '').trim().toLowerCase();
  if (!kw) return opts;
  return opts.filter(t => String(t).toLowerCase().includes(kw));
});

const fetchTags = async () => {
  try {
    const res = await api.get('/api/students/tags');
    if (res.data?.success) {
      // 保留空字符串，用于显示“未分组”（否则手动分项求和会漏掉未标记的人）
      const arr = Array.isArray(res.data.data) ? res.data.data : [];
      tags.value = arr; // 不再过滤 Boolean
    }
  } catch {}
};

const fetchList = async () => {
  loading.value = true;
  try {
    const params = { tag: activeTag.value, q: q.value, page: page.value, pageSize: pageSize.value };
    if (isCheckedInFilter.value !== 'all') params.isCheckedIn = isCheckedInFilter.value;
    if (onlyTagged.value) params.excludeEmptyTag = true;
    const res = await api.get('/api/students', { params });
    if (res.data?.success) {
      items.value = res.data.data.items;
      total.value = res.data.data.total;
    }
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await fetchTags();
  await fetchList();
});

const columns = computed(() => [
  'name','mobile','idCard','education','university',
  'practiceCompany','isCheckedIn','roomNumber','checkInAt','checkOutAt','tag'
]);

const headerMap = {
  name: '姓名', mobile: '电话', idCard: '身份证', education: '学历', university: '毕业院校',
  practiceCompany: '实践企业', isCheckedIn: '是否入住', roomNumber: '入住房间号',
  checkInAt: '入住时间', checkOutAt: '离开时间', tag: '标签'
};

const openCreate = () => {
  editing.value = null;
  form.value = { name: '', mobile: '', idCard: '', education: '', university: '', practiceCompany: '', isCheckedIn: false, roomNumber: '', checkInAt: '', checkOutAt: '', tag: '' };
  showModal.value = true;
};

const openEdit = (row) => {
  editing.value = row._id;
  form.value = JSON.parse(JSON.stringify(row));
  if (form.value.checkInAt) form.value.checkInAt = String(form.value.checkInAt).slice(0,10);
  if (form.value.checkOutAt) form.value.checkOutAt = String(form.value.checkOutAt).slice(0,10);
  showModal.value = true;
};

const save = async () => {
  if (!form.value.name) return alert('姓名必填');
  try {
    if (editing.value) {
      await api.patch(`/api/students/${editing.value}`, form.value);
    } else {
      await api.post('/api/students', form.value);
    }
    showModal.value = false;
    await fetchTags();
    await fetchList();
    notifyStudentsChanged();
  } catch (e) {
    alert('保存失败');
  }
};

const doImport = async () => {
  let arr = [];
  try {
    const parsed = JSON.parse(bulkJsonText.value || '[]');
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return alert('请粘贴一个非空的 JSON 数组');
    }
    // 直接传给后端做自适应映射
    arr = parsed;
  } catch (e) {
    return alert('JSON 解析失败，请检查格式');
  }

  try {
    await api.post('/api/students/bulk', arr);
    showImport.value = false;
    await fetchTags();
    await fetchList();
    notifyStudentsChanged();
  } catch (e) {
    alert('导入失败，请检查数据结构');
  }
};

const removeOne = async (row) => {
  if (!confirm(`确认删除学生「${row.name}」？`)) return;
  try {
    await api.delete(`/api/students/${row._id}`);
    await fetchTags();
    await fetchList();
    notifyStudentsChanged();
  } catch {
    alert('删除失败');
  }
};

// Excel/CSV 导入
const fileInput = ref(null);
const triggerExcel = async () => {
  await ensureXLSX();
  fileInput.value && fileInput.value.click();
};

const ensureXLSX = () => {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('加载 XLSX 失败'));
    document.head.appendChild(s);
  });
};

const onFileChange = async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    await ensureXLSX();
    const data = await readFileAsArrayBuffer(file);
    const wb = window.XLSX.read(new Uint8Array(data), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    // Use formatted values to keep dates as strings (e.g., YYYY-MM-DD)
    const json = window.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    if (!Array.isArray(json) || json.length === 0) {
      return alert('表格为空');
    }
    await api.post('/api/students/bulk', json);
    await fetchTags();
    await fetchList();
    alert('导入成功');
  } catch (err) {
    console.error(err);
    alert('导入失败，请检查文件内容');
  } finally {
    e.target.value = '';
  }
};

const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsArrayBuffer(file);
});

const displayCell = (row, col) => {
  if (col === 'isCheckedIn') return row.isCheckedIn ? '是' : '否';
  if (col === 'checkInAt' || col === 'checkOutAt') {
    return row[col] ? new Date(row[col]).toLocaleDateString() : '';
  }
  return row[col] ?? '';
};

// 展示用标签列表：当“仅有标签”开启时，不显示“未分组”
const displayTags = computed(() => {
  if (onlyTagged.value) return (tags.value || []).filter(t => t !== '');
  return tags.value || [];
});

// 下载 Excel 模板（包含「导入模板」和「说明」两个工作表）
const downloadExcelTemplate = async () => {
  try {
    await ensureXLSX();
    const header = [
      '姓名','电话','身份证','标签','学历','毕业院校','实践企业','是否入住','入住房间号','入住时间','离开时间','学号','邮箱','年级','专业'
    ];
    const ws = window.XLSX.utils.aoa_to_sheet([header]);
    // 设置列宽更友好
    ws['!cols'] = header.map(() => ({ wch: 14 }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '导入模板');

    const tipRows = [
      ['使用说明'],
      ['1. 仅第一行作为表头，请不要删除或更改列名。'],
      ['2. 是否入住：填写 是/否。'],
      ['3. 入住/离开时间：使用 YYYY-MM-DD 格式（例如 2024-09-01）。'],
      ['4. 入住房间号：例如 1203。'],
      ['5. 标签：可输入工程硕博士/实习实践/或自定义标签。'],
      ['6. 仅姓名必填；建议至少提供电话或身份证以便去重合并。'],
      ['7. 只会读取第一个工作表（导入模板）的数据，说明页不会被导入。'],
    ];
    const ws2 = window.XLSX.utils.aoa_to_sheet(tipRows);
    ws2['!cols'] = [{ wch: 80 }];
    window.XLSX.utils.book_append_sheet(wb, ws2, '说明');

    window.XLSX.writeFile(wb, '学生导入模板.xlsx');
  } catch (e) {
    alert('生成模板失败');
  }
};

// 通知其它视图（看板/统计）刷新：同页、同域其它标签页均可感知
const notifyStudentsChanged = () => {
  try { window.dispatchEvent(new Event('students-updated')); } catch {}
  try { const bc = new BroadcastChannel('tenant-app'); bc.postMessage({ type: 'students-updated' }); bc.close(); } catch {}
  try { localStorage.setItem('tenant-app:update', String(Date.now())); } catch {}
};
</script>

<template>
  <div class="bg-white rounded-lg shadow p-4">
  <div class="flex flex-wrap items-center gap-2 mb-4">
    <div class="flex gap-2 overflow-x-auto">
      <button class="px-3 py-1 rounded border" :class="activeTag==='' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'" @click="activeTag=''; page=1; fetchList()">全部</button>
      <button v-for="t in displayTags" :key="'tag_'+t" class="px-3 py-1 rounded border" :class="activeTag===t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'" @click="activeTag=t; page=1; fetchList()">{{ t || '未分组' }}</button>
    </div>
    <div class="flex-1"></div>
    <!-- 顶部总数摘要，避免滚动到底部查看 -->
    <div class="text-sm text-gray-600 whitespace-nowrap">共 {{ total }} 条</div>
    <select v-model="isCheckedInFilter" @change="page=1; fetchList()" class="border rounded px-2 py-1 text-sm">
      <option value="all">全部</option>
      <option value="true">已入住</option>
      <option value="false">未入住</option>
    </select>
    <label class="text-sm flex items-center gap-1">
      <input type="checkbox" v-model="onlyTagged" @change="page=1; fetchList()" /> 仅有标签
    </label>
    <input v-model="q" @keyup.enter="page=1; fetchList()" placeholder="搜索姓名/电话/身份证/院校/企业" class="border rounded px-3 py-1 text-sm" />
    <button @click="page=1; fetchList()" class="px-3 py-1 rounded bg-gray-100 border">搜索</button>
    <button @click="openCreate" class="px-3 py-1 rounded bg-blue-600 text-white">新增学生</button>
      <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="onFileChange" />
      <button @click="downloadExcelTemplate" class="px-3 py-1 rounded bg-gray-700 text-white">下载模板</button>
      <button @click="triggerExcel" class="px-3 py-1 rounded bg-amber-600 text-white">导入Excel</button>
      <button @click="showImport=true" class="px-3 py-1 rounded bg-emerald-600 text-white">导入JSON</button>
    </div>

    <div v-if="loading" class="text-gray-500 text-sm">加载中...</div>

    <div class="overflow-auto">
      <table class="min-w-full text-sm">
        <thead>
          <tr class="bg-gray-50 text-left">
            <th v-for="col in columns" :key="col" class="px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{{ headerMap[col] || col }}</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in items" :key="row._id" class="border-t">
            <td v-for="col in columns" :key="col" class="px-3 py-2 whitespace-nowrap">{{ displayCell(row, col) }}</td>
            <td class="px-3 py-2 text-right whitespace-nowrap">
              <button class="px-2 py-1 text-blue-600" @click="openEdit(row)">编辑</button>
              <button class="px-2 py-1 text-red-600" @click="removeOne(row)">删除</button>
            </td>
          </tr>
          <tr v-if="!loading && items.length===0">
            <td :colspan="columns.length+1" class="text-center text-gray-500 py-6">暂无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-end mt-3 text-sm text-gray-600">
      <div class="flex items-center gap-2">
        <button class="px-2 py-1 border rounded" :disabled="page<=1" @click="page=Math.max(1,page-1); fetchList()">上一页</button>
        <span>第 {{ page }} 页</span>
        <button class="px-2 py-1 border rounded" :disabled="page*pageSize>=total" @click="page=page+1; fetchList()">下一页</button>
      </div>
    </div>

    <div v-if="showModal" @click.self="showModal=false" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg shadow p-4 w-full max-w-lg">
        <h3 class="text-lg font-bold mb-3">{{ editing ? '编辑学生' : '新增学生' }}</h3>
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm">姓名<input v-model="form.name" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">电话<input v-model="form.mobile" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">身份证<input v-model="form.idCard" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">学历<input v-model="form.education" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">毕业院校<input v-model="form.university" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">实践企业<input v-model="form.practiceCompany" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm relative">标签
            <div class="mt-1 flex gap-2 items-center">
              <input v-model="form.tag" placeholder="输入或选择标签" class="border rounded px-2 py-1 w-full" @focus="openTagMenu" @input="onTagInput" />
              <button type="button" class="px-2 py-1 text-xs border rounded bg-gray-50" @click="toggleTagMenu">▼</button>
            </div>
            <!-- 下拉菜单（显示可选标签，支持按输入过滤） -->
            <div v-if="showTagMenu" class="absolute z-20 mt-1 w-full bg-white border rounded shadow">
              <div class="max-h-56 overflow-auto text-sm">
                <div class="px-3 py-2 text-gray-500">快速选择</div>
                <div class="px-3 py-2 hover:bg-gray-50 cursor-pointer" @click="pickTag('')">无</div>
                <div v-for="t in filteredTagOptions" :key="'pick-'+t" class="px-3 py-2 hover:bg-gray-50 cursor-pointer" @click="pickTag(t)">{{ t }}</div>
              </div>
            </div>
          </label>
          <label class="text-sm">是否入住
            <select v-model="form.isCheckedIn" class="mt-1 border rounded px-2 py-1 w-full">
              <option :value="true">是</option>
              <option :value="false">否</option>
            </select>
          </label>
          <label class="text-sm">入住房间号<input v-model="form.roomNumber" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">入住时间<input type="date" v-model="form.checkInAt" class="mt-1 border rounded px-2 py-1 w-full" /></label>
          <label class="text-sm">离开时间<input type="date" v-model="form.checkOutAt" class="mt-1 border rounded px-2 py-1 w-full" /></label>
        </div>
        
        <div class="mt-4 flex justify-end gap-2">
          <button class="px-3 py-1 border rounded" @click="showModal=false">取消</button>
          <button class="px-3 py-1 bg-blue-600 text-white rounded" @click="save">保存</button>
        </div>
      </div>
    </div>

    <!-- Import JSON Modal -->
    <div v-if="showImport" @click.self="showImport=false" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg shadow p-4 w-full max-w-2xl">
        <h3 class="text-lg font-bold mb-3">批量导入（JSON 数组）</h3>
        <p class="text-xs text-gray-600 mb-2">粘贴形如 <code>[{...},{...}]</code> 的数组；支持中文字段：姓名, 电话, 身份证, 学历, 毕业院校, 实践企业, 是否入住, 入住房间号, 入住时间, 离开时间；也支持英文等价字段。</p>
        <textarea v-model="bulkJsonText" class="mt-1 border rounded px-2 py-1 w-full font-mono text-xs h-64"></textarea>
        <div class="mt-3 flex justify-end gap-2">
          <button class="px-3 py-1 border rounded" @click="showImport=false">取消</button>
          <button class="px-3 py-1 bg-emerald-600 text-white rounded" @click="doImport">导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
</style>
