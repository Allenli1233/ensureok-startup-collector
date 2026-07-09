# @ensureok/agent

方案生成 Agent 管道:**诊断结果 → 推荐险种 → `@ensureok/catalog` 出产品/价位 + `@ensureok/rag` 出条款依据 → LLM 生成叙述 → 组装方案**。

分工纪律:**价位与保司只来自产品库(结构化、可溯源,LLM 不许编)**;条款/理由来自 RAG;LLM 只写"承保方向/推荐理由/条款要点"叙述。

## 用法

```bash
# 前置:已 rag:ingest 生成索引、catalog:build 生成 catalog.json、.env 配好 OPENAI_API_KEY
npm run -w @ensureok/agent generate            # 用内置 demo 画像生成一份方案
npm run -w @ensureok/agent generate -- req.json

npm run -w @ensureok/agent test                # stub 端到端单测,无需 key
npm run -w @ensureok/agent typecheck
```

无 key 时用 stub LLM/嵌入跑通结构(无真实叙述/检索质量)。

```ts
import { generateProposal, loadCatalogs, createChatProvider } from '@ensureok/agent';
import { loadStore, createEmbeddingProvider } from '@ensureok/rag';

const proposal = await generateProposal(request, {
  catalogs: loadCatalogs('packages/catalog/data/catalog.json'),
  ragStore: await loadStore('packages/rag/data/rag-index.json'),
  embedding: createEmbeddingProvider(),
  chat: createChatProvider(),
  generatedAt: new Date().toISOString(),
});
```

## 管道步骤

1. **planLines**(确定性):诊断 coverage → 去重的推荐险种 + tier(强制置顶)。
2. **RAG 检索**:按险种中文名过滤召回条款/理由证据。
3. **LLM 叙述**:基于证据生成 `coverageDirection / rationale / keyClauses`(护栏:不编价格/保司、无招揽话术)。
4. **价位/保司**(确定性):`buildPricing` 从产品库价格表抽人民币区间 + 强制护栏;保司取产品库清单。
5. **组装**:含具体价位→"保障方案建议",否则→"风险保障方向说明";附全局免责声明。

## 已知边界(诚实标注,后续细化)

- 价位是**全档跨度参考区间**(PR3b 务实版);带画像维度的精确 matchTier 测算见设计 v3 §5.2,后续补。
- LLM 输出靠提示词约束 + 宽松 JSON 解析;设计里的"回表实存校验/忠实性校验"等强护栏留待细化。
- COI 出海保障目前拆成 tech_eo/cyber/product;产品库缺 COI,兜底提示待前端(PR4)。
- 无 HTTP 后端;前端异步调用 + 打印导出见 PR4。
