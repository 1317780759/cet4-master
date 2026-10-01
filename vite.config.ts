import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GH Pages 项目站点部署在 /<repo>/ 子路径下，因此 base 必须可注入。
 * 本地开发 / 自定义域名部署时默认为 '/'。
 * CI 中通过环境变量 VITE_BASE=/<repo>/ 注入（见 .github/workflows/deploy.yml）。
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  preview: {
    port: 4173,
  },
});
