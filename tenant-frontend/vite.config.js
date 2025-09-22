import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [ vue() ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      }
    },
    // ----- 新增的、最关键的配置 -----
    host: '0.0.0.0', // 监听所有网络接口，确保 ngrok 可以连接
    hmr: {
      clientPort: 443 // 如果您使用 https 的 ngrok 域名，这有助于热更新
    },
    allowedHosts: [
      '.ngrok-free.app' // 使用通配符，允许所有 ngrok 的免费域名
    ],
  }
})