<script setup>
import { ref, onMounted, onUnmounted, computed, watch, watchEffect } from 'vue';
import api from '../utils/api.js';

// --- 状态变量 ---
const buildingData = ref({});
const isLoading = ref(true);
const errorMsg = ref('');
const isModalOpen = ref(false);
const selectedRoom = ref(null);
const selectedRoomNumber = ref(null);
const isRefreshing = ref(false);
const syncStatus = ref({ isSyncing: false, lastSyncAt: null, cooldownRemainingMs: 0 });
let syncTimer = null;
// 视图筛选：是否入住
const occupancyFilters = ref({
  all: true,
  checkedIn: false,
  vacant: false
});

watch(() => occupancyFilters.value.all, (val) => {
  if (val) {
    occupancyFilters.value.checkedIn = false;
    occupancyFilters.value.vacant = false;
  }
});

watch(() => occupancyFilters.value.checkedIn, (val) => {
  if (val) {
    occupancyFilters.value.all = false;
  }
});

watch(() => occupancyFilters.value.vacant, (val) => {
  if (val) {
    occupancyFilters.value.all = false;
  }
});

watchEffect(() => {
  const filters = occupancyFilters.value;
  if (!filters.all && !filters.checkedIn && !filters.vacant) {
    occupancyFilters.value.all = true;
  }
});

// --- 汇报统计 ---
const stats = ref({ totalStudents: 0, perTagTotal: {}, checkedIn: 0, perTagCheckedIn: {} });
const reportText = computed(() => {
  const last = syncStatus.value.lastSyncAt ? new Date(syncStatus.value.lastSyncAt) : new Date();
  const tsDate = `${last.getFullYear()}年${String(last.getMonth()+1).padStart(2,'0')}月${String(last.getDate()).padStart(2,'0')}日`;
  const occ = statistics.value.occupiedRooms;
  const totalRooms = 238;
  // 面积统计：50平总 100（2~20 层每层5间=95，加 1层5间=100），35平总 138（共238）
  let used50 = 0; let used35 = 0;
  for (const f in buildingData.value) {
    for (const r in buildingData.value[f]) {
      if (roomIs50(r)) used50++; else used35++;
    }
  }
  const total50 = 100, total35 = 138;
  const free50 = Math.max(0, (total50 - used50) - flaggedVacantCounts.value.n50);
  const free35 = Math.max(0, (total35 - used35) - flaggedVacantCounts.value.n35);
  const pt = stats.value.perTagTotal || {}; const pci = stats.value.perTagCheckedIn || {};
  const order = ['不可用','2022级工程硕博士','2023级工程硕博士','2024级工程硕博士','中信科','实习实践','未标记','未入住'];
  const fmtLine = (map) => order
    .map(k => `${k}：${map[k] || 0}间`)
    .join('；');

  // 房间分类（238 间）：不可用优先；已入住按主租客/房间标签；无标签记“未标记”；无住户记“未入住”
  const roomCategoryCounts = (() => {
    const counts = { '不可用': 0, '2022级工程硕博士': 0, '2023级工程硕博士': 0, '2024级工程硕博士': 0, '中信科': 0, '实习实践': 0, '未标记': 0, '未入住': 0 };
    for (let floor = 1; floor <= totalFloors; floor++) {
      for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
        const rn = getRoomNumberFromLayoutIndex(floor, idx);
        if (rn === null) continue;
        const flagged = roomFlags.value[String(rn)];
        if (flagged) { counts['不可用']++; continue; }
        const roomInfo = buildingData.value[floor]?.[rn];
        if (roomInfo && roomInfo.length > 0) {
          const main = roomInfo.find(t => t.isMain) || roomInfo[0];
          const t = normalizeTag((main.tag || '').trim() || (roomFlags.value[String(rn)]?.roomTag || ''));
          counts[t && t !== '' ? t : '未标记']++;
        } else {
          counts['未入住']++;
        }
      }
    }
    return counts;
  })();

  // 面积分布（互斥分类）：不可用/已用/可用
  const areaStats = (() => {
    let un50=0, use50=0, free50x=0; let un35=0, use35=0, free35x=0;
    for (let floor = 1; floor <= totalFloors; floor++) {
      for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
        const rn = getRoomNumberFromLayoutIndex(floor, idx);
        if (rn === null) continue;
        const is50 = roomIs50(rn);
        const flagged = !!roomFlags.value[String(rn)];
        const occupied = !!(buildingData.value[floor]?.[rn]);
        if (flagged) { if (is50) un50++; else un35++; }
        else if (occupied) { if (is50) use50++; else use35++; }
        else { if (is50) free50x++; else free35x++; }
      }
    }
    return { un50, use50, free50x, un35, use35, free35x };
  })();
  // 重新按互斥口径计算“已使用/剩余/不可用”（房间维度）
  const usedRooms = areaStats.use50 + areaStats.use35;
  const freeRooms = areaStats.free50x + areaStats.free35x;
  const unavailableRooms = areaStats.un50 + areaStats.un35;

  // 房间分类统计：只显示非零项
  const roomCategoryParts = [];
  if (roomCategoryCounts['2022级工程硕博士'] > 0) roomCategoryParts.push(`2022级工程硕博士${roomCategoryCounts['2022级工程硕博士']}间`);
  if (roomCategoryCounts['2023级工程硕博士'] > 0) roomCategoryParts.push(`2023级工程硕博士${roomCategoryCounts['2023级工程硕博士']}间`);
  if (roomCategoryCounts['2024级工程硕博士'] > 0) roomCategoryParts.push(`2024级工程硕博士${roomCategoryCounts['2024级工程硕博士']}间`);
  if (roomCategoryCounts['中信科'] > 0) roomCategoryParts.push(`中信科${roomCategoryCounts['中信科']}间`);
  if (roomCategoryCounts['实习实践'] > 0) roomCategoryParts.push(`实习实践${roomCategoryCounts['实习实践']}间`);
  if (roomCategoryCounts['未标记'] > 0) roomCategoryParts.push(`未标记${roomCategoryCounts['未标记']}间`);

  const roomCategoryText = roomCategoryParts.length > 0 ? `其中${roomCategoryParts.join('，')}。` : '';

  // 工程硕博士统计：只显示非零项
  const ptTotal = stats.value.perTagTotal || {};
  const ptIn = stats.value.perTagCheckedIn || {};
  const t22 = Number(ptTotal['2022级工程硕博士'] || 0);
  const t23 = Number(ptTotal['2023级工程硕博士'] || 0);
  const t24 = Number(ptTotal['2024级工程硕博士'] || 0);
  const tzx = Number(ptTotal['中信科'] || 0);
  const i22 = Number(ptIn['2022级工程硕博士'] || 0);
  const i23 = Number(ptIn['2023级工程硕博士'] || 0);
  const i24 = Number(ptIn['2024级工程硕博士'] || 0);
  const izx = Number(ptIn['中信科'] || 0);

  const totalEng = t22 + t23 + t24 + tzx;
  const inEng = i22 + i23 + i24 + izx;

  const engParts = [];
  if (t22 > 0) engParts.push(`22级${t22}人`);
  if (t23 > 0) engParts.push(`23级${t23}人`);
  if (t24 > 0) engParts.push(`24级${t24}人`);
  if (tzx > 0) engParts.push(`中信科${tzx}人`);

  const engInParts = [];
  if (i22 > 0) engInParts.push(`22级${i22}人`);
  if (i23 > 0) engInParts.push(`23级${i23}人`);
  if (i24 > 0) engInParts.push(`24级${i24}人`);
  if (izx > 0) engInParts.push(`中信科${izx}人`);

  const engText = totalEng > 0 ? `累计保障工程硕博士${totalEng}人${engParts.length > 0 ? `，其中${engParts.join('，')}` : ''}；当前在住${inEng}人${engInParts.length > 0 ? `，其中${engInParts.join('，')}` : ''}。` : '';

  // 实习实践统计
  const internshipTotal = Number(ptTotal['实习实践'] || 0);
  const internshipIn = Number(ptIn['实习实践'] || 0);
  const internshipText = internshipTotal > 0 ? `累计保障实习实践${internshipTotal}人，当前在住${internshipIn}人。` : '';

  // 面积统计：只显示非零项
  const areaParts = [];
  if (areaStats.un50 > 0 || areaStats.use50 > 0 || areaStats.free50x > 0) {
    areaParts.push(`50平：不可用${areaStats.un50}间；已用${areaStats.use50}间；可用${areaStats.free50x}间（共100间）`);
  }
  if (areaStats.un35 > 0 || areaStats.use35 > 0 || areaStats.free35x > 0) {
    areaParts.push(`35平：不可用${areaStats.un35}间；已用${areaStats.use35}间；可用${areaStats.free35x}间（共138间）`);
  }

  const areaText = areaParts.length > 0 ? `按面积统计：\n  - ${areaParts.join('；\n  - ')}。` : '';

  return [
    `截至${tsDate}，共${totalRooms}间，已使用${usedRooms}间，剩余${freeRooms}间，不可用${unavailableRooms}间。${roomCategoryText}`,
    engText,
    internshipText,
    areaText
  ].filter(Boolean).join('\n');
});
const copyReport = async () => {
  const text = reportText.value || '';
  // 优先使用安全环境的 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fallback */ }
  }
  // 回退方案：创建隐藏 textarea + execCommand('copy')，适配 http/内网
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) { return; }
  } catch { /* ignore */ }
  alert('复制失败，请手动选择文本复制');
};

