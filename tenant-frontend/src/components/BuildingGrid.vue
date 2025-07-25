<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

// --- 状态变量 ---
const buildingData = ref({});
const isLoading = ref(true);
const errorMsg = ref('');
const isModalOpen = ref(false);
const selectedRoom = ref(null);
const selectedRoomNumber = ref(null);
const isRefreshing = ref(false);

// --- 常量定义 ---
const totalFloors = 20;
const roomsPerFloor = 12;

const tagColors = {
  '22级工程硕博士': 'bg-blue-600 hover:bg-blue-500',
  '23级工程硕博士': 'bg-green-600 hover:bg-green-500',
  '24级工程硕博士': 'bg-teal-600 hover:bg-teal-500',
  '实习实践': 'bg-indigo-600 hover:bg-indigo-500',
  '': 'bg-gray-600 hover:bg-gray-500',
};
const vacantColor = 'bg-gray-200 hover:bg-gray-300';
const tagOptions = Object.keys(tagColors).filter(tag => tag !== '');

// --- 生命周期与数据获取 ---
onMounted(() => {
  fetchData();
});

const fetchData = async () => {
  isLoading.value = true;
  try {
    const response = await axios.get('/api/tenants');
    if (response.data.success) {
      buildingData.value = response.data.data;
    } else { 
      throw new Error('获取数据失败'); 
    }
  } catch (err) {
    errorMsg.value = '无法加载租客数据，请确保后端服务正在运行。';
  } finally {
    isLoading.value = false;
  }
};

// --- 事件处理 ---
const handleRefresh = async () => {
  isRefreshing.value = true;
  try {
    await axios.post('/api/sync');
    alert('已成功触发后台同步任务！数据将在大约1-2分钟后更新。请稍后手动刷新页面查看最新数据。');
  } catch (err) {
    const message = err.response?.data?.message || '触发同步失败，请稍后再试。';
    alert(message);
  } finally {
    isRefreshing.value = false;
  }
};

const openModal = (roomInfo, roomNumber) => {
  if (!roomInfo) return;
  const sortedRoomInfo = [...roomInfo].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  selectedRoom.value = JSON.parse(JSON.stringify(sortedRoomInfo));
  selectedRoomNumber.value = roomNumber;
  isModalOpen.value = true;
};

const closeModal = () => {
  isModalOpen.value = false;
  selectedRoom.value = null;
  selectedRoomNumber.value = null;
};

const saveTag = async (tenant) => {
  try {
    await axios.patch(`/api/tenants/${tenant._id}`, { tag: tenant.tag });
    await fetchData(); 
    closeModal();
  } catch (err) {
    alert('标签保存失败');
  }
};

// --- 辅助函数 ---
const getRoomNumber = (floor, roomIndex) => floor * 100 + roomIndex;

const getRoomInfo = (floor, roomIndex) => {
  const roomNum = getRoomNumber(floor, roomIndex);
  return buildingData.value[floor]?.[roomNum];
};

const getRoomClass = (roomInfo) => {
  if (roomInfo) {
    const mainTenant = roomInfo.find(t => t.isMain) || roomInfo[0];
    return tagColors[mainTenant.tag] || tagColors[''];
  }
  return vacantColor;
};
</script>

<template>
  <div class="p-4 md:p-8 bg-gray-50 min-h-screen">
    <div class="flex justify-between items-center mb-6 max-w-screen-2xl mx-auto">
      <h1 class="text-3xl font-bold text-gray-800">租客楼栋看板</h1>
      <button 
        @click="handleRefresh" 
        :disabled="isRefreshing"
        class="bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center"
      >
        <svg v-if="isRefreshing" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ isRefreshing ? '同步中...' : '主动刷新数据' }}
      </button>
    </div>

    <div v-if="isLoading" class="text-center text-gray-500 mt-10">正在加载数据...</div>
    <div v-if="errorMsg" class="text-center text-red-500 mt-10">{{ errorMsg }}</div>

    <div v-if="!isLoading && !errorMsg" class="building-grid-container mx-auto">
      <div class="grid gap-1 md:gap-2" :style="{ gridTemplateColumns: `repeat(${roomsPerFloor + 1}, minmax(0, 1fr))` }">
        <template v-for="floor in Array.from({ length: totalFloors }, (_, i) => totalFloors - i)" :key="floor">
          <div class="flex items-center justify-center font-bold text-lg p-2 text-gray-600">{{ floor }}F</div>
          <template v-for="roomIndex in roomsPerFloor" :key="roomIndex">
            <div @click="openModal(getRoomInfo(floor, roomIndex), getRoomNumber(floor, roomIndex))" class="room-cell relative w-full h-20 md:h-24 rounded-md flex items-center justify-center text-center p-1 cursor-pointer transition-all duration-200" :class="getRoomClass(getRoomInfo(floor, roomIndex))">
              <div v-if="getRoomInfo(floor, roomIndex)" class="text-white text-xs font-semibold break-words">
                {{ getRoomInfo(floor, roomIndex).find(t => t.isMain)?.tenantName || getRoomInfo(floor, roomIndex)[0]?.tenantName }}
                <span v-if="getRoomInfo(floor, roomIndex).length > 1" class="font-bold text-yellow-300"> +{{ getRoomInfo(floor, roomIndex).length - 1 }}</span>
              </div>
              <div class="absolute bottom-1 right-2 text-xs" :class="getRoomInfo(floor, roomIndex) ? 'text-white text-opacity-70' : 'text-gray-500'">{{ getRoomNumber(floor, roomIndex) }}</div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- Modal -->
    <div v-if="isModalOpen" @click.self="closeModal" class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
        <h3 class="text-2xl font-bold mb-4 text-gray-800">房间 {{ selectedRoomNumber }} 详情</h3>
        <div v-for="tenant in selectedRoom" :key="tenant._id" class="mb-4 p-4 border rounded-md bg-gray-50">
          <div class="flex justify-between items-center mb-3">
            <p class="font-semibold text-lg text-gray-800">{{ tenant.tenantName }}</p>
            <span v-if="tenant.isMain" class="text-xs font-bold text-white bg-orange-500 px-2 py-0.5 rounded-full">主租客</span>
          </div>
          <div class="space-y-2 text-sm text-gray-700 border-t pt-3">
            <p><strong>手机号:</strong> {{ tenant.mobile || '未提供' }}</p>
            <p><strong>是否主租客:</strong> <span :class="tenant.isMain ? 'text-green-600 font-bold' : 'text-gray-500'">{{ tenant.isMain ? '是' : '否' }}</span></p>
          </div>
          <div class="mt-4 border-t pt-3">
            <label class="block text-sm font-medium text-gray-600 mb-1">修改标签:</label>
            <div class="flex space-x-2">
              <select v-model="tenant.tag" class="flex-grow p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
                <option value="">无</option>
                <option v-for="tagOpt in tagOptions" :key="tagOpt" :value="tagOpt">{{ tagOpt }}</option>
              </select>
              <button @click="saveTag(tenant)" class="bg-indigo-600 text-white font-bold py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors">保存</button>
            </div>
          </div>
        </div>
        <button @click="closeModal" class="mt-4 w-full bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.building-grid-container {
  max-width: 1600px;
}
.room-cell {
  transform: scale(1);
}
.room-cell:hover {
  transform: scale(1.08);
  z-index: 10;
  box-shadow: 0 0 15px rgba(129, 140, 248, 0.6); /* 使用更柔和的阴影 */
}
</style>