import path from 'path';
import { defineConfig } from 'vite'; // 去掉了 loadEnv，因为不需要加载环境变量了
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/gif-tools/', 
  
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