// --- 房间标记（特殊用途） ---
const roomFlags = ref({}); // { [roomNumber]: { type, note } }
const roomFlagsReady = ref(false);
const fetchRoomFlags = async () => {
  try {
    const res = await api.get('/api/rooms/flags');
    if (res.data?.success && Array.isArray(res.data.data)) {
      const map = {};
      for (const it of res.data.data) map[String(it.roomNumber)] = it;
      roomFlags.value = map;
    }
  } catch {}
  finally { roomFlagsReady.value = true; }
};

// --- 右键菜单状态 ---
const isContextMenuOpen = ref(false);
const contextMenuPosition = ref({ top: '0px', left: '0px' });
const contextMenuRoomInfo = ref(null);
const contextMenuRoomNumber = ref(null);

// --- 常量定义 ---
const totalFloors = 20;
const roomsPerFloorLayout = 12;
const totalRooms = 238; 

// --- 颜色与标签选项（颜色在下方动态计算） ---

const fetchSyncStatus = async () => {
  try {
    const res = await api.get('/api/sync/status');
    if (res.data?.success) {
      syncStatus.value = res.data.data;
    }
  } catch (e) {
    // 静默失败
  }
};
const vacantColor = 'bg-gray-200 hover:bg-gray-300';
// 右键菜单标签选项：默认 + 动态（来自统计）
const defaultTagOptions = ['2022级工程硕博士','2023级工程硕博士','2024级工程硕博士','实习实践'];
const tagOptions = computed(() => {
  const set = new Set(defaultTagOptions);
  const perTag = (stats.value && stats.value.perTagTotal) ? stats.value.perTagTotal : {};
  Object.keys(perTag || {}).forEach(k => { if (k && String(k).trim()) set.add(String(k).trim()); });
  return Array.from(set.values());
});

// --- 生命周期与数据获取 ---
onMounted(() => {
  fetchData();
  fetchSyncStatus();
  fetchStats();
  fetchRoomFlags();
  syncTimer = setInterval(fetchSyncStatus, 5000);

  // 监听同页事件
  const onStudentsUpdated = () => { fetchData(); fetchStats(); fetchRoomFlags(); };
  window.addEventListener('students-updated', onStudentsUpdated);
  // 监听跨标签页同步（localStorage）
  const onStorage = (e) => { if (e.key === 'tenant-app:update') { fetchData(); fetchStats(); fetchRoomFlags(); } };
  window.addEventListener('storage', onStorage);
  // 监听 BroadcastChannel
  let bc = null;
  try {
    bc = new BroadcastChannel('tenant-app');
    bc.onmessage = (ev) => { if (ev?.data?.type === 'students-updated') { fetchData(); fetchStats(); fetchRoomFlags(); } };
  } catch {}

  // 卸载清理
  onUnmounted(() => {
    window.removeEventListener('students-updated', onStudentsUpdated);
    window.removeEventListener('storage', onStorage);
    try { bc && bc.close && bc.close(); } catch {}
  });

  // 页面打开：在不处于冷却或同步中的情况下，静默触发一次同步
  (async () => {
    try {
      // 确保拿到最新状态
      try { await fetchSyncStatus(); } catch {}
      const cooling = Number(syncStatus.value.cooldownRemainingMs || 0) > 0;
      if (!syncStatus.value.isSyncing && !cooling) {
        await api.post('/api/sync').catch(() => {});
        // 触发后拉一次状态
        try { await fetchSyncStatus(); } catch {}
      }
    } catch {}
  })();
});

