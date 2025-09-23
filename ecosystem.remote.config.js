module.exports = {
  apps: [
    {
      name: 'tenant-dashboard',
      script: './index.js',
      cwd: '/opt/tenant-app/tenant-dashboard',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001,
      },
    },
  ],
};

