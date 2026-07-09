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
import { generateProposal, loadCatalogs, createChatProvider, createJudge } from '@ensureok/agent';
import { loadStore, createEmbeddingProvider } from '@ensureok/rag';

const proposal = await generateProposal(request, {
  catalogs: loadCatalogs('packages/catalog/data/catalog.json'),
  ragStore: await loadStore('packages/rag/data/rag-index.json'),
  embedding: createEmbeddingProvider(),
  chat: createChatProvider(),
  // 可选:开启对抗式 loop(judge 用异构模型出第二意见)
  judge: createJudge(),
  loop: { enabled: true, maxRevisions: 2 },
  generatedAt: new Date().toISOString(),
});
```

## 管道步骤

1. **planLines**(确定性):诊断 coverage → 去重的推荐险种 + tier(强制置顶)。
2. **RAG 检索**:按险种中文名过滤召回条款/理由证据。
3. **LLM 叙述**:基于证据生成 `coverageDirection / rationale / keyClauses`(护栏:不编价格/保司、无招揽话术)。条款要点走结构化 `keyClausesDetailed{text, evidenceRefs, clauseType}`——LLM 按 `[E?]` 证据编号引用,pipeline 映射为真实 `chunkId` 并校验(挂空/不存在的剔除),扁平 `keyClauses:string[]` 保留兼容;`callsUsed` 记该险种实际 LLM 调用数。
4. **对抗式 loop**(adv-PR4;配了 `judge` + `loop.enabled` 才启用):judge(建议**异构模型**出独立第二意见)只评两个软维度——`fidelity` 条款忠实度、`persuasion` 说服力,各 0–5,阈值 `total ≥ 7`。不达标 → 带评语**非破坏性**重写(只采纳"变好"的版本,越改越差就停),封顶 `maxRevisions`、并受**全局调用预算** `callBudget` 硬顶。仍不达标 → `degraded=true` 取最优版。价格/保司/合规红线**不归 judge 管**(见步骤 5、6)。
5. **价位/保司**(确定性):`buildPricing` 从产品库价格表抽人民币区间 + 强制护栏;保司取产品库清单。
6. **终局合规闸门**(确定性,始终执行):`checkCompliance` 正则扫描生成文本,命中红线(R1 保费金额 / R2 招揽 CTA / R3 监管强制暗示 / R4 具名保司报价)即**隐去**——`degraded=true`、记 `complianceFlags`、把内容换成"待持牌顾问核对"占位。**绝不硬发红线内容。**
7. **组装**:含具体价位→"保障方案建议",否则→"风险保障方向说明";附全局免责声明。

### 对抗式 loop 开关(脚本/后端)

`generate` 脚本与 `@ensureok/server` 默认**关闭** loop,用环境变量开启:

```bash
ADV_LOOP=1 npm run -w @ensureok/agent generate -- tests/fixtures/one-line.json  # 单险种最省的真机 loop 冒烟
npm run -w @ensureok/agent probe:judge                                          # 探活 judge 模型能否返回结构化 JSON
```

- `ADV_LOOP=1` 开启;`ADV_MAX_REV`(默认 2)每险种最大重写次数。
- `OPENAI_JUDGE_MODEL`(默认 `claude-haiku-4-5`,与生成家族**不同**避免自评盲区)· `JUDGE_THRESHOLD`(默认 7/10)。
- 无 `OPENAI_API_KEY` → judge 退回 `StubJudge`(恒通过,仅供跑通结构)。

## 已知边界(诚实标注,后续细化)

- 价位是**全档跨度参考区间**(PR3b 务实版);带画像维度的精确 matchTier 测算见设计 v3 §5.2,后续补。
- 忠实性/说服力经对抗式 loop 的软维度把关(adv-PR4);"回表实存校验"等结构化硬护栏仍留待细化。judge 只评软维度,金额/保司/合规红线由确定性工具(步骤 5、6)把关。
- COI 出海保障目前拆成 tech_eo/cyber/product;产品库缺 COI,兜底提示待前端(PR4)。
- 无 HTTP 后端;前端异步调用 + 打印导出见 PR4。