const formattedLastSync = computed(() => {
  return syncStatus.value.lastSyncAt
    ? new Date(syncStatus.value.lastSyncAt).toLocaleString()
    : '—';
});

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer);
});

const fetchData = async () => {
  isLoading.value = true;
  try {
    const response = await api.get('/api/tenants');
    if (response.data.success) {
      buildingData.value = response.data.data;
    } else {
      throw new Error('获取数据失败');
    }
  } catch (err) {
    // 生产提示：去掉 Vite 代理字样
    const code = err?.response?.status;
    const msg = code ? `（HTTP ${code}）` : '';
    errorMsg.value = `无法加载租客数据，请稍后重试或联系管理员${msg}`;
  } finally {
    isLoading.value = false;
  }
};

const fetchStats = async () => {
  try {
    const res = await api.get('/api/stats');
    if (res.data?.success) stats.value = res.data.data || stats.value;
  } catch {}
};

// --- 数据统计逻辑 ---
const normalizeTag = (t) => {
  if (t === '22级工程硕博士') return '2022级工程硕博士';
  if (t === '23级工程硕博士') return '2023级工程硕博士';
  if (t === '24级工程硕博士') return '2024级工程硕博士';
  return t || '';
};

const statistics = computed(() => {
  if (Object.keys(buildingData.value).length === 0) {
    return { occupiedRooms: 0, totalTenants: 0, tagCounts: {} };
  }
  let occupiedRooms = 0;
  let totalTenants = 0;
  const tagCounts = {
    '2022级工程硕博士': 0,
    '2023级工程硕博士': 0,
    '2024级工程硕博士': 0,
    '实习实践': 0,
    '未入住': 0,
  };

  for (const floor in buildingData.value) {
    for (const roomNum in buildingData.value[floor]) {
      occupiedRooms++;
      const tenantsInRoom = buildingData.value[floor][roomNum];
      totalTenants += tenantsInRoom.length;
      if (tenantsInRoom && tenantsInRoom.length > 0) {
        const representativeTenant = tenantsInRoom.find(t => t.isMain) || tenantsInRoom[0];
        const roomTag = normalizeTag(representativeTenant.tag);
        if (roomTag && tagCounts.hasOwnProperty(roomTag)) {
          tagCounts[roomTag]++;
        } else {
          tagCounts['未入住']++;
        }
      }
    }
  }
  return { occupiedRooms, totalTenants, tagCounts };
});

const roomIs50 = (rn) => {
  const num = Number(rn);
  const floor = Math.floor(num / 100);
  const suf = num % 100;
  if (floor === 1) return [1,2,3,9,10].includes(suf);
  return [1,2,3,11,12].includes(suf);
};

// 计算因“房间标记”为不可用的空置数量（总/分面积）
const flaggedVacantCounts = computed(() => {
  let total = 0, n50 = 0, n35 = 0;
  const occupiedSet = new Set();
  for (const f in buildingData.value) {
    for (const r in buildingData.value[f]) occupiedSet.add(String(r));
  }
  for (const key in roomFlags.value) {
    if (!occupiedSet.has(String(key))) {
      total++;
      if (roomIs50(Number(key))) n50++; else n35++;
    }
  }
  return { total, n50, n35 };
});

// 顶部摘要：总房源 / 已入住 / 不可用 / 空余（互斥统计）
const roomSummary = computed(() => {
  let unavailable = 0, occupied = 0, vacant = 0;
  for (let floor = 1; floor <= totalFloors; floor++) {
    for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
      const rn = getRoomNumberFromLayoutIndex(floor, idx);
      if (rn === null) continue;
      const flagged = !!roomFlags.value[String(rn)];
      const hasTenant = !!(buildingData.value[floor]?.[rn]);
      if (flagged) unavailable++;
      else if (hasTenant) occupied++;
      else vacant++;
    }
  }
  return { total: totalRooms, occupied, unavailable, vacant };
});

const roomRates = computed(() => {
  const t = roomSummary.value.total || 1;
  const pct = (n) => Math.round((n / t) * 100);
  return {
    occupied: pct(roomSummary.value.occupied),
    unavailable: pct(roomSummary.value.unavailable),
    vacant: pct(roomSummary.value.vacant),
  };
});

// 已入住 -> 标签分布气泡（支持动态标签）
const isTagPopoverOpen = ref(false);
const hoveredTag = ref(null);
const defaultTagOrder = ['2022级工程硕博士','2023级工程硕博士','2024级工程硕博士','实习实践'];

