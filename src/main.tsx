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
