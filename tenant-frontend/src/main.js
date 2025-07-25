import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'

// 我们只创建 App 实例，不使用任何插件
const app = createApp(App)

// 直接挂载 App
app.mount('#app')