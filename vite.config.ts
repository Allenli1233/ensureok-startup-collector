import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端静态站:留资/埋点跨域 POST 到 EnsureOK 现有 API(VITE_API_BASE)。
// 本地 dev 时用 proxy 把 /api 转到线上,免 CORS(生产走 CORS,见 README)。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE || 'https://ensureok.ai',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
