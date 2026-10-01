import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 容器不存在，index.html 可能被改动');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// —— PWA：注册 Service Worker（只在生产构建生效，dev 模式下不干扰热更新）——
// ★ 注册用相对路径：GH Pages 部署在 /<repo>/ 子路径下，写死 '/sw.js' 会 404。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {
      /* 注册失败不阻断使用：站点仍可在线正常访问，只是没有离线能力 */
    });
  });
}
