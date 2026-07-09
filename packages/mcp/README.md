# @ensureok/mcp

把 `@ensureok/agent` 的 **tool-core** 通过 [Model Context Protocol](https://modelcontextprotocol.io) 暴露给 Claude Desktop / Claude Code 等客户端。

**边界(定死)**:对外**只暴露 4 个确定性/检索工具**,**不含 `generate_proposal`/`score_proposal`**——不触发我方生成 LLM、不烧 key、无滥用面(设计 §6.1 · M1)。transport **只用 stdio**(本地进程),严禁在无鉴权下切 HTTP/SSE。

| tool | 入参 | 出参 |
|---|---|---|
| `query_catalog` | `{lineId}` | 保司白名单 / 价格表维度 / 来源(无价格数字) |
| `retrieve_clauses` | `{lineName, query, topK?}` | 带 chunkId/headingPath 的条款证据 |
| `compute_pricing` | `{lineId}` | 参考年保费区间(保费/保额已隔离;非成交报价) |
| `check_compliance` | `{text}` | `{clean, violations[]}`(R1–R4 红线自检) |

## 运行

```bash
# 前置:catalog:build 生成 catalog.json、rag:ingest 生成 rag-index.json、.env 配 OPENAI_API_KEY(仅供检索嵌入)
npm run -w @ensureok/mcp start        # tsx 直接跑(stdio)
npm run -w @ensureok/mcp typecheck
npm run -w @ensureok/mcp inspect      # @modelcontextprotocol/inspector 手测 4 个 tool
```

装配一次索引常驻(不重复加载 3056 块);**不装配 chat provider**。stdout 专供 JSON-RPC 帧,日志走 stderr。
路径可用环境变量覆盖:`ENSUREOK_CATALOG_JSON`、`ENSUREOK_RAG_INDEX`。

## 在 Claude Code / Desktop 注册

见仓库根 `.mcp.json`;或手动:

```jsonc
{ "mcpServers": { "ensureok-insurance": {
    "command": "npx", "args": ["-y", "tsx", "packages/mcp/src/server.ts"],
    "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}", "OPENAI_BASE_URL": "https://<中转>/v1" } } } }
```