// 颜色：已知标签固定颜色，未知标签按名称哈希分配稳定颜色
const tagColors = {
  '2022级工程硕博士': 'bg-blue-600 hover:bg-blue-500',
  '2023级工程硕博士': 'bg-green-600 hover:bg-green-500',
  '2024级工程硕博士': 'bg-amber-500 hover:bg-amber-400',
  '实习实践': 'bg-violet-600 hover:bg-violet-500',
  '': 'bg-slate-500 hover:bg-slate-400',
};
const palette = [
  'bg-sky-600 hover:bg-sky-500',
  'bg-indigo-600 hover:bg-indigo-500',
  'bg-rose-600 hover:bg-rose-500',
  'bg-cyan-600 hover:bg-cyan-500',
  'bg-teal-600 hover:bg-teal-500',
  'bg-orange-600 hover:bg-orange-500',
  'bg-lime-600 hover:bg-lime-500',
  'bg-fuchsia-600 hover:bg-fuchsia-500',
  'bg-purple-600 hover:bg-purple-500',
  'bg-pink-600 hover:bg-pink-500',
];
const paletteSolid = [
  'bg-sky-500', 'bg-indigo-500', 'bg-rose-500', 'bg-cyan-500', 'bg-teal-500',
  'bg-orange-500', 'bg-lime-500', 'bg-fuchsia-500', 'bg-purple-500', 'bg-pink-500'
];
const hashCode = (s) => {
  let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
};
const colorClassForTag = (t) => {
  const k = String(t || '');
  if (tagColors[k]) return tagColors[k];
  if (!k) return tagColors[''];
  const idx = hashCode(k) % palette.length;
  return palette[idx];
};
const solidBarColorForTag = (t) => {
  const k = String(t || '');
  if (!k) return 'bg-slate-300';
  if (['2022级工程硕博士','2023级工程硕博士','2024级工程硕博士','实习实践'].includes(k)) {
    return tagColors[k].replace(' hover:bg-', ' ').split(' ')[0];
  }
  const idx = hashCode(k) % paletteSolid.length;
  return paletteSolid[idx];
};
const shortTag = (t) => {
  if (!t) return '—';
  if (t === '2022级工程硕博士') return '22';
  if (t === '2023级工程硕博士') return '23';
  if (t === '2024级工程硕博士') return '24';
  if (t === '实习实践') return '实';
  return String(t).slice(0, 2);
};

// 动态统计（非空即视为已标记）
const tagBreakdown = computed(() => {
  const map = new Map(); // tag -> count
  let labeledRooms = 0;
  for (let floor = 1; floor <= totalFloors; floor++) {
    for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
      const rn = getRoomNumberFromLayoutIndex(floor, idx);
      if (rn === null) continue;
      const flagged = !!roomFlags.value[String(rn)];
      if (flagged) continue; // 不可用不计入“已入住”标签分布
      const roomInfo = buildingData.value[floor]?.[rn];
      if (roomInfo && roomInfo.length > 0) {
        const main = roomInfo.find(t => t.isMain) || roomInfo[0];
        const eff = normalizeTag((main.tag || '').trim() || (roomFlags.value[String(rn)]?.roomTag || ''));
        if (eff) {
          labeledRooms++;
          map.set(eff, (map.get(eff) || 0) + 1);
        }
      }
    }
  }
  // 构造对象形式，便于模板读取
  const obj = {};
  for (const [k, v] of map.entries()) obj[k] = v;
  // 附带已标记房间数，便于百分比计算（不包含不可用和未入住）
  obj.__labeledRooms = labeledRooms;
  return obj;
});

// 用于渲染顺序：默认标签优先，其次其它标签按字典序，最后是“未标记”
const tagList = computed(() => {
  const dynamic = Object.keys(tagBreakdown.value).filter(k => k !== '__labeledRooms');
  const known = defaultTagOrder.filter(k => dynamic.includes(k));
  const others = dynamic.filter(k => !defaultTagOrder.includes(k)).sort();
  return [...known, ...others, '未标记'];
});

// 已入住房间的人数概览（排除不可用房）
const occupiedStats = computed(() => {
  let rooms = 0, totalPeople = 0;
  const dist = { '1人': 0, '2人': 0, '3人及以上': 0 };
  for (let floor = 1; floor <= totalFloors; floor++) {
    for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
      const rn = getRoomNumberFromLayoutIndex(floor, idx);
      if (rn === null) continue;
      if (roomFlags.value[String(rn)]) continue; // 跳过不可用
      const arr = buildingData.value[floor]?.[rn];
      if (Array.isArray(arr) && arr.length > 0) {
        rooms++;
        totalPeople += arr.length;
        if (arr.length === 1) dist['1人']++;
        else if (arr.length === 2) dist['2人']++;
        else dist['3人及以上']++;
      }
    }
  }
  const avg = rooms ? (totalPeople / rooms) : 0;
  return { rooms, totalPeople, avg: Math.round(avg * 10) / 10, dist };
});

// 未标记详情：列出未标记的房间编号与住户姓名（排除不可用；仅当主租客与房间标签都为空）
const unlabeledRooms = computed(() => {
  const list = [];
  for (let floor = 1; floor <= totalFloors; floor++) {
    for (let idx = 1; idx <= roomsPerFloorLayout; idx++) {
      const rn = getRoomNumberFromLayoutIndex(floor, idx);
      if (rn === null) continue;
      if (roomFlags.value[String(rn)]) continue; // 跳过不可用
      const arr = buildingData.value[floor]?.[rn];
      if (!Array.isArray(arr) || arr.length === 0) continue; // 空房不算
      const main = arr.find(t => t.isMain) || arr[0];
      const eff = normalizeTag((main.tag || '').trim() || (roomFlags.value[String(rn)]?.roomTag || ''));
      if (!eff) {
        list.push({ roomNumber: rn, names: arr.map(x => x.tenantName).filter(Boolean) });
      }
    }
  }
  return list.sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber));
});

// 跳转定位到网格中的房间单元格
const scrollToRoom = (rn) => {
  try {
    const el = document.getElementById('room-' + rn);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      el.classList.add('ring-4', 'ring-yellow-300');
      setTimeout(() => el.classList.remove('ring-4', 'ring-yellow-300'), 1200);
    }
  } catch {}
};

// --- 事件处理与辅助函数 ---
const handleRefresh = async () => {
  if (syncStatus.value.isSyncing) {
    alert('同步任务正在进行中，请稍后再试。');
    return;
  }
  isRefreshing.value = true;
  try {
    await api.post('/api/sync');
    // 立即拉一次状态，给用户更及时反馈
    try { await fetchSyncStatus(); } catch {}
    alert('已成功触发后台同步任务！数据将在大约1-2分钟后更新。请稍后手动刷新页面查看最新数据。');
  } catch (err) {
    const message = err.response?.data?.message || '触发同步失败，请稍后再试。';
    alert(message);
  } finally {
    isRefreshing.value = false;
  }
};

