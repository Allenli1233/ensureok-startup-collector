import { defineConfig } from 'vitest/config';

// 本包自测:node 环境、只扫本包 tests/ 与 src/。
// 独立于仓库根 vite.config.ts(那份为 Web 应用配了 jsdom),避免后端包被 jsdom/setup 影响。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
