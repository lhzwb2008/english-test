/**
 * PM2 进程配置：Qwen-Omni 口语批改兼容代理
 * 用法: pm2 start deploy/ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'qwen-oral-proxy',
      script: 'server/index.mjs',
      cwd: __dirname + '/..',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