// (查看详情) 打开模态框
const openModal = (roomInfo, roomNumber) => {
  if (!roomInfo) return;
  // 已标记为“不可用/重要”的房间：隐藏入住人员信息
  if (!roomFlagsReady.value || isVipRoom(roomNumber)) {
    selectedRoom.value = [];
  } else {
    const sortedRoomInfo = [...roomInfo].sort((a, b) => Number(b.isMain) - Number(a.isMain));
    selectedRoom.value = JSON.parse(JSON.stringify(sortedRoomInfo));
  }
  selectedRoomNumber.value = roomNumber;
  isModalOpen.value = true;
};

const closeModal = () => {
  isModalOpen.value = false;
  selectedRoom.value = null;
  selectedRoomNumber.value = null;
};

// --- 右键菜单相关方法 ---
const openContextMenu = (event, roomInfo, roomNumber) => {
  event.preventDefault();
  isContextMenuOpen.value = true;
  // 视口防溢出处理
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const menuW = 192; // 约等于 w-48
  const menuH = 280; // 预估高度
  let top = event.clientY;
  let left = event.clientX;
  if (vh - top < menuH) top = Math.max(0, vh - menuH - 8);
  if (vw - left < menuW) left = Math.max(0, vw - menuW - 8);
  contextMenuPosition.value = { top: `${top}px`, left: `${left}px` };
  // 不可用/重要房间不展示人员标签快捷项
  contextMenuRoomInfo.value = isVipRoom(roomNumber) ? [] : roomInfo;
  contextMenuRoomNumber.value = roomNumber;
  window.addEventListener('click', closeContextMenu, { once: true });
};

const closeContextMenu = () => {
  isContextMenuOpen.value = false;
  contextMenuRoomInfo.value = null;
  contextMenuRoomNumber.value = null;
};

// (右键菜单) 快速保存标签
const quickSaveTag = async (newTag) => {
  if (!contextMenuRoomInfo.value) return;

  const mainTenant = contextMenuRoomInfo.value.find(t => t.isMain) || contextMenuRoomInfo.value[0];
  
  if (mainTenant.tag === newTag) return;

  try {
    await api.patch(`/api/students/by-tenant/${mainTenant._id}/tag`, { tag: newTag });
    await fetchData(); 
  } catch (err) {
    alert('标签快速保存失败');
  } finally {
    closeContextMenu(); 
  }
};

// 自定义标签（主租客）
const quickSaveCustomTag = async () => {
  if (!contextMenuRoomInfo.value) return;
  const input = prompt('输入自定义标签（不超过50字符）：');
  if (input === null) return;
  const value = String(input).trim().slice(0, 50);
  if (!value) return;
  await quickSaveTag(value);
};

// 房间标记：设置为不可用/清除
const setRoomFlag = async (type) => {
  const rn = contextMenuRoomNumber.value;
  if (!rn) return;
  try {
    await api.put(`/api/rooms/flags/${rn}`, { type });
    await fetchRoomFlags();
    await fetchData();
  } catch { alert('房间标记失败'); }
  finally { closeContextMenu(); }
};
const clearRoomFlag = async () => {
  const rn = contextMenuRoomNumber.value; if (!rn) return;
  try { await api.delete(`/api/rooms/flags/${rn}`); await fetchRoomFlags(); await fetchData(); }
  catch { alert('清除标记失败'); }
  finally { closeContextMenu(); }
};

// 房间标签：用于统计与颜色兜底
const setRoomTag = async (roomTag) => {
  const rn = contextMenuRoomNumber.value; if (!rn) return;
  try {
    await api.put(`/api/rooms/tags/${rn}`, { roomTag });
    await fetchRoomFlags();
    await fetchData();
  } catch { alert('设置房间标签失败'); }
  finally { closeContextMenu(); }
};
// 自定义房间标签
const setRoomTagCustom = async () => {
  const rn = contextMenuRoomNumber.value; if (!rn) return;
  const input = prompt('输入房间标签（不超过50字符）：');
  if (input === null) return;
  const value = String(input).trim().slice(0, 50);
  try {
    await api.put(`/api/rooms/tags/${rn}`, { roomTag: value });
    await fetchRoomFlags();
    await fetchData();
  } catch { alert('设置房间标签失败'); }
  finally { closeContextMenu(); }
};
const clearRoomTag = async () => {
  const rn = contextMenuRoomNumber.value; if (!rn) return;
  try { await api.delete(`/api/rooms/tags/${rn}`); await fetchRoomFlags(); await fetchData(); }
  catch { alert('清除房间标签失败'); }
  finally { closeContextMenu(); }
};

// 已移除“退租清空房间”功能（后端未实现 removeGuest 接口）

// --- 楼栋布局与数据获取辅助函数 ---
const getRoomNumberFromLayoutIndex = (floor, layoutIndex) => {
  if (floor === 1) {
    if (layoutIndex <= 6) return 100 + layoutIndex;
    if (layoutIndex >= 9 && layoutIndex <= 12) return 100 + (layoutIndex - 2);
    return null;
  }
  return floor * 100 + layoutIndex;
};

// 将任何被标记的不可用房（vip/其它非 none）视为“敏感房间”，隐藏人员信息
const isVipRoom = (roomNumber) => {
  const f = roomFlags.value[String(roomNumber)] || null;
  if (!f) return false;
  const t = String(f.type || '').toLowerCase();
  return t && t !== 'none';
};

const getRoomInfo = (floor, roomNumber) => {
  if (roomNumber === null) return null;
  return buildingData.value[floor]?.[roomNumber];
};

// 根据筛选判断房间是否显示
const matchesFilter = (floor, roomNumber) => {
  const flagged = !!roomFlags.value[String(roomNumber)];
  const hasTenant = !!(buildingData.value[floor]?.[roomNumber]);

  // 如果全部选中，显示所有房间
  if (occupancyFilters.value.all) return true;

  // 如果选中已入住，显示有租客的房间
  if (occupancyFilters.value.checkedIn && hasTenant) return true;

  // 如果选中空余，显示无租客且未标记的房间
  if (occupancyFilters.value.vacant && !hasTenant && !flagged) return true;

  return false;
};

