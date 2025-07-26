module.exports = {
  apps: [
    {
      name: 'tenant-dashboard',
      script: './tenant-dashboard/index.js',
      cwd: '/opt/tenant-app/tenant-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      }
    },
    {
      name: 'tenant-frontend',
      script: 'serve',
      cwd: '/opt/tenant-app/tenant-frontend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        PM2_SERVE_PATH: './dist',
        PM2_SERVE_PORT: 5000,
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html'
      }
    }
  ]
};