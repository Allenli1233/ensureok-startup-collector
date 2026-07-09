import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 纯前端静态站:留资/埋点跨域 POST 到 EnsureOK 现有 API(VITE_API_BASE)。
// 本地 dev 时用 proxy 把 /api 转到线上,免 CORS(生产走 CORS,见 README)。
export default defineConfig({
  plugins: [react()],
  // vitest:本站自测只扫应用自己的 tests/,不误扫 packages/*(各 workspace 自跑自测)。
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE || 'https://ensureok.ai',
        changeOrigin: true,
        secure: true,
      },
      // 方案生成后端(@ensureok/server,默认 localhost:8787);免 CORS
      '/agent': {
        target: process.env.AGENT_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