const getRoomClass = (roomInfo, roomNumber) => {
  const flagged = roomNumber && roomFlags.value[String(roomNumber)];
  // 标记为不可用：统一颜色
  if (flagged) {
    return 'bg-red-600 hover:bg-red-500';
  }
  if (roomInfo) {
    const mainTenant = roomInfo.find(t => t.isMain) || roomInfo[0];
    const roomTag = roomFlags.value[String(roomNumber)]?.roomTag || '';
    const effectiveTag = normalizeTag((mainTenant.tag || '').trim() || roomTag);
    return colorClassForTag(effectiveTag);
  }
  return vacantColor;
};
</script>

<template>
  <div class="p-4 md:p-8 bg-gray-50 min-h-screen pb-16">
    <div class="flex flex-wrap justify-between items-center mb-6 max-w-screen-2xl mx-auto">
      <h1 class="text-3xl font-bold text-gray-800 mb-4 md:mb-0">工程硕博士在住情况</h1>
      <div class="flex items-center gap-4 order-3 md:order-2 w-full md:w-auto mt-3 md:mt-0">
        <label class="text-sm text-gray-600">是否入住</label>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-1 text-sm cursor-pointer">
            <input type="checkbox" v-model="occupancyFilters.all" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
            <span>全部</span>
          </label>
          <label class="flex items-center gap-1 text-sm cursor-pointer">
            <input type="checkbox" v-model="occupancyFilters.checkedIn" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
            <span>已入住</span>
          </label>
          <label class="flex items-center gap-1 text-sm cursor-pointer">
            <input type="checkbox" v-model="occupancyFilters.vacant" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
            <span>空余</span>
          </label>
        </div>
      </div>
      <button 
        @click="handleRefresh" 
        :disabled="isRefreshing || syncStatus.isSyncing"
        class="bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
      >
        <svg v-if="isRefreshing" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ (isRefreshing || syncStatus.isSyncing) ? '同步中...' : '主动刷新数据' }}
      </button>
      <div class="text-sm text-gray-500 ml-4">上次同步：{{ formattedLastSync }}</div>
    </div>

    <div v-if="!isLoading" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-4 mb-8 max-w-screen-2xl mx-auto">
      <!-- 总房源 -->
      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-1 md:col-span-3">
        <h4 class="text-gray-500 font-medium flex items-center gap-2">
          <svg class="h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10l9-7 9 7v9a2 2 0 01-2 2h-4v-6H9v6H5a2 2 0 01-2-2v-9z"/></svg>
          总房源
        </h4>
        <div class="flex items-baseline mt-1">
          <p class="text-3xl font-extrabold text-gray-900">{{ roomSummary.total }}</p>
          <p class="text-sm font-medium text-gray-500 ml-2">间</p>
        </div>
        <p class="text-xs text-gray-500">全部可管理的房间数</p>
      </div>
      <!-- 已入住 -->
      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-1 md:col-span-3 relative"
           @mouseenter="isTagPopoverOpen = true"
           @mouseleave="isTagPopoverOpen = false">
        <h4 class="text-gray-500 font-medium flex items-center gap-2">
          <svg class="h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M8 10h8v8H8z M4 6h16v2H4z"/></svg>
          已入住
        </h4>
        <div class="flex items-baseline mt-1">
          <p class="text-3xl font-extrabold text-gray-900">{{ roomSummary.occupied }}</p>
          <p class="text-sm font-medium text-gray-500 ml-2">间 · {{ roomRates.occupied }}%</p>
        </div>
        <p class="text-xs text-gray-500">当前被占用的房间</p>

        <!-- 标签分布气泡面板（悬停显示） -->
        <div v-if="isTagPopoverOpen" class="absolute z-20 left-0 top-full mt-2 w-72 bg-white border border-gray-200 rounded shadow-lg p-3">
          <!-- 顶部摘要：平均每房人数 -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 text-xs text-gray-500">
              <svg class="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V20h14v-3.5C15 14.17 10.33 13 8 13zM16 13c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V20h6v-3.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
              <span>平均每房人数</span>
            </div>
            <div class="text-sm font-semibold text-gray-800">{{ occupiedStats.avg }}</div>
          </div>

          <!-- 标签分布列表：带百分比与小进度条 -->
          <div class="text-xs text-gray-500 mb-1">各标签房间数（已入住）</div>
          <ul class="space-y-2 text-sm">
            <li v-for="tag in tagList" :key="tag" @mouseenter="hoveredTag = tag" @mouseleave="hoveredTag = null">
              <div class="flex justify-between items-center">
                <span class="flex items-center gap-2">
                  <span class="inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white"
                        :class="tag === '未标记' ? 'bg-slate-400' : colorClassForTag(tag).replace(' hover:bg-', ' ') ">
                        {{ shortTag(tag === '未标记' ? '' : tag) }}
                  </span>
                  <span class="text-gray-700">{{ tag }}</span>
                </span>
                <span class="font-semibold text-gray-900">
                  {{ tag === '未标记' ? (roomSummary.occupied - (tagBreakdown.__labeledRooms || 0)) : (tagBreakdown[tag] || 0) }}
                  <span class="text-xs text-gray-500 ml-1">({{ Math.round(((tag === '未标记' ? (roomSummary.occupied - (tagBreakdown.__labeledRooms || 0)) : (tagBreakdown[tag] || 0)) / Math.max(1, roomSummary.occupied)) * 100) }}%)</span>
                </span>
              </div>
              <div class="h-1.5 bg-gray-100 rounded mt-1 overflow-hidden">
                <div class="h-full rounded"
                     :class="tag === '未标记' ? 'bg-slate-300' : solidBarColorForTag(tag)"
                     :style="{ width: Math.round(((tag === '未标记' ? (roomSummary.occupied - (tagBreakdown.__labeledRooms || 0)) : (tagBreakdown[tag] || 0)) / Math.max(1, roomSummary.occupied)) * 100) + '%' }"></div>
              </div>
              <!-- 悬浮展开：未标记详情（房间号 / 姓名） -->
              <div v-if="tag === '未标记' && hoveredTag === '未标记'" class="mt-2 bg-gray-50 border border-gray-200 rounded p-2 max-h-44 overflow-auto">
                <div v-if="unlabeledRooms.length === 0" class="text-xs text-gray-500">已全部标记</div>
                <ul v-else class="space-y-1">
                  <li v-for="it in unlabeledRooms" :key="it.roomNumber" class="flex items-center justify-between text-xs">
                    <span class="flex items-center gap-2 truncate">
                      <svg class="h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L3 7v13h6v-6h6v6h6V7l-9-5z"/></svg>
                      <span class="font-medium text-gray-800">{{ it.roomNumber }}</span>
                      <span class="text-gray-600 truncate">· {{ it.names && it.names.length ? (it.names[0] + (it.names.length > 1 ? (' +' + (it.names.length - 1)) : '')) : '—' }}</span>
                    </span>
                    <button @click="scrollToRoom(it.roomNumber)" class="shrink-0 ml-2 px-2 py-0.5 text-[11px] bg-amber-500 hover:bg-amber-400 text-white rounded">定位</button>
                  </li>
                </ul>
                <div class="text-[11px] text-gray-500 mt-1">共 {{ unlabeledRooms.length }} 间未标记房间</div>
              </div>
            </li>
          </ul>

          <!-- 入住结构 -->
          <div class="mt-3 border-t pt-2">
            <div class="text-xs text-gray-500 mb-1">入住结构</div>
            <div class="grid grid-cols-3 gap-2 text-sm">
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-1 text-gray-700">
                  <svg class="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4S14.21 4 12 4s-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  1人
                </span>
                <span class="font-semibold text-gray-900">{{ occupiedStats.dist['1人'] }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-1 text-gray-700">
                  <svg class="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3z"/><path d="M8 13c-2.33 0-7 1.17-7 3.5V20h14v-3.5C15 14.17 10.33 13 8 13z"/></svg>
                  2人
                </span>
                <span class="font-semibold text-gray-900">{{ occupiedStats.dist['2人'] }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="flex items-center gap-1 text-gray-700">
                  <svg class="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zM8 11c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3z"/><path d="M8 13c-2.33 0-7 1.17-7 3.5V20h14v-3.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V20h6v-3.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                  3人+
                </span>
                <span class="font-semibold text-gray-900">{{ occupiedStats.dist['3人及以上'] }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 不可用 -->
      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-1 md:col-span-3">
        <h4 class="text-gray-500 font-medium flex items-center gap-2">
          <svg class="h-4 w-4 text-red-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 4.8L19.2 19H4.8L12 6.8zM11 10h2v5h-2zm0 6h2v2h-2z"/></svg>
          不可用
        </h4>
        <div class="flex items-baseline mt-1">
          <p class="text-3xl font-extrabold text-gray-900">{{ roomSummary.unavailable }}</p>
          <p class="text-sm font-medium text-gray-500 ml-2">间 · {{ roomRates.unavailable }}%</p>
        </div>
        <p class="text-xs text-gray-500">被标记为不可用</p>
      </div>
      <!-- 空余 -->
      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-1 md:col-span-3">
        <h4 class="text-gray-500 font-medium flex items-center gap-2">
          <svg class="h-4 w-4 text-emerald-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 19h18v2H3zM5 11h14v6H5zM7 7h10v2H7z"/></svg>
          空余
        </h4>
        <div class="flex items-baseline mt-1">
          <p class="text-3xl font-extrabold text-gray-900">{{ roomSummary.vacant }}</p>
          <p class="text-sm font-medium text-gray-500 ml-2">间 · {{ roomRates.vacant }}%</p>
        </div>
        <p class="text-xs text-gray-500">可用但未入住</p>
      </div>

      <!-- 占用概览（堆叠条形） -->
      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-2 md:col-span-12">
        <h4 class="text-gray-500 font-medium mb-2 flex items-center gap-2">
          <svg class="h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h12v2H3v-2z"/></svg>
          占用概览
        </h4>
        <div class="h-3 w-full bg-gray-100 rounded overflow-hidden flex">
          <div class="bg-indigo-500" :style="{ width: roomRates.occupied + '%' }" :title="`已入住 ${roomRates.occupied}%`"></div>
          <div class="bg-red-500" :style="{ width: roomRates.unavailable + '%' }" :title="`不可用 ${roomRates.unavailable}%`"></div>
          <div class="bg-emerald-500" :style="{ width: roomRates.vacant + '%' }" :title="`空余 ${roomRates.vacant}%`"></div>
        </div>
        <div class="flex justify-between text-xs mt-2 text-gray-600">
          <div>已入住：{{ roomSummary.occupied }}（{{ roomRates.occupied }}%）</div>
          <div>不可用：{{ roomSummary.unavailable }}（{{ roomRates.unavailable }}%）</div>
          <div>空余：{{ roomSummary.vacant }}（{{ roomRates.vacant }}%）</div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-lg shadow col-span-1 sm:col-span-2 md:col-span-12">
        <h4 class="text-gray-500 font-medium mb-2 flex items-center gap-2">
          <svg class="h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h12v2H3v-2z"/></svg>
          数据汇报（可复制）
        </h4>
        <div class="flex flex-col gap-2">
          <pre class="text-sm text-gray-800 whitespace-pre-wrap break-words">{{ reportText }}</pre>
          <div class="text-right">
            <button @click="copyReport" class="px-3 py-1 bg-blue-600 text-white rounded">复制</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isLoading" class="text-center text-gray-500 mt-10">正在加载数据...</div>
    <div v-if="errorMsg" class="text-center text-red-500 mt-10">{{ errorMsg }}</div>

    <div v-if="!isLoading && !errorMsg" class="building-grid-container mx-auto">
      <div class="grid gap-1 md:gap-2" :style="{ gridTemplateColumns: `repeat(${roomsPerFloorLayout + 1}, minmax(0, 1fr))` }">
        <template v-for="floor in totalFloors" :key="floor">
          <div class="flex items-center justify-center font-bold text-lg p-2 text-gray-600" :title="`上次同步：${formattedLastSync}`">{{ floor }}F</div>
          <template v-for="layoutIndex in roomsPerFloorLayout" :key="`${floor}-${layoutIndex}`">
            <template v-if="getRoomNumberFromLayoutIndex(floor, layoutIndex) !== null && matchesFilter(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex))">
              <div
                :id="'room-' + getRoomNumberFromLayoutIndex(floor, layoutIndex)"
                @click="openModal(getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)), getRoomNumberFromLayoutIndex(floor, layoutIndex))"
                @contextmenu="openContextMenu($event, getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)), getRoomNumberFromLayoutIndex(floor, layoutIndex))"
                class="room-cell relative w-full h-20 md:h-24 rounded-md flex items-center justify-center text-center p-1 cursor-pointer transition-all duration-200"
                :class="getRoomClass(getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)), getRoomNumberFromLayoutIndex(floor, layoutIndex))"
              >
                <div v-if="roomFlagsReady && getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)) && !isVipRoom(getRoomNumberFromLayoutIndex(floor, layoutIndex))" class="text-white text-xs font-semibold break-words">
                  {{ getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)).find(t => t.isMain)?.tenantName || getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex))[0]?.tenantName }}
                  <span v-if="getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)).length > 1" class="font-bold text-yellow-300"> +{{ getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)).length - 1 }}</span>
                </div>
                <div class="absolute top-2 right-2 text-xs" :class="isVipRoom(getRoomNumberFromLayoutIndex(floor, layoutIndex)) ? 'text-white text-opacity-70' : (getRoomInfo(floor, getRoomNumberFromLayoutIndex(floor, layoutIndex)) ? 'text-white text-opacity-70' : 'text-gray-500')">
                  {{ getRoomNumberFromLayoutIndex(floor, layoutIndex) }}
                </div>
              </div>
            </template>
            <template v-else>
              <div class="h-20 md:h-24"></div>
            </template>
          </template>
        </template>
        </div>
    </div>

    <div v-if="isModalOpen" @click.self="closeModal" class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
        <h3 class="text-2xl font-bold mb-4 text-gray-800">房间 {{ selectedRoomNumber }} 详情</h3>
        <div v-if="Array.isArray(selectedRoom) && selectedRoom.length === 0" class="mb-4 p-4 border rounded-md bg-yellow-50 text-yellow-800 text-sm">
          该房间有其他用途
        </div>
        <div v-else v-for="tenant in selectedRoom" :key="tenant._id" class="mb-4 p-4 border rounded-md bg-gray-50">
          <div class="flex justify-between items-center mb-3">
            <p class="font-semibold text-lg text-gray-800">{{ tenant.tenantName }}</p>
            <span v-if="tenant.isMain" class="text-xs font-bold text-white bg-orange-500 px-2 py-0.5 rounded-full">主租客</span>
          </div>
          <div class="space-y-2 text-sm text-gray-700 border-t pt-3">
            <p><strong>手机号:</strong> {{ tenant.mobile || '未提供' }}</p>
            <p><strong>身份证号:</strong> {{ tenant.idCard || '未提供' }}</p>
            <p><strong>是否主租客:</strong> <span :class="tenant.isMain ? 'text-green-600 font-bold' : 'text-gray-500'">{{ tenant.isMain ? '是' : '否' }}</span></p>
            <p><strong>标签:</strong> {{ tenant.tag || '无' }}</p>
          </div>
        </div>
        <button @click="closeModal" class="mt-4 w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300">关闭</button>
      </div>
  </div>

  <!-- Sticky Footer: Show last sync time -->
  <div class="fixed bottom-0 left-0 right-0 bg-white/95 border-t border-gray-200 py-2 text-center text-xs text-gray-600 z-40">
    上次同步：{{ formattedLastSync }}
  </div>

  <div v-if="isContextMenuOpen" 
         :style="contextMenuPosition"
         class="fixed z-[60] bg-white rounded-md shadow-lg border w-48 text-sm py-1 max-h-80 overflow-auto">
      <ul>
        <template v-if="contextMenuRoomInfo && contextMenuRoomInfo.length">
          <li @click="quickSaveTag(tagOpt)"
              v-for="tagOpt in tagOptions" 
              :key="tagOpt"
              class="px-4 py-2 hover:bg-gray-100 cursor-pointer">
            {{ tagOpt }}
          </li>
          <li @click="quickSaveCustomTag" class="px-4 py-2 hover:bg-gray-100 cursor-pointer">自定义标签...</li>
          <li class="border-t my-1"></li>
        </template>
        <li class="px-4 py-2 text-gray-500">房间标记</li>
        <li @click="setRoomFlag('vip')" class="px-4 py-2 hover:bg-gray-100 cursor-pointer">标记为不可用</li>
        <li @click="clearRoomFlag" class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-gray-500">清除房间标记</li>
        <li class="border-t my-1"></li>
        <li class="px-4 py-2 text-gray-500">房间标签</li>
        <li v-for="tagOpt in tagOptions" :key="'room-'+tagOpt" @click="setRoomTag(tagOpt)" class="px-4 py-2 hover:bg-gray-100 cursor-pointer">{{ tagOpt }}</li>
        <li @click="setRoomTagCustom" class="px-4 py-2 hover:bg-gray-100 cursor-pointer">自定义房间标签...</li>
        <li @click="clearRoomTag" class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-gray-500">清除房间标签</li>
        <li class="border-t my-1"></li>
        <template v-if="contextMenuRoomInfo && contextMenuRoomInfo.length">
          <li @click="quickSaveTag('')"
              class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-gray-500">
            清除标签
          </li>
        </template>
        
      </ul>
    </div>

  </div>
</template>

<style scoped>
.building-grid-container {
  max-width: 1600px;
}
.room-cell {
  transform: translateZ(0);
  will-change: transform;
  backface-visibility: hidden;
  transition: transform 120ms ease-out;
  contain: paint;
}
.room-cell:hover {
  transform: none;
  box-shadow: inset 0 0 0 2px rgba(99,102,241,0.7);
}
.building-grid-container { -webkit-overflow-scrolling: touch; }

@media (prefers-reduced-motion: reduce) {
  .room-cell { transition: none; }
}
.bg-amber-500 .text-xs {
    color: #44403c;
}
</style>
