import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    server: {
      host: true, // 允许局域网访问，方便手机测试
      port: parseInt(env.VITE_PORT) || 3000,
    },
    build: {
      outDir: 'dist',
    },
  };
});
