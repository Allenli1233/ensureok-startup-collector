import { loadDeps } from './loadDeps';
import { createServer } from './server';

// 兜底:请求处理期间任何未捕获的 JS 异常/拒绝只记录、不让进程退出,避免一次生成出错拖垮整个服务。
// (启动期的致命错误如端口占用由下方 server 'error' 单独处理并退出,不在此吞掉。)
process.on('uncaughtException', (err) => {
  console.error('[server] uncaughtException(已兜底,服务继续):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection(已兜底,服务继续):', reason);
});

const PORT = Number(process.env.AGENT_PORT ?? 8787);

const deps = await loadDeps();
const server = createServer(deps);

// 启动绑定错误(如端口被占)= 致命,清晰报错并退出,不制造僵尸进程
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] 端口 ${PORT} 已被占用 —— 多半是已有一个后端在跑。先停掉旧的,或用环境变量 AGENT_PORT 换个端口。`);
  } else {
    console.error('[server] 服务启动错误:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(
    `[server] 方案生成 API 已启动 http://localhost:${PORT}  ·  LLM=${deps.chat.id}/${deps.chat.model} · RAG=${deps.embedding.id} · 险种库 ${deps.catalogs.size} · 索引 ${deps.ragStore.size()} 块`,
  );
  console.log('[server] POST /agent/proposals(建任务) · GET /agent/proposals/:id(轮询) · GET /health');
});
