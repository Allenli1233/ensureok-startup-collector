import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installTrackerUnloadHook } from './api/tracker';
import './index.css';

// 漏斗埋点:注册 unload 兜底 flush。page_view 由采集器组件自身在挂载时 track。
installTrackerUnloadHook();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
