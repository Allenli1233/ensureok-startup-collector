import { loadDeps } from './loadDeps';
import { createServer } from './server';

const PORT = Number(process.env.AGENT_PORT ?? 8787);

const deps = await loadDeps();
createServer(deps).listen(PORT, () => {
  console.log(
    `[server] 方案生成 API 已启动 http://localhost:${PORT}  ·  LLM=${deps.chat.id}/${deps.chat.model} · RAG=${deps.embedding.id} · 险种库 ${deps.catalogs.size} · 索引 ${deps.ragStore.size()} 块`,
  );
  console.log('[server] POST /agent/proposals(建任务) · GET /agent/proposals/:id(轮询) · GET /health');
});
