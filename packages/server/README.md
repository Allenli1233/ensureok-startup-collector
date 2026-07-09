# @ensureok/server

最小 HTTP 后端:把 `@ensureok/agent` 方案生成包成**异步任务 API**,供前端调用。持 OpenAI key(只在后端)。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/agent/proposals` | body=ProposalRequest → `202 { taskId, status }`,后台异步生成 |
| GET | `/agent/proposals/:id` | `{ taskId, status: pending\|running\|ready\|error, proposal?, error? }` |
| GET | `/health` | `{ ok, catalogs, ragChunks }` |

## 用法

```bash
# 前置:catalog:build + rag:ingest 已跑、.env 配好 OPENAI_API_KEY
npm run server:start          # 默认 http://localhost:8787(AGENT_PORT 可改)
npm run server:test           # 集成测试(stub 依赖,起真实 http,无需 key)
npm run server:typecheck
```

前端 dev 通过 vite proxy 把 `/agent` 转到本服务(见根 vite.config,PR4b 接入),免 CORS。

## 边界

- 任务态为**内存**(单实例 demo);生产要换持久化 + TTL 清理 + 鉴权/限流(见设计 v3 §7)。
- 无 CORS(dev 走 vite proxy);独立部署时需按设计开放 CORS。
