<script setup>
import { ref } from 'vue';
import BuildingGrid from './components/BuildingGrid.vue';
import StudentsTable from './components/StudentsTable.vue';

const tab = ref('board');
</script>

<template>
  <div>
    <div class="sticky top-0 z-30 bg-white/70 backdrop-blur border-b border-gray-200 px-4 py-2 flex gap-3">
      <button class="px-3 py-1 rounded" :class="tab==='board' ? 'bg-blue-600 text-white' : 'bg-gray-100'" @click="tab='board'">楼栋看板</button>
      <button class="px-3 py-1 rounded" :class="tab==='students' ? 'bg-blue-600 text-white' : 'bg-gray-100'" @click="tab='students'">学生列表</button>
    </div>
    <div v-if="tab==='board'"><BuildingGrid /></div>
    <div v-else><div class="p-4 md:p-8 bg-gray-50 min-h-screen"><StudentsTable /></div></div>
  </div>
</template>

<style>
body { margin: 0; font-family: sans-serif; }
</style>
