# @ensureok/rag

『保险资料/』的 **RAG 语义检索库** —— 分块 + 嵌入(OpenAI / 离线 stub 可插拔) + 本地向量库 + 检索。

分工:**RAG 负责「讲道理 / 条款依据 / 案例 / 选购方法论」**;**价格与保司只信 `@ensureok/catalog`(结构化产品库)**,不从 RAG 编。详见 `docs/superpowers/specs/2026-07-09-agent-rag-design-v3-products-pricing.md`。

## 用法

```bash
# 1) 配 key:把仓库根 .env.example 复制成 .env,填 OPENAI_API_KEY(国内加 OPENAI_BASE_URL 中转)
cp .env.example .env

# 2) 摄取:读 ../保险资料 → 分块 → 嵌入 → data/rag-index.json(索引不提交进仓库)
npm run -w @ensureok/rag ingest

# 3) 测试 / 类型检查(用离线 stub,无需 key)
npm run -w @ensureok/rag test
npm run -w @ensureok/rag typecheck
```

无 `OPENAI_API_KEY` 时自动用**离线 stub 嵌入**跑通全流程(无语义质量,仅供开发);配了 key 则用 OpenAI 真实嵌入。

```ts
import { loadStore, createEmbeddingProvider, retrieve } from '@ensureok/rag';

const store = await loadStore('packages/rag/data/rag-index.json');
const provider = createEmbeddingProvider(); // 按 .env 选后端
const hits = await retrieve(store, provider, '雇主责任险 保险责任范围', {
  insuranceLines: ['雇主责任险'],
  docCategories: ['法律法规'],
  topK: 6,
});
```

## 已知边界(诚实标注)

- **本版只摄取 `.md`**(169+ 份)。`保险资料` 里的 **PDF 保单条款抽取(pdfjs)是后续工程点**,摄取时只计数提示、暂不入库。
- 向量库为内存 JSON + 暴力 cosine(几千块规模足够);更大规模再换 SQLite。
- 索引 `data/rag-index.json` 与嵌入模型绑定;换模型需重跑 ingest(retrieve 会校验模型一致)。
- stub 嵌入仅验证「检索机制」正确,不代表真实语义排序质量。
