# 生成质量提升 + 工具/MCP/对抗式生成/前端交互 · 设计规格 v2(评审修订版)

> 单一事实源:本规格合并「现有管道调研 + 质量短板映射 + 工具层 / MCP / 对抗式 loop / 前端」四份设计,去重、消歧、把此前分散的可选项**定死为默认值**,可直接作为落地与评审依据。
> 事实基线已核对真实代码:`packages/agent/src/{pipeline.ts,prompt.ts,types.ts,pricing.ts,lineMapping.ts,catalogData.ts,llm/*}`、`packages/{catalog,rag}/src/index.ts`、前端 `src/proposal/*`。
> **v2 变更**:吸收对抗评审 C1/C2/H1–H4/M1–M4/L1–L3,修订项在正文以「**【评审修订】**」标注,并在文末汇总「评审已处理的风险清单」。本规格只做设计,不含实现代码。

---

## 0. v2 核心立场修正(先读)

评审击中的真正软肋不是"死循环"(所有 loop 都有硬顶,不存在),而是**把 LLM judge 当质量保证**——它恰在唯一有增量价值的维度(忠实度)上最不可靠,还被赋予了删除正确内容的破坏性权力;以及**tool-calling 把真实价格数字喂进生成 LLM**,亲手拆掉红线。v2 据此定死三条新立场:

1. **生成 LLM 永不看见价格数字**(连 tool 结果也不给),数字只走确定性组装路径。这把"单一价格出口"从"自律"恢复成"物理不可能"。(治 C1)
2. **LLM judge 只负责软维度(忠实度/说服力),且默认非破坏性**;合规/价位/事实三维**完全由确定性工具判定,不进 LLM**。忠实度的"删除条款"动作降级为"标注待核 + 降分",不自动删。(治 C2/M3)
3. **成本先实测再承诺**:上线前用真实 case 实测 pass 率与 tool 轮次,再定成本结论;并加**单 proposal 全局调用预算硬顶**,超顶即停写采纳当前最优版。(治 H2)

---

## 1. 概述与目标(治「生成不满意」)

### 1.1 现状一句话

现管道 `generateProposal`(`pipeline.ts:26`)对每个险种**并行、各生成一次**:`planLines`(规则映射)→ `retrieve`(RAG,topK=5,截 500 字)→ 一次 `chat.complete` 产出 3 个自由文本字段(`coverageDirection`/`rationale`/`keyClauses`)→ 确定性组装价格/保司/引用。5 并发约 16s 出 7 险种。**无重试、无质量判定、无工具调用、无二次评审**;失败静默降级为占位串。价格/保司/引用已确定性,LLM 输出面窄。

### 1.2 「不满意」的根因(8 条短板,已映射到本规格各子系统)

| # | 短板 | 根因(代码级) | 主责子系统 |
|---|---|---|---|
| 1 | 条款要点泛泛/不忠实原文 | 证据非空时无任何忠实度校验;证据浅(topK=5、截 500 字) | 对抗 loop(忠实度维,**结构化 heading 比对**) |
| 2 | 价位区间过宽/混保额保费 | `pricing.ts` 把全表 ¥/元/万 不分语义并进一个 min..max | 工具层 `compute_pricing`(**数字仅进确定性组装**) |
| 3 | 推荐理由套话 | `rationale` 单次自由文本,无锚点约束 | 对抗 loop(说服力维) |
| 4 | 无险种组合逻辑 | `mapWithConcurrency` 逐险种独立,互不可见 | 组合层 + 对抗 loop(proposal 级) |
| 5 | 合规措辞风险(红线泄漏) | 合规全靠 prompt 自律,无事后拦截 | 三层护栏(**正则只防 token 泄漏,忠实度防语义曲解**) |
| 6 | 缺可解释性(claim→evidence 断链) | `keyClauses:string[]` 挂不到具体 chunk | 工具层(evidenceRefs)+ 前端下钻 |
| 7 | 伪推荐产品 | `recommendedProducts = insurers.slice(0,3)`,零推理 | 工具层 `query_catalog` 匹配排序 |
| 8 | 静默降级(失败不可见) | 解析失败/异常被 catch 吞成占位串 | 对抗 loop 显式打标 + 前端 `ready_degraded` |

### 1.3 目标与非目标

**目标**:把「LLM 一次写完就发」升级为「工具取确定性数据(数字不外泄给生成 LLM)+ 第二个 LLM 只在软维度当质检员按 2 维打分 + 带 diff 评语按字段重写 + 确定性合规终局闸门」,并给前端一套能承载信任信号的呈现层。

**非目标(定死,不在本次范围)**:不让 LLM 接管数字/保司/引用(输出面保持窄);**不把价格数字喂进生成 LLM 上下文**(v2 新增红线);不引入 fetch/undici(沿用 `node:http/https` 的 `postJson`);不重写前端 `src/`(前端只出设计 + 可选 HTML 原型);不改 `planLines` 的规则映射逻辑。

---

## 2. 子系统拆解与依赖(4 块 + 实施优先级)

```
                 ┌─────────────────────────────────────────┐
                 │  tool-core(与协议无关的 4 个确定性函数)   │  ← 一次实现,两处复用
                 │  query_catalog / retrieve_clauses /       │
                 │  compute_pricing / check_compliance       │
                 └───────────────┬───────────────┬───────────┘
        function-schema 适配器     │               │  MCP-tool 适配器
                 ┌────────────────▼──┐         ┌──▼────────────────────┐
块①  Tool-calling │ pipeline 内 LLM 调用 │       块② │ packages/mcp(stdio) │
    (对内, 主战场) │ ChatProvider 扩展   │         │ 对外仅暴露确定性工具  │
                 └────────┬───────────┘         └───────────────────────┘
                          │ 产出结构化 draft(evidenceRefs 挂链;不含价格数字)
                 ┌────────▼───────────────────────────────┐
块③  对抗式 loop   │ generate→judge(2软维rubric)→revise(字段锁diff) │  ← 治「不满意」核心
    (核心)         │ item 级闭环 + proposal 级组合评审        │
                 │ + 确定性合规/价位/事实前置 + 终局 gate     │
                 └────────┬───────────────────────────────┘
                          │ Proposal(含 score/degraded/portfolio/evidenceRefs)
                 ┌────────▼───────────────────────────────┐
块④  前端交互      │ 三层渐进披露 + 可解释抽屉 + 对比视图      │  ← 只消费最终 Proposal
    (仅设计)       │ + 分阶段进度(需 server 前置PR) + 双版导出│
                 └─────────────────────────────────────────┘
```

**依赖链(必须按此顺序)**:tool-core 是块①②的共同底座;块①产出的 `evidenceRefs` 结构是块③忠实度评分的输入;块③产出的 `score/degraded/portfolio` 是块④信任层的数据源。块②(MCP)与线上生成关键路径**解耦**,可独立于①③④任意时间落地。

**建议实施优先级(定死)**:
1. **P0(质量地基)**:`ChatMessage`/`ChatProvider` 扩 tool 语义 → tool-core 四函数 → `compute_pricing` 保费/保额分离(**数字只进确定性组装**)→ `keyClauses` 升级带 `evidenceRefs`。
2. **P0(核心)**:对抗式 loop(item 级 judge + 字段锁 revise + 确定性前置 + 终局 gate)。**但先做 P0.5 实测闸门**(见 §9.0),judge 忠实度准确率与 pass 率不达标则本 loop 不上线,退回单次生成 + 确定性护栏。
3. **P1**:proposal 级组合评审(portfolio)+ pipeline 内 tool-calling 循环全量接入 + **server 端 item 级进度流式透出**(前端分阶段进度的前置依赖)。
4. **P1**:前端信任层(评分徽章、evidenceRef 下钻、组合说明、分阶段进度)。
5. **P2**:MCP 服务器(仅确定性工具)+ 前端调参重生成/双版导出。

理由:MCP 排到最后,是因为它**不参与线上生成**,收益是互操作而非质量;把它前置会挤占核心 loop 的落地窗口。

---

## 3. MCP 与 tool-calling 边界(定死)

这是整份规格的地基,一句话:**同一批工具逻辑写一次(tool-core),两种封装,永不混用**。

| 维度 | 块① Tool-calling(对内) | 块② MCP Server(对外) |
|---|---|---|
| 是什么 | 生成 pipeline 内部,LLM 用 OpenAI function/tool calling 主动调工具 | 独立进程,按 MCP 协议把**确定性工具**暴露给 Claude Desktop / Claude Code 等 |
| 协议 | OpenAI `/chat/completions` 的 `tools` + `tool_calls`(经现有中转) | Model Context Protocol,transport = **stdio(唯一,严禁无鉴权切 HTTP/SSE)** |
| 运行位置 | `packages/agent`,`generateProposal` 关键路径上 | `packages/mcp` 新包,**不在**关键路径 |
| 谁驱动循环 | 我们的 pipeline 写 tool-call 回填循环 | 客户端(Claude)自己决定何时调 |
| 触发的 LLM | OpenAI 兼容中转(现有 `OpenAIChatProvider`) | **对外只暴露不触发我方 LLM 的确定性工具**(见 §6.1) |
| 目的 | 本次**质量提升主战场** | 能力复用 / 互操作 / 人工探索(增值) |
| schema 形态 | OpenAI `function` JSON Schema | MCP `tool` schema(zod → JSON Schema) |

**定死的三条纪律**:
1. **两者都做,但共享的只有 tool-core**:4 个确定性函数活在 `packages/agent/src/tools/`,不认识 OpenAI 也不认识 MCP;function-calling 侧与 MCP 侧各写一层 ≈30 行胶水适配器,业务零重复。
2. **对内是主战场,对外是增值**:线上生成质量提升**只**依赖块①③;MCP 挂掉不影响生成。
3. **工具轨迹不外泄给终端客户**:tool-call 轨迹、judge 对话是内部/调试信息,前端(块④)只消费其**沉淀成的字段**,不渲染工具调用过程(见 §7)。

**【评审修订 · M1】边界自洽性**:原 §3 断言"对外触发的 LLM = 客户端 Claude,我方只提供工具",但原 §6.1 的 `generate_proposal`/`score_proposal` 会跑**服务端 OpenAI + judge loop**,与该断言矛盾,且让外部客户端一句话就能烧我方 key。v2 定死:**MCP 只暴露 4 个纯确定性 tool,不暴露 generate/score**(详见 §6.1)。这样"对外不触发我方 LLM"的边界对全部 MCP tool 成立,规格自洽。

---

## 4. 工具层设计(清单 + 签名)

新增 `packages/agent/src/tools/`。四个工具全部是**确定性/检索**函数,LLM 只决定「何时调、传什么画像入参」,不生产权威事实。从 `@ensureok/agent` 导出供 MCP 复用。

### 4.0 【评审修订 · H3】工具入参越权护栏(新增,先读)

原执行器只做 `validateArgs + 路由`,信任 LLM 传的 `lineId/lineName`;白名单只约束**输出**(insurer),不约束**入参**。生成险种 A 的 worker 里 LLM 可对 `lineId=B` 调工具,拿回看似合法的 B 数据组装出张冠李戴推荐,而 judge 被"严格投喂"喂的正是这批同样错的 chunk,无从发现。

**定死修法**:
- **`lineId`/`lineName` 由 worker 钉死为当前险种,不作为 LLM 可选参数**。`compute_pricing`、`query_catalog` 的 `lineId` 与 `retrieve_clauses` 的 `insuranceLine` 过滤,均由 pipeline 在构造 tool context 时**强制注入当前 worker 的险种**;工具 schema 里这些字段对 LLM 隐藏或标为固定值。LLM 只能传"画像/query"这类不改变险种边界的参数。
- 执行器入参层做**险种一致性校验**:若解析出的 tool_call 参数与 worker 险种不符(伪工具协议模式下 LLM 可能塞入 lineId),**结构化拒绝**(返回 `ok:false` + `error:'line-scope-violation'`),不执行、不外泄跨险种数据。
- MCP 侧(客户端自由驱动,无 worker 上下文)保留 lineId 入参,但仍做 enum 校验;MCP 与 pipeline 的差异仅在"谁提供险种",越权拒绝逻辑共享。

### 4.1 首个必改点:`ChatProvider` 扩 tool 语义

现 `complete()` 吞消息吐字符串,无 tools 语义。**保留 `complete` 不动**(judge/兜底/revise 复用),新增结构化方法:

```ts
// llm/types.ts —— 扩展
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';   // + 'tool'
  content: string;                 // tool 消息里放工具返回的 JSON 字符串
  tool_calls?: ToolCall[];         // assistant 请求调工具时出现
  tool_call_id?: string;           // role:'tool' 回填时指向哪次调用
}
export interface ToolCall {
  id: string; type: 'function';
  function: { name: string; arguments: string }; // arguments 是 JSON 字符串(OpenAI 原样)
}
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ChatCompleteOptions {
  temperature?: number;
  tools?: ToolDef[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}
export interface AssistantTurn {
  content: string; toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | string;
}
export interface ChatProvider {
  readonly id: string; readonly model: string;
  complete(messages: ChatMessage[], opts?: ChatCompleteOptions): Promise<string>;
  completeWithTools(messages: ChatMessage[], opts?: ChatCompleteOptions): Promise<AssistantTurn>; // 新增
}
```

`openai.ts` 第二改点:`complete()` 第 40 行 body 现只发 `{model,messages,temperature}`,新增 `completeWithTools` 把 `tools`/`tool_choice` 并入 body,并解析 `json.choices[0].message.tool_calls`(现只取 `.content`)。**复用现有 `postJson`(node:http/https),不引入 fetch**。`complete()` 重构为 `completeWithTools(...).content` 薄封装。`stub.ts` 同步实现 `completeWithTools`(返回空 toolCalls + 占位内容)。仍**不用 `response_format`**(中转不支持,见 §11),JSON 结构继续靠 prompt + `parseLlmJson` 宽松解析。

### 4.2 工具清单与签名

**险种枚举(定死,12 险种)**:`employer_liability, product_liability, public_liability, group_accident, directors_officers, cyber, ip, tech_eo, ai_liability, cargo, credit_surety, environmental`。
**【评审修订 · H2】** 全规格的基线、成本、上限计算一律**按 12 险种**,不再按 7 险种口径。

#### 4.2.1 `query_catalog` — 查某险种产品/保司/价格表结构(治短板 3、7)

来源:catalog —— `deps.catalogs.get(lineId)` + `extractLineData()` + `LINE_BY_ID`。零 LLM、零 RAG。

```jsonc
// 入参(pipeline 侧 lineId 由 worker 注入,对 LLM 固定;MCP 侧可传)
{ "type":"object","properties":{
    "lineId":{"type":"string","enum":["…12 险种…"],"description":"险种 code"}
  },"required":["lineId"] }
// 出参(JSON 字符串)
{ "lineId":"employer_liability","lineName":"雇主责任险",
  "insurers":["中国人保","平安产险"],            // 保司白名单;推荐排序只能从这里取
  "priceTableDimensions":[{"contextPath":["二、产品对比"],"columns":["方案","保额","年保费","适用职业"]}],
  "hasPriceTable":true,"sourceFile":"…/01-雇主责任险.md","collectedAt":"2026年7月9日" }
```
**只返回价格表维度/列名,不返回具体数字** —— 杜绝「LLM 从 catalog 结构抄数字」旁路,保持单一价格出口。

#### 4.2.2 `retrieve_clauses` — 按险种/缺口定向检索条款(治短板 1、6)

来源:rag —— `retrieve(ragStore, embedding, query, {insuranceLines, topK})`。`RetrievedChunk` 已带稳定 `id`(djb2 hash,已核对),直接透出为 `chunkId`。

```jsonc
// 入参(insuranceLine 过滤由 worker 强制注入,LLM 只传 query/topK)
{ "type":"object","properties":{
    "query":{"type":"string","description":"检索意图,如『等待期 免赔额 除外责任』"},
    "topK":{"type":"integer","minimum":1,"maximum":8,"default":5}
  },"required":["query"] }
// 出参
{ "chunks":[{"chunkId":"a1b2c3…","text":"…(截断 600 字)",
    "sourceFile":"…","headingPath":["二、保险责任","2.3 除外责任"],
    "insuranceLine":"雇主责任险","docCategory":"实务指南","score":0.82}] }
```
`chunkId` 是 `keyClause.evidenceRefs` 的唯一可信来源。`headingPath` 用于 §5.2 忠实度的**结构化 heading 比对**(治 H1)。

#### 4.2.3 `compute_pricing` — 按画像算参考价位,保费/保额物理分离(治短板 2)

来源:确定性计算(catalog 价格表 + 画像 `matchTier`)。**替代** `buildPricing` 的「全表一锅端」。填现 `pricing.ts` 注释挂账的「设计 v3 §5.2 精确 matchTier」。

**【评审修订 · C1】数字流向定死(本次最重要的红线修正)**:
`compute_pricing` 的数值出参(`premium.minCny/maxCny`、`sumInsured` 数值、`display` 含数字串)**只进确定性组装路径**(维持现 `pipeline.ts:73` 的价格挂载方式),**绝不作为 tool 结果回填进生成 LLM 的上下文**。生成 LLM 侧对同一次调用只拿到**不透明语义 token**:

```jsonc
// 生成 LLM 侧可见的 tool 返回(无任何数值)
{ "matched": true,
  "pricingAvailable": true,
  "premiumTier": "中",            // 仅档位:低|中|高|跨档,非数值
  "matchedDimension": {"occupationClass":"1-3类","sumInsuredTier":"目标档"},
  "note": "价位区间已由系统确定性生成,你无需也不得书写任何数字/费率;如需表达价格,只说『参考区间见方案价位栏』" }
// 确定性组装侧(不进 LLM)拿到的完整对象
{ "premium":{"minCny":800,"maxCny":3200,"display":"参考年保费约 800–3200 元"},
  "sumInsured":{"display":"对应保额 50万–200万/人"},
  "source":"product_db","collectedAt":"2026年7月9日",
  "disclaimer":"参考区间 · 以保司实际报价为准 · 非成交报价,承保由合作持牌经纪机构完成",
  "matched":true }
```
- 匹配不到维度时 `matched:false` + 回退全档区间,但**必须标注 `matched:false`**(不静默,治短板 8);LLM 侧对应 `pricingAvailable:false`。
- 这样"LLM 永不看见数字"从自律恢复为**物理不可能**——模型上下文里根本没有可复述的数字。

#### 4.2.4 `check_compliance` — 合规红线自检(治短板 5)

来源:确定性(正则 + 词表 + 保司白名单)。事实源固定为三处硬编码:`DISCLAIMER`(pipeline.ts:22)、`PRICING_DISCLAIMER`(pricing.ts:4)、SYSTEM 硬规则(prompt.ts:14)。

```jsonc
// 入参
{ "type":"object","properties":{
    "text":{"type":"string","description":"待检文本(拼接的自由字段)"},
    "insurerWhitelist":{"type":"array","items":{"type":"string"},"description":"query_catalog 返回的保司名,超出即违规"}
  },"required":["text"] }
// 出参
{ "pass":false,
  "violations":[
    {"rule":"R1_NO_PRICE_NUMBER","span":"约三千元","hint":"删除具体金额(含中文数字),价位改由方案价位栏参考区间承载"},
    {"rule":"R2_NO_CTA","span":"赶紧配置","hint":"疑似招揽/CTA,转人工确认"},
    {"rule":"R3_INSURER_WHITELIST","span":"某某保险","hint":"该保司不在产品库白名单,删除或替换"},
    {"rule":"R4_NO_ABSOLUTE_CLAIM","span":"稳赔","hint":"疑似绝对化承诺,转人工确认"}],
  "suspected":[/* 命中"可疑触发"词但非硬违规的,列此供人工/judge 复核,不直接拦 */] }
```

**规则编号定死(R1–R4)**,judge 合规维度、终局闸门共用同一套编号:

**【评审修订 · C1/H1】R1、R2、R4 词表升级**:
- **R1_NO_PRICE_NUMBER**:
  - 阿拉伯数字:`([\d,]+(\.\d+)?)\s*(万元|万|元|块|%|费率)`。
  - **中文数字(新增)**:`[零一二三四五六七八九十百千万两]{1,}\s*(万元|万|元|块)` 及模糊量词 `(几|多|来|上下|左右)\s*(千|万|百|元|块)`(命中"约三千元""两三千块""几万块"等)。
  - 命中即硬拦(价格数字是硬红线,零容忍)。
- **R2_NO_CTA**:招揽 CTA **分两级**——硬拦词 = {立即投保, 购买, 成交, 最优价, 限时, 名额有限, 抢购};**可疑触发词(转人工/judge,不直接拦但打 `suspected`)** = {赶紧, 闭眼买, 该配了, 别犹豫, 错过, 划算, 优惠}。**词表明确标注为"非穷尽,持续维护"**,不宣称能穷尽所有招揽表述。
- **R3_INSURER_WHITELIST**:保司名 ∉ 该险种 `insurers` 白名单,硬拦。
- **R4_NO_ABSOLUTE_CLAIM**:硬拦词 = {保证, 全额赔付, 一定, 必赔, 100%, 百分百};可疑触发词 = {稳赔, 肯定赔, 放心, 无忧, 全包}。

**【评审修订 · H1】能力边界如实声明**:`check_compliance` 与终局闸门是**纯正则/词表**,只防**表面 token 泄漏**(价格数字/CTA 词/白名单外保司/绝对化词),**测不到"条款曲解"**(说反除外责任、夸大保障范围、曲解免赔)。真正的错误销售责任(误述保障范围)由 §5.2 忠实度维度承担,并对"除外/责任/免赔"高危句式做**结构化 heading 比对**(不是靠 regex,也不是靠 LLM 一句"看起来对")。故本规格**不宣称"三重护栏都能防语义曲解"**——正则防 token,忠实度防语义,分工明确。

### 4.3 执行器(路由 tool_call → 确定性函数)

执行器是**与 LLM 无关的纯模块**(MCP 侧复用同一份)。只依赖 `packages/{catalog,rag}`。

```ts
// tools/executor.ts
export interface ToolResult { ok: boolean; content: string; } // 失败也返回结构化 error,不抛
export interface ToolContext {
  catalogs: Map<InsuranceLineId, ProductCatalog>;
  ragStore: JsonVectorStore; embedding: EmbeddingProvider;
  lineScope?: InsuranceLineId;   // 【H3】worker 注入的当前险种;设置后越权入参一律拒绝
  audience: 'pipeline' | 'mcp';  // 【C1】pipeline 模式下 compute_pricing 只回语义 token,不回数值
}
export interface ToolExecutor {
  run(call: ToolCall): Promise<ToolResult>;         // function-calling 入口
  invoke(name: string, args: unknown): Promise<ToolResult>; // MCP 侧复用(绕过 OpenAI 包装)
  readonly defs: ToolDef[];
}
export function createToolExecutor(ctx: ToolContext): ToolExecutor { /* validateArgs + lineScope 校验 + 路由 + try/catch 结构化失败 */ }
```
四个 handler 直接落到现有确定性函数:`query_catalog`←`extractLineData`+`LINE_BY_ID`;`retrieve_clauses`←`retrieve()`;`compute_pricing`←新增 `computePricingByTier`(**audience 决定是否脱敏数值**);`check_compliance`←新建 `runComplianceScan`。**MCP 服务器只 `import { createToolExecutor }`(audience:'mcp'),零逻辑重复**。

### 4.4 pipeline 内 tool-call 循环(独立 `runToolLoop`)

Provider 保持「一回合」纯传输;循环逻辑放独立函数,可单测:

```ts
// llm/toolRunner.ts
export async function runToolLoop(
  chat: ChatProvider, messages: ChatMessage[], tools: ToolDef[],
  executor: ToolExecutor,
  opts?: { maxSteps?: number; temperature?: number; budget?: CallBudget },
): Promise<{ content: string; steps: number; trace: {tool:string;args:string;ok:boolean;result:string}[] }> {
  // 循环:completeWithTools → 若有 toolCalls 则并发执行、回填 tool 消息 → 再 complete;
  // 无 toolCalls 即收敛;达 maxSteps 或 budget 耗尽 → 强制不带 tools 收口一次。
}
```
**maxSteps 定死 = 6**。接入点 `pipeline.ts:50–70`:现「一次 complete → parseLlmJson」整段换成 `runToolLoop`,`content` 走 `parseLlmJson`,`trace` 存进 item 可观测字段。`GenerateDeps` 新增 `toolExecutor?`(不注入 → 平滑退回旧单次 complete)、`maxToolSteps?`(默认 6)、`callBudget?`(见 §9.3)。**逐险种并行结构(并发 5)不变**,循环隔离在单险种内。

> 关于「预检索」:证据仍像现在一样预检索一轮塞进首个 user 消息(省一次往返);`retrieve_clauses` 用于 LLM **按需二次定向回查**。二者不冲突。

---

## 5. 对抗式生成 loop 与评分 rubric(核心,最详)

### 5.1 数据流总览

```
perLineFn(planned line)                         ← pipeline.ts:31,item 级并行(concurrency=5)
  ├─ retrieve() 预检索证据(top-K 全量留存)      ← 现有 pipeline.ts:39(evidence: RetrievedChunk[])
  ├─ compute_pricing(数值→确定性组装) / query_catalog 保司  ← 工具层,确定性
  └─ reviseLoop(item 级闭环)  ← 替换 pipeline.ts:58–70
        iter 0: generate(可带 tool-calling,不见数字) → draft(3 字段 + keyClauses.evidenceRefs)
        ── 确定性前置(不进 LLM):runComplianceScan + 保司白名单 + 价格数字正则 ──
        judge(draft, 该险种 top-K 全部 chunk, gapTitles, profile) → 仅 fidelity/persuasion 两维
        综合判定(确定性维 + 软维,管道汇总) → verdict + gateFailed
        verdict=pass → 采纳 break
        verdict=fail & iter<max & 预算未耗尽 → 按字段锁渲染 revise 提示,只改 fail 字段,iter++
        iter=max / 预算耗尽 仍 fail → 降级打标(非破坏性:标注待核,不自动删条款)
  ↓ 组装 items[]
portfolioReview(proposal 级,一次)  ← pipeline.ts:100 后、103 return 前
        全部 item → 组合一致性评分 → 不达标重跑组合层(封顶 1 次)
  ↓
complianceGate(终局正则闸门,独立于 loop,必过)   ← 只防 token 泄漏,不宣称防语义
  ↓ Proposal
```

**核心权衡先行(定死)**:
- 【C2】judge 只在**软维度(忠实度/说服力)**用 LLM;**硬维度(合规/价位/事实)完全用确定性工具判定,不进 LLM**。这省掉一半 judge token 与误判面,也消除"同模型自评硬维度"的自偏好风险。
- 【H4】**仅对 `verdict=fail` 的字段重写**,pass 的字段**在 revise 上下文里锁死为不可变**,judge 重判也只判被改字段。

### 5.2 评分 rubric(五维,但只有两维走 LLM)

| 维度 | 判定方式 | 权重 | 判定内容 | fail 触发 |
|---|---|---|---|---|
| **合规红线** `compliance` | **确定性**(R1–R4 正则/词表,不进 LLM) | gate(一票否决) | 命中 R1–R4 硬拦词即 fail;`suspected` 转人工不自动拦 | 命中任一硬拦规则 |
| **事实准确性** `accuracy` | **确定性**(保司 ∈ 白名单 校验,不进 LLM) | gate + 0.20 | 推荐保司是否全在 `insurers` | 保司 ∉ 白名单 |
| **价位合理性** `pricing` | **确定性**(R1 数字正则,不进 LLM) | gate + 0.10 | 文本是否出现任何价格数字 | 文本出现数字价格(与合规重叠,双记) |
| **条款忠实度** `fidelity` | **LLM judge + 结构化 heading 比对** | **0.40** | 每条 keyClause 是否被引用/可引 chunk entail;除外/责任是否讲反 | 见下方"非破坏性"说明 |
| **说服力可读性** `persuasion` | **LLM judge** | **0.30** | rationale 是否绑定「缺口×责任×画像」三元组、无套话 | —(不作 gate) |

**【评审修订 · C2】权重重分配理由**:合规/事实/价位既已由确定性工具判定,LLM judge 的真正增量只在 fidelity+persuasion,故把权重集中到这两维(0.40/0.30),确定性三维仅作 gate + 少量权重防"擦边采纳"。

**pass 条件(定死)**:`无任何 gate fail` **且** `weightedScore ≥ 78` **且** `fidelity ≥ 3`。
`weightedScore = Σ(weight × dimScore) / 5 × 100`(0–100)。

**【评审修订 · M2】滞回带(消除边界抖动)**:pass 阈值与 fail 阈值不相等,中间维持上一轮态——
- `weightedScore ≥ 78` → pass;`≤ 72` → fail;`72 < score < 78` → **维持上一轮 verdict**(首轮落此区间按 fail 处理进入一次 revise)。
- 目的:边界附近的 item 不再 run-to-run 翻 pass/fail,缓解 §M2 指出的"重度非确定性侵蚀可复现"。

**【评审修订 · L3】"管道重算"如实措辞**:管道用上表权重**重算 weightedScore,仅消除 judge 自报值的算术漂移,不消除维度分本身的判断误差**。质量瓶颈在各维 0–5 分的判断质量,"以管道重算为准"**不代表**分数更可信,只代表加权和算对。文档不得用"管道重算"暗示质量保证。

### 5.3 Judge 实现(第二个 LLM 调用)

**【评审修订 · C2】judge 模型选型(核心修正)**:
- **默认要求 judge 用与生成不同厂商/不同家族的模型**(第二意见),`deps.judge` 独立注入。同模型自评在 NLI/自我纠错上有自偏好与幻觉盲区,尤其保险条款"除外/责任讲反"是负例/范围推理,是 LLM NLI 最弱场景——设计上直接否掉"同模型自评"。
- **中转只有一个模型时的定死回退**:`deps.judge` 回落 `deps.chat`(同模型),**此时 fidelity gate 强制降级为非破坏性**(见 5.4),即"单模型 = 不自动删条款"。这条依赖关系写死在 `LoopConfig` 校验里:`judge` 未独立注入 ⇒ `fidelityDestructive:false` 恒成立。

**输入(【评审修订 · M3】修正"严格投喂"反噬)**:被评 draft 的 3 字段(含 `keyClauses.evidenceRefs`)、**该险种预检索的全部 top-K chunk(不再仅喂被引 chunk)**、`insurers` 白名单、`gapTitles`、`profileSummary`。
- 原设计只喂"被引 chunk",若模型引错 chunkId(该条实际由 chunk B 支撑却引了 A),judge 只见 A → 必判 not-supported → 删对内容。
- 修法:judge 看该险种全部 top-K,对某 not-supported 条款**先尝试"是否有别的 chunk 支撑"**,有 → 输出 `action:'rebind'`(改引用,不删);无 → 才标 not-supported。
- **【评审修订 · L2】不给 judge 任何价格数值**:价位维度已由确定性正则判定,不进 judge;judge 上下文**不含 `PricingHint.display`(含数字串)**,只在必要时给"档位存在"布尔标记。消除"要 judge 判不许写数字、上下文却有数字"的自相矛盾。

**判定要稳**:judge `temperature = 0`;测试层提供**确定性 stub judge**(治 M2 的 flaky)。

**judge 输出 JSON schema(定死,仅两软维)**:
```jsonc
{ "fidelity":{
    "score":0-5,
    "claims":[{"index":0,"status":"entailed|not-supported|contradicted",
               "evidenceRef":"chunkId|null",
               "rebindTo":"chunkId|null",    // 【M3】在全 top-K 里找到的更佳支撑;有则改引不删
               "clauseType":"责任|除外|免赔|其他",  // 【H1】结构化标注,与 chunk headingPath 比对
               "note":"为何"}]},
  "persuasion":{"score":0-5,"vagueSentences":["未绑定具体缺口的原句"]},
  "revisionInstructions":[      // 仅针对 fail 字段;禁「写得不够好」空话
    {"target":"keyClauses[2]","action":"rebind","toRef":"chunkId","reason":"实际由 chunk#b7 支撑,原引用错误"},
    {"target":"rationale","action":"rewrite","reason":"第1句过泛,改为绑定缺口『员工工伤敞口』×责任『雇主对雇员人身损害赔偿』×画像『50人研发』"}] }
```
- **【H1】结构化 heading 比对**:`clauseType='除外'` 的 keyClause,其证据 chunk 的 `headingPath` 必须命中"除外/责任免除"类 heading;`clauseType='责任'` 须命中"保险责任"类 heading。类型与 heading 错配 → 强判 not-supported(这是 regex 测不到、靠结构规则兜住的"讲反除外责任"高危场景)。此比对是**确定性规则**,不依赖 judge 的自由判断,降低对单一 LLM NLI 的依赖。

### 5.4 Loop 控制(全部定死)

| 参数 | 取值 | 说明 |
|---|---|---|
| 粒度 | item 级(主)+ proposal 级(一次) | 软维/合规/价位/事实=险种级 → item 级;组合一致性 → proposal 级 |
| item 级 `maxRevisions` | **2**(共 3 次生成) | 1 draft + 2 revise |
| proposal 级组合层 | **1** 次重跑 | |
| 达标即停 | 是 | verdict=pass 立即 break |
| 每轮 judge | 1 次,**只判被改字段** | 【H4】字段锁,pass 字段不重判 |
| `reviseOnlyFailedFields` | true | 【H4】字段级锁,不是 item 级 |
| `judgeTemperature` | 0 | |
| `fidelityDestructive` | **false(默认)** | 【C2】非破坏性;仅当 judge 独立异构模型注入且人工开启才可 true |
| `finalComplianceGate` | true(恒开) | |
| `callBudget` | 见 §9.3 | 【H2】单 proposal 全局调用硬顶 |
| pass 滞回带 | ≥78 pass / ≤72 fail | 【M2】 |

**【评审修订 · C2】封顶/gate fail 的降级(非破坏性,治短板 8 + C2)**:
- **合规 gate fail(R1–R4 硬拦)**:**绝不硬发**。涉事字段清空为方向性占位「`${lineName}的方向性保障建议(待持牌顾问细化)`」,`degraded=true, degradedReason='compliance'`。(合规是不可逆红线,这里维持破坏性剥离——因为泄漏一旦发出即违规,宁缺毋滥。)
- **fidelity 判 not-supported**:**默认不自动删条款**。
  - 先尝试 `rebind`(改引 top-K 内更佳 chunk);
  - rebind 无果 → **标注 `faithfulness:'unverified'`(⚠待核)、`qualityScore` 扣分**,条款仍保留但前端显式打"待顾问核对";
  - `degraded=true, degradedReason='fidelity-unverified'`,`evidenceInsufficient` 置真。
  - **只有当 judge 是独立异构模型且运营明确开启 `fidelityDestructive:true` 时**,才允许自动删 not-supported 条款,且删除动作进入**人工确认闸门队列**(不即时对客户可见地删,而是标记待人工确认后落库)。
  - 理由:同模型自评一次假阴性就删掉正确条款 = 把好输出改坏;非破坏性默认确保"最坏也只是多一个待核标注,不损失正确内容"。
- **仅软维分低(persuasion)**:采纳迭代中 `weightedScore` 最高的一版(留每轮 ScoreCard 选优),`degraded=true, degradedReason='low-persuasion'`。

### 5.5 反馈 → 重写(字段锁 diff 回填)

**【评审修订 · H4】字段级锁(防回归震荡)**:revise 复用生成 SYSTEM(prompt.ts 现有 5 条硬规则不变),但 pass 的字段作为**不可变上下文固定**,只把 fail 字段交给模型改;judge 重判也只判被改字段。避免"整份重生成把上轮已 pass 的 coverageDirection 改坏 → fail 集合轮次间跳动 → 系统性 max-out"。

```
[ system: 生成 SYSTEM ]
[ user:   buildItemMessages 的 user 块 ]
[ assistant: 上一版 draft JSON ]          ← 回填,让模型看到自己写的
[ user:   REVISE 指令块 + 锁定清单 ]       ← 明示哪些字段"锁定不可改"
```
REVISE 块示例:
```
锁定(原样保留,禁止改动,仅供上下文):
- coverageDirection:<上一版原文>
- keyClauses[0], keyClauses[1]:<原文>
仅修改以下字段,输出同结构 JSON(锁定字段必须逐字回填原值):
- keyClauses[2]:改引用 —— 实际由 chunk#b7 支撑(judge: rebind),更新其 chunkId
- rationale:重写第1句 —— 过泛,须绑定缺口「无雇主责任险」×责任「员工工伤医疗/伤残赔付」×画像「50人研发团队」
硬约束不变:不写价格数字(含中文数字如"约三千")、不写招揽话术、保司仅限白名单、keyClauses 每条须能对应一个真实证据 chunkId。
```

### 5.6 proposal 级组合评审(治短板 4)

`pipeline.ts:100` items 生成后、`103 return` 前插 `portfolioReview(items, deps)`。PORTFOLIO_SYSTEM 只做三件事、不改写单条内容:①责任重叠去重提示(公众责任 vs 产品责任、出海三件套 tech_eo+cyber+product_liability);②主次分层(承接 tier1–4,强制险置顶);③出海包聚合。产出中立的 `combinationNote` 文本,挂到 `Proposal.portfolio`;不达标重跑组合层(封顶 1 次)。组合层输出**同样过确定性合规扫描**(不含价格数字/CTA)。

### 5.7 终局 complianceGate(第三层合规保险,纯正则,必过)

`return` 前对全 proposal 跑 `complianceGate`(不经 LLM,事实源 = R1–R4 含中文数字词表 + 三处硬编码)。**即使 loop 判 pass 也必过**;命中即剥离违规片段或降级涉事字段并打标。**【H1】能力边界如实标注**:此闸门**只防 token 泄漏(价格数字/CTA/白名单/绝对化词),不防语义曲解**;语义忠实由 §5.2 fidelity 承担。不宣称它是"防一切合规风险"的万能闸门。

### 5.8 关键 TypeScript 接口

```ts
export type Dimension = 'compliance'|'fidelity'|'accuracy'|'pricing'|'persuasion';
export type Verdict = 'pass'|'fail';
export type Faithfulness = 'entailed'|'unverified'|'not-supported'|'contradicted';
export interface DimensionScore { score: number; verdict?: Verdict; notes: string[]; }
export interface RevisionInstruction { target: string; action: 'rewrite'|'keep'|'rebind'|'delete'|'add'; toRef?: string; reason: string; }
export interface ScoreCard {
  dimensions: Record<Dimension, DimensionScore>;
  weightedScore: number;         // 管道重算(仅防算术漂移)
  verdict: Verdict; gateFailed: Dimension[];
  revisionInstructions: RevisionInstruction[];
}
export interface KeyClause { text: string; evidenceRefs: string[]; faithfulness?: Faithfulness; clauseType?: '责任'|'除外'|'免赔'|'其他'; }
export interface ItemDraft { coverageDirection: string; rationale: string; keyClauses: KeyClause[]; }
export interface ReviseLoopOutput {
  item: ItemDraft; qualityScore: number; scoreCards: ScoreCard[];
  revisions: number; degraded: boolean;
  degradedReason?: 'compliance'|'fidelity-unverified'|'low-persuasion'|'llm-error';
  callsUsed: number;             // 【H2】本 item 实际 LLM 调用数(可观测)
}
export declare function reviseLoop(input: ReviseLoopInput): Promise<ReviseLoopOutput>;
export declare function portfolioReview(items: ProposalItem[], deps: GenerateDeps): Promise<{combinationNote: string; reran: boolean}>;
export declare function complianceGate(p: Proposal): { hits: {field:string;quote:string;rule:string}[]; sanitized: Proposal };
```

**`ProposalItem` 追加字段(向后兼容,前端选读)**:
```ts
keyClausesDetailed?: KeyClause[];  // 新;同时保留扁平 keyClauses:string[](取 text)兼容现前端
qualityScore?: number;             // 采纳版 weightedScore 0-100
degraded?: boolean;
degradedReason?: 'compliance'|'fidelity-unverified'|'low-persuasion'|'llm-error';
revisions?: number;                // 实际重写次数(可观测,治静默降级)
callsUsed?: number;                // 【H2】实际 LLM 调用数,前端/监控可读
```
`GenerateDeps`(pipeline.ts:10)追加:`judge?: ChatProvider`、`loop?: LoopConfig`(`enabled`/`granularity{item,proposal}`/`maxRevisions=2`/`passThreshold=78`/`failThreshold=72`/`weights`/`reviseOnlyFailedFields=true`/`judgeTemperature=0`/`fidelityDestructive=false`/`finalComplianceGate=true`)、`callBudget?`。`enabled:false` 一键回退现管道单次生成(回归安全)。

---

## 6. MCP 服务器设计

新增 `packages/mcp`,遵循官方 `@modelcontextprotocol/sdk` + StdioServerTransport 惯例,复用 `packages/{catalog,rag}`。**不在线上生成关键路径**。

### 6.1 暴露的 tool(【评审修订 · M1】收敛为 4 个纯确定性 tool)

| MCP tool | 复用 | 入参(zod) | 出参 |
|---|---|---|---|
| `query_catalog` | tool-core | `{lineId:enum(12), profile?}` | 保司/产品/价格表维度/来源 |
| `retrieve_clauses` | tool-core(`retrieve`+`loadStore`) | `{lineName, query, topK?≤10}` | `chunks[]`(chunkId/headingPath/score) |
| `compute_pricing` | tool-core(`computePricingByTier`,audience:'mcp' 可回数值给客户端) | `{lineId, profile}` | `{premium, sumInsured, matched, disclaimer}` |
| `check_compliance` | tool-core | `{text, insurerWhitelist?}` | `{pass, violations[], suspected[]}` |

**【评审修订 · M1】删除 `generate_proposal` / `score_proposal`**。理由:二者会触发**服务端 OpenAI + judge loop**,让外部 Claude 客户端一句话就能烧我方 key、跑我方对抗 loop,成本/滥用面无设防,且与 §3"对外不触发我方 LLM"的边界自相矛盾。收敛后 4 个 tool **全部是确定性/检索,不触发我方付费 LLM**(仅 `retrieve_clauses`/`compute_pricing` 用到嵌入检索,成本极低且无生成)。若未来确需对外暴露 generate/score,**必须先加调用配额 + 鉴权**,并单独立项评审,不在本规格范围。

所有 tool **继承合规红线**:`compute_pricing` 输出必带护栏 disclaimer;任何 tool 不产出成交报价/CTA。

**stdio-only 铁律(定死)**:transport **只用 stdio**(本地进程,当前唯一安全边界)。**严禁在无鉴权下切 HTTP/SSE transport**——用户担心的"无鉴权网络暴露"仅在切 HTTP 时才成立;stdio 本地进程不监听网络端口,不构成该风险。若将来要 HTTP transport,必须先落地鉴权层,单独评审。

### 6.2 目录结构与 package.json

```
packages/mcp/
├─ package.json          # name:@ensureok/mcp, type:module, bin: ensureok-mcp
├─ tsconfig.json
├─ src/
│  ├─ server.ts          # McpServer + StdioServerTransport + registerTool ×4
│  ├─ context.ts         # 一次性装配:loadCatalogs / loadStore / embedding(不装配 chat,因不触发生成)
│  ├─ tools/{queryCatalog,retrieveClauses,computePricing,checkCompliance}.ts
│  └─ schemas.ts         # zod 入参 shape(与 tool-core JSON Schema 单一事实源)
└─ README.md
```
```jsonc
{ "name":"@ensureok/mcp","type":"module","private":true,
  "bin":{"ensureok-mcp":"dist/server.js"},
  "scripts":{"start":"tsx src/server.ts","build":"tsc","typecheck":"tsc --noEmit"},
  "dependencies":{"@modelcontextprotocol/sdk":"^1.x","@ensureok/agent":"*","@ensureok/catalog":"*","@ensureok/rag":"*","zod":"^3.x"} }
```
根 `package.json` `workspaces:["packages/*"]` 通配自动纳入;加脚本 `"mcp:start":"npm run -w @ensureok/mcp start"`。

### 6.3 注册骨架与 stdio 铁律

```ts
// server.ts
const server = new McpServer({ name: 'ensureok-insurance', version: '0.1.0' });
const ctx = await buildContext();          // 装配 catalog/rag/embedding 一次(避免每次重载 3056 块索引;不装 chat)
registerDeterministicTools(server, ctx);   // 仅 4 个确定性 tool
await server.connect(new StdioServerTransport());
```
```ts
// tools/retrieveClauses.ts —— MCP tool = 薄适配器包 tool-core
server.registerTool('retrieve_clauses', {
  title: '检索保险条款证据',
  description: '按险种中文名 + 查询语义,从 RAG 索引检索原文条款块,返回带 chunkId 的证据。',
  inputSchema: { lineName: z.string(), query: z.string(), topK: z.number().int().min(1).max(10).optional() },
}, async ({lineName, query, topK}) => {
  const r = await ctx.executor.invoke('retrieve_clauses', {lineName, query, topK});
  return { content: [{ type:'text', text: r.content }] };
});
```
**stdio 铁律(定死)**:stdout 专供 JSON-RPC 帧,任何调试输出必须走 `stderr`。现管道内若有 `console.log`,MCP 进程内重定向到 stderr,否则毁协议帧。

### 6.4 依赖装配与密钥

`context.ts` 启动时一次性:catalog `loadCatalogs(ENSUREOK_CATALOG_JSON)`;rag `loadStore(ENSUREOK_RAG_INDEX)` + `createEmbeddingProvider`(嵌入模型必须与索引一致,retriever 会校验并抛错)。**不装配 chat provider**(4 个确定性 tool 不生成)。密钥/路径全走**环境变量**,不硬编码。

### 6.5 在 Claude Code / Desktop 注册(`.mcp.json`)

```jsonc
{ "mcpServers": { "ensureok-insurance": {
    "command":"npx","args":["-y","tsx","packages/mcp/src/server.ts"],
    "env":{ "OPENAI_API_KEY":"${OPENAI_API_KEY}","OPENAI_BASE_URL":"https://<中转>/v1",
      "ENSUREOK_CATALOG_JSON":"packages/catalog/dist/catalog.json",
      "ENSUREOK_RAG_INDEX":"packages/rag/dist/index.json" } } } }
```
(`OPENAI_API_KEY` 仅供嵌入检索用,不触发生成。)构建后 `args` 换成 `["packages/mcp/dist/server.js"]`(纯 node,免 tsx)。校验:`npx @modelcontextprotocol/inspector tsx packages/mcp/src/server.ts` 手测 4 个 tool。

---

## 7. 前端交互系统设计(仅设计,不实现,不碰 `src/`)

前端只消费最终 `Proposal`。对抗式生成新字段需后端先在契约里补上,前端**按存在性优雅降级**。字段名对齐 `src/proposal/types.ts` 与 `packages/agent/src/types.ts`。

### 7.0 【评审修订 · M4】前端"仅设计"的边界澄清(先读)

原 §7.6 的分阶段进度依赖 `packages/server` 在轮询响应透出 `progress{stage, perItem[]}`——这是把 concurrency=5 worker 池 + 内部 revise loop 的 item 级状态流式透出的**非平凡后端管道工作**,不属于"前端仅设计"。v2 定死:
- **§10 计划表补一个显式的 server-side 进度流式 PR(PR5b),作为前端 PR7 的前置依赖**。进度未透出前,前端 §7.6 **优雅降级为现有转圈**(不阻塞)。
- 单条重写("重写这一条")见 §7.5 的冷却/配额/稳定化约束。
- §7.7/7.8 的双版导出、上一版 diff、锚点转尾注等打磨,**降格为 P2**,在核心 judge 机制经真实数据验证有效前(§9.0)不投入设计深度。

### 7.1 核心矛盾与主线

现前端把 7 险种平铺成互不相干卡片、把 3 段自由文本直接铺给用户,**没有信任层**——用户看不到「这句话从哪来、可不可信、为什么是这几个险种」。前端解法:把后端新产出的**评分/可解释锚点/组合逻辑**变成一等公民。

**边界定死**:MCP/tool-calling 对前端 UI **无直接接口**。前端**不展示工具调用轨迹、不展示 judge 对话**,只展示其结果沉淀成的字段(评分、evidenceRef、组合说明)。理由:工具轨迹是调试信息,给客户看削弱专业感且泄漏实现。

### 7.2 三层渐进披露

```
第 0 层 · 方案概览(信任+全局)
   ├─ 文档抬头(documentName/company/clientSummary,无 PII)
   ├─ 概览条:X 险种 · Y 强制 · 整体可信度徽章 · 生成时间
   ├─ 组合说明(portfolio):为什么这几个/谁主谁辅/出海三件套聚合/责任去重提示
   └─ 视图切换:[卡片流]/[对比表] · [调整画像重新生成] · [导出 PDF]
第 1 层 · 险种卡(单险种要点+信任信号)
   ├─ tier 徽章 + lineName + urgency + 质量徽章(综合分/是否降级)★新
   ├─ coverageDirection 一句话
   ├─ 参考保费区间 · 保额(物理分离)★新 + 护栏文案
   ├─ 推荐保司(带一句匹配理由)★新
   └─ [查看证据与理由 ▾]
第 2 层 · 证据下钻(可解释+可回查)
   ├─ 推荐理由逐句挂「缺口×条款×画像」锚点 chip ★新
   ├─ 条款要点逐条挂 evidenceRef,点开看 chunk 原文 + 忠实度状态(✓忠实/⚠待核/✗无支撑)★新
   ├─ 触发缺口 / 价格表下钻(drilldownSourceFile)/ citations 来源
   └─ 证据不足/降级标注(evidenceInsufficient/degradedReason)★新
```
默认只展开第 0、1 层,第 2 层按需——避免把「不满意」换成「信息过载」。

**【评审修订 · C2/H1】忠实度状态三态**:`✓忠实(entailed)` / `⚠待核(unverified)` / `✗无支撑(not-supported)`。**新增 `⚠待核`** 对应非破坏性 fidelity 降级——条款保留但提示"待顾问核对",而非被删。图标+文字双编码(色盲可达)。

### 7.3 险种对比视图(治短板 4 的前端解法)

与卡片流切换的**对比表**:列 = 紧迫度/层级/参考保费/覆盖缺口数/可信度/组合角色。**组合角色列**与**责任重叠标记 ⚠** 直接来自 portfolio pass;出海三件套可折叠成一组。排序按紧迫度(默认)/可信度/保费;筛选:仅强制/仅出海/隐藏降级项。价位列只放参考区间标签,绝不放成交数。

### 7.4 「为什么推荐这条」可解释(治短板 3、6)

- **理由锚点化**:`rationale.drivers` 每句后挂可点 chip `[缺口:知识产权无保障][画像:hasPatent=true][条款:第4条侵权责任]`,点 chip 跳缺口/画像/条款。
- **条款可回查**:`keyClauses` 升级带 `evidenceRefs` 后,每条右侧「原文 E2 ✓忠实/⚠待核/✗无支撑」,点开侧滑看 chunk 全文 + 出处。忠实度状态直接来自 judge 的核对——**把对抗打分暴露给用户的最直观点**;`⚠待核` 诚实提示不确定,不伪装成已验证。

### 7.5 调参重生成

概览层「调整画像重新生成」→ 画像抽屉(预填当前 profile)→ 改字段(高亮改动)→ **画像级重跑**(整份 `ProposalRequest` 重发,因 planLines 会重新映射险种集合)→ 保留上一版做 diff(新增/移除/价位变化/紧迫度变化)。

**【评审修订 · M4】单条重写约束(防非确定翻转与无限烧钱)**:「重写这一条」按钮对单 item 触发一次 judge loop,但:
- **冷却 + 配额**:同一 item 重写有冷却时间与次数上限(如每 item 最多 3 次/会话),防用户无限点无限烧钱。
- **结果稳定化**:同一 item 的重跑**取历史最优版**(按 qualityScore),**不允许比当前显示更差的结果覆盖**——避免"点一次 clean→degraded 翻转"反而削弱信任信号。
- **合规护栏文案不可编辑、不可移除**。

### 7.6 生成中的分阶段进度(依赖 server 前置 PR5b)

对抗式生成把耗时拉到 2–4×,干等伤体验。设计**分阶段进度**,把「慢」重构成「在为你把关」:
```
生成方案中…(预计 40–120 秒,质量优先)  [■■■■□□□]
✓ 识别 12 个险种、3 个强制缺口
✓ 检索条款证据(资料库)
● 正在生成并自检:雇主责任险 (4/12) ↳ 已通过合规与忠实度核对 ✓
○ 组合与去重分析   ○ 终审
```
险种级进度(item 并行 + 仅 fail 重写天然可上报);**不暴露 judge 评语/工具原文**,只报状态语义;降级不静默(标「证据不足,将标注建议顾问补充」)。**【M4】此功能依赖 server 端 PR5b 透出 `progress`;未透出前退回现有转圈**。

### 7.7 导出 PDF(P2)

复用 `window.print()` + `print.css`。升级:导出前完整性提示(含 N 项证据不足/待核项);锚点 chip 在 PDF 降级为尾注 `[E2]` + 尾页来源清单;**双版模式开关**——客户版隐藏分数只留「已通过合规与条款核对」声明,顾问版保留完整评分与 ⚠待核 标注;底部固定 `disclaimer` + 每价位旁 `pricing.disclaimer`。**未过合规闸门的 item 不进入客户可见渲染**(不给降级展示,直接不显)。

### 7.8 状态机升级

现 `idle→loading→ready|error` 升级为:`idle→submitting→generating(poll progress)→ ready | ready_degraded | error`;`ready/ready_degraded → reparametrizing → submitting`(保留上一版)。新增 `ready_degraded` 把「有降级/待核项的成功」与「干净成功」分开,概览层才能诚实提示「N 项建议顾问补充」。

### 7.9 后端新字段 → UI 映射(前后端契约)

| 后端新增字段 | UI 表现 |
|---|---|
| `item.qualityScore` + `score.dimensions` | 卡头可信度徽章;客户版隐藏分数只留合规声明 |
| `keyClausesDetailed:{text,evidenceRefs[],faithfulness,clauseType}` | 条款右侧「原文 E2 ✓/⚠待核/✗」点开看 chunk |
| `rationale.drivers:{gapId,profileField,clauseRef}[]` | 理由句后可点 chip |
| `pricing.premium{...}` + `pricing.sumInsured{...}`(确定性组装,非 LLM 产出) | 保费/保额两行独立 |
| `recommendedProducts[].matchReason` | 保司后一句匹配理由;对比表可展开可比字段 |
| `proposal.portfolio{summary,overlaps[],layering,bundles[]}` | 概览组合说明 + 对比表组合角色列 + 重叠 ⚠ |
| `item.degraded`+`degradedReason` | 降级样式 + 概览「N 项建议顾问补充」+ 导出提示 |
| `item.callsUsed` / `revisions` | (顾问版/监控)可观测,不给客户看 |
| poll `progress{stage,perItem[]}`(需 PR5b) | 分阶段进度条;无则退回转圈 |

**设计守则**:评分是**信任信号不是排名工具**——排序仍按 urgency/tier,分数只回答「可不可信」。`compliance` 一票否决,未过合规闸门的 item 不进入客户可见渲染。

### 7.10 视觉原则(通用,可直接落地)

渐进披露分层承载认知负荷;信任信号轻量低饱和、不喧宾夺主;诚实优先于漂亮(降级/待核显式标注);合规文案固定位固定样式、永远可见不可折叠;对比视图用对齐降低比较成本;状态可逆可撤;等待即沟通;屏幕/打印双形态。

---

## 8. 合规护栏继承

合规红线**全程不可协商**,分层执行,但**如实区分"能防什么"**:

1. **生成端**:prompt.ts SYSTEM 5 条硬规则不变(只依据证据、禁写保费数字、禁招揽话术、保司只引产品库、语气中立)。**【C1】叠加"生成 LLM 上下文物理上不含价格数字"**——从源头让"复述数字"不可能。
2. **确定性工具自检(防 token 泄漏)**:生成中/生成后跑 `check_compliance`(R1–R4,含中文数字词表)。**只防表面 token,不防语义曲解**(如实声明)。
3. **judge 复核(防语义曲解,仅忠实度)**:`fidelity` 维度 + 结构化 heading 比对承担"除外/责任讲反"等语义风险。**默认非破坏性**。
4. **终局 complianceGate**:纯正则,`return` 前必过一遍,事实源 = `DISCLAIMER`(pipeline.ts:22)、`PRICING_DISCLAIMER`(pricing.ts:4)、SYSTEM 硬规则(prompt.ts:14)+ R1–R4 中文数字词表。命中即剥离或降级打标。

**【评审修订 · H1】能力边界声明**:上述**第 2、4 层是纯正则,只防表面 token 泄漏**(价格数字/CTA/白名单/绝对化词);**"条款曲解 = 误述保障范围"这类语义/监管风险不在正则能力内**,由第 3 层忠实度 + 结构化 heading 比对承担,且该层是软判定、有不确定性(故有 `⚠待核` 态转人工)。规格**不宣称"三重护栏都能防语义曲解"**,不给假安全感。

**四条不可破的边界纪律**:
- **单一价格出口**:价格只信产品库,`compute_pricing` 是唯一出口且**数字只进确定性组装、不进生成 LLM**;`query_catalog` 只回维度不回数字;LLM 永不写数字(物理不可能 + 正则兜底,含中文数字)。
- **单一条款出口**:条款只信 RAG;`keyClauses.evidenceRefs` 必须来自 `retrieve_clauses` 的真实 chunkId;挂空/挂不存在的 id → 丢弃该条。
- **保司白名单**:推荐排序只取 `query_catalog.insurers`;白名单外保司名即 R3 违规(确定性判定,不进 judge)。
- **红线文案**:UI/导出/MCP 任何位置不出现「具体成交报价/立即投保/最优价/名额有限」;价位一律「参考区间 · 以保司实际报价为准 · 承保由持牌经纪完成」。

---

## 9. 成本与延迟影响(【评审修订 · H2】重算 + 实测闸门 + 预算硬顶)

### 9.0 上线前实测闸门(P0.5,定死,前置于全量 loop)

评审 C2/H2 指出:成本模型的"多数一次过"是**未验证的乐观假设**,judge 忠实度准确率是**未验证的核心不确定性**。故定死:
- **loop 全量上线前,先跑一批真实 case(建议 ≥30 份 proposal、覆盖 12 险种)实测**:①judge 忠实度判定准确率(与人工标注比对,重点看假阴性率——误删/误标正确条款);②首轮 pass 率;③平均/最坏 tool 轮次与 LLM 调用数。
- **不达标不上线**:judge 假阴性率过高 → 保持 `fidelityDestructive:false` 甚至暂缓 fidelity gate,退回"单次生成 + 确定性护栏 + 忠实度仅标注不判定"。**不拿假设当结论**。

### 9.1 基线(按 12 险种)

每险种 1 次 LLM,12 险种并发 5,约 **25–30s**(7 险种约 16s 的等比外推)。

### 9.2 加 loop 后单险种最坏(含 tool 轮次)

**【H2】原 §9 漏算"每个 generate turn 本身可含 6 步 tool round-trip"**。真实最坏 ≈
`(draft 含至多 6 tool 步) + judge 1 + 2×(revise 含至多 6 tool 步 + judge 1)`
≈ **draft 7 + revise×2 各 7 = 约 21 次串行 LLM 调用/险种**(最坏上界)。
12 险种若全部触发最坏且不设顶 = 12×21 = 252 次调用,**必须靠预算硬顶封住**(见 9.3),不能任其展开。

### 9.3 缓解手段(全部叠加,定死)

1. **【H2】全局调用预算硬顶 `callBudget`(新增,最重要)**:单 proposal 总 LLM 调用数设硬上限(默认建议 **总调用 ≤ 12险种 × 6 = 72 次**,可配)。达顶即**停止一切重写与 tool 回查,直接采纳各 item 当前最优版并打标 `degraded:'budget-capped'`**,而非任由 12×21 展开。这是成本失控的最终闸门。
2. **确定性前置省 judge**:合规/价位/事实先跑正则/白名单,命中直接判定**不进 judge**(judge 只跑忠实度+说服力两维,token 减半)。
3. **只对 fail 的字段重写**(字段锁,H4),pass 字段停在 1 draft + 1 judge。
4. **judge 用小/快、且异构模型**(`deps.judge` 独立注入);判定比生成简单。
5. **maxSteps=6 限制单 turn tool 轮次**;`retrieve_clauses` 按需回查而非每次必调(预检索已覆盖多数)。
6. **并发维持 item 级**(concurrency=5 不变);loop 在 worker 内串行,总墙钟 ≈ 最慢险种 loop 时长而非 Σ。
7. **达标即停 + 选优降级 + 滞回带**(M2),不追满分、减少边界重写。

### 9.4 预估墙钟(诚实区间,承认不确定)

- **一次过为主**(理想,待 §9.0 实测证实):约 **2×**(~50–60s,12 险种)。
- **少量 item 触发重写**:**3–4×**(~90–120s)。
- **最坏(多 item max-out)**:由 `callBudget` 封在 ~72 次调用内,墙钟受并发摊平后仍在异步任务 API 可接受区间。
- **关键诚实声明**:上述区间**押在"多数一次过"上,该假设未经实测**;§9.0 实测前不对外承诺"以 2× 为主"。压测降本时 `loop.enabled:false` 一键回退,或 `maxRevisions:1` / 关组合层 / 降 callBudget 逐档降。

### 9.5 MCP 成本

进程常驻、一次装配索引,单 tool 调用无重复加载开销;**4 个确定性 tool 不触发我方生成 LLM**(M1),对外无付费 LLM 滥用面;不在线上生成路径,不影响生成成本。

---

## 10. 分阶段实施计划(每阶段 = 一个 PR)

| PR | 交付物 | 验收标准 |
|---|---|---|
| **PR1** 接口地基 | `llm/types.ts` 加 tool 语义;`openai.ts` 实现 `completeWithTools`(复用 postJson,解析 tool_calls);`stub.ts` 同步 | typecheck 通过;`complete` 行为不变(回归);stub 单测通过;发一个带 tools 的请求探活(支持→原生;不支持→§11 伪协议降级) |
| **PR2** tool-core + 执行器 | `tools/` 四函数 + `createToolExecutor`(含 **lineScope 越权校验 H3**、**audience 数值脱敏 C1**)+ `TOOL_DEFS`;`compute_pricing` 维度 matchTier、保费/保额分离;`check_compliance` R1–R4 **含中文数字 + 可疑触发两级词表(C1/H1)** | 四函数单测(含 `matched:false`、R1–R4 各命中一例、**中文数字命中**、**跨险种入参被拒**);执行器失败返回结构化 error 不抛;pipeline 模式 compute_pricing 出参**不含数值** |
| **PR3** keyClauses 结构升级 | `ProposalItem` 加 `keyClausesDetailed:{text,evidenceRefs[],faithfulness,clauseType}`;`rationale.drivers`;`degraded`/`degradedReason`/`revisions`/`callsUsed`/`qualityScore` | 契约向后兼容;evidenceRefs 校验:挂空/不存在 id 被丢弃 |
| **PR4** 对抗 loop(核心) | `judge/`(**仅 fidelity/persuasion 两维 C2**,喂全 top-K M3,不喂价格数值 L2,结构化 heading 比对 H1)+ `reviseLoop`(**字段锁 H4**,**非破坏性 fidelity 降级 C2**,**滞回带 M2**,**callBudget H2**)+ `complianceGate` 终局闸门;`GenerateDeps` 加 `judge?`/`loop?`/`callBudget?` | `enabled:false` 回退现管道;合规 gate fail 绝不硬发;**fidelity not-supported 默认标 ⚠待核不删**;**单模型时 fidelityDestructive 恒 false**;封顶显式 degraded;**预算硬顶生效**;确定性 stub judge 使测试可复现(M2) |
| **PR4.5** 实测闸门 | 按 §9.0 跑 ≥30 真实 case,产出 judge 忠实度准确率/假阴性率、pass 率、调用数报告 | **报告达标才继续 PR5;不达标则调参或退回单次生成 + 忠实度仅标注**(不拿假设当结论 H2/C2) |
| **PR5** tool-calling 循环接入 + 组合层 | `runToolLoop`(maxSteps=6,budget)接入 perLineFn;`portfolioReview`(封顶 1 次)→ `Proposal.portfolio` | 不注入 executor 平滑退回;trace 存 item 可观测;组合层输出不含价格数字/CTA |
| **PR5b** server 进度流式(**新增,M4**) | `packages/server` 轮询响应透出 `progress{stage, perItem[]}`(item 级 loop 状态) | 进度字段透出且不阻塞;未接入时前端优雅退回转圈。**PR7 前置依赖** |
| **PR6** MCP 服务器 | `packages/mcp` 新包(**仅 4 个确定性 tool 薄适配器 M1**)+ `context.ts` 常驻装配(不装 chat)+ `.mcp.json` + stderr 重定向 | `@modelcontextprotocol/inspector` 手测 4 tool 全通;stdout 无污染;**无 generate/score,不触发我方生成 LLM**;stdio-only;密钥仅经 env |
| **PR7** 前端信任层 | 三层渐进披露、评分徽章、evidenceRef 下钻、**忠实度三态(✓/⚠待核/✗)**、组合说明、`ready_degraded`、分阶段进度(消费 PR5b) | 字段缺失优雅降级;未过合规闸门 item 不渲染;护栏文案固定不可折叠;进度无 PR5b 时退回转圈 |
| **PR8** 前端交互增强(P2) | 对比表、调参重生成 + 上一版 diff、**单条重写含冷却/配额/稳定化(M4)**、双版导出、锚点转尾注 | 调参走画像级重跑保留上一版;客户版隐藏分数;单条重写不允许更差结果覆盖;导出件含 disclaimer + 每价位护栏 |

> PR 顺序即依赖顺序。PR1–PR4 是 P0;**PR4.5 是硬闸门**;PR5/PR5b/PR6 P1;PR7–PR8 P1/P2 前端。每个 PR 独立可评审、可回滚。

---

## 11. 未决事项与所需

### 11.1 需外部确认/提供(阻塞项)

1. **OpenAI 函数调用是否经现有中转支持(关键未决,影响 PR1/PR5)** —— 现管道注释已确认中转**不支持 `response_format`**。`tools`/`tool_calls` 是否被同一中转透传**未经验证**。**验收动作(定死)**:PR1 里先发一个最小 `tools` 请求探活。
   - **若支持**:按 §4 走原生 function-calling。
   - **若不支持(定死降级方案)**:退回**「prompt 内伪工具协议」**——system 定义工具清单与调用格式。**【评审修订 · L1】解析健壮化**:伪协议**用逐行 JSON(每行一个 tool 调用)+ 独立分隔符(如 `<<TOOL>>...<</TOOL>>`)**,管道**逐行/逐块非贪婪提取**,而非对整段用贪婪 `parseLlmJson` 的 `/\{[\s\S]*\}/`(会把 tool 调用+散文抓成一大坨畸形串)。解析失败**显式打标可观测(`toolParseError`),不静默吞**(否则退回短板 8)。tool-core、执行器、judge、rubric 全部不受影响。**对抗 loop(块③)本就不依赖 tool-calling**(多轮对话即可承载 revise 回填),不受此未决影响。

2. **judge 模型选型(【评审修订 · C2】升级为设计约束)** —— **强烈建议 `deps.judge` 用与生成不同厂商/不同家族的模型**(第二意见,避免同模型自评盲区)。需确认中转是否提供异构第二模型 id。
   - 若有异构模型:judge 走它,`fidelityDestructive` 可在 §9.0 实测达标后由运营开启。
   - **若只有一个模型**:`deps.judge` 回落 `deps.chat`,**`fidelityDestructive` 强制恒 false**(单模型不自动删条款,只标 ⚠待核),成本按最坏计并由 callBudget 封顶。

3. **poll `progress` 字段的后端支持(【评审修订 · M4】升级为显式 PR5b)** —— §7.6 分阶段进度依赖 `packages/server` 透出 `progress{stage, perItem[]}`,**已列为独立 PR5b,是 PR7 前置依赖**。未透出前前端退回现有转圈(优雅降级,不阻塞)。

### 11.2 三个缺失的 skill(本机未安装,如实标注)

| Skill | 用途 | 当前替代 | 可增强处 |
|---|---|---|---|
| `web-design-skill` | 高保真视觉设计系统 | 通用间距/层级/栅格原则占位 | 概览条/卡片/对比表视觉层级、tier/urgency 色彩系统、徽章与 chip 组件一致视觉语言、明暗主题、**忠实度三态图标** |
| `tasteskill` | 「品味级」分寸校准 | 「轻量、双编码、不喧宾夺主」原则占位 | 可信度徽章尺度、**⚠待核**图标隐喻、降级项「诚实但不惊吓」的措辞、组合说明语气 |
| `email-design-eng` | 邮件安全 HTML | 当前范围只到屏幕+PDF | 若方案落成邮件版/可转发摘要,处理内联样式、表格布局、暗色兼容;对比表在邮件里的降级表达 |

**三者均非阻塞**:本规格用通用 UX 原则完成设计。视觉调性与正式配色待 skill 补齐后按其调色板校准。

### 11.3 原型验证建议(不动真前端)

用户想用的 `playground` skill **本机未安装**。**退化方案(可立即执行)**:用 **Artifact** 产出自包含单文件 HTML(内联 CSS/JS,符合 CSP),塞 2–3 条 mock `ProposalItem`(含 mock 评分/evidenceRef/portfolio/**忠实度三态**,复用 `src/proposal/mockProvider.ts` 结构保证字段名一致),把 §7 三层渐进披露 + 可解释 chip + 对比表 + 分阶段进度做成可点原型。**验证清单**:①用户能否在概览层 10 秒说出「为什么是这几个险种」;②看到 ⚠ 责任重叠是否困惑;③点「原文」是否理解在溯源;④分阶段进度是否缓解等待焦虑;⑤客户版/顾问版切换是否清晰;⑥**⚠待核 标注是否被理解为"诚实提示"而非"出错"**。验证通过再决定是否落地,全程不碰 `src/`。

---

**贯穿全规格的不可协商红线(v2 加固)**:LLM 输出面保持窄(仅 3 自由文本字段);价格/保司/引用全确定性,**价格数字物理上不进生成 LLM 上下文**;合规由 `check_compliance`(含中文数字词表)+ judge 忠实度(仅语义,默认非破坏性)+ 终局正则闸门分层执行,**且如实区分"正则防 token、忠实度防语义"**;方案永不出现具体成交报价或立即投保 CTA,承保由持牌经纪完成。

---

## 评审已处理的风险清单

| 编号 | 严重度 | 风险摘要 | 本规格处理 | 落点章节 |
|---|---|---|---|---|
| **C1** | CRITICAL | `compute_pricing` 把真实数字喂进生成 LLM,拆掉"单一价格出口";R1 正则只认阿拉伯数字,中文数字("约三千元")绕过全部护栏 | 定死:数值**只进确定性组装,绝不回填生成 LLM 上下文**,LLM 侧只得不透明档位 token(`premiumTier`);R1 正则**补中文数字 + 模糊量词词表**;"LLM 不见数字"从自律恢复为物理不可能 | §0.1, §4.2.3, §4.2.4-R1, §8, §9.3 |
| **C2** | CRITICAL | judge=同模型自评,唯一有价值的忠实度维恰最不可靠;fidelity gate 破坏性自动删正确条款 | (a)judge **默认要求异构模型**,单模型则 `fidelityDestructive` 强制 false;(b)合规/价位/事实**不进 LLM,只做确定性**,judge 只跑忠实度+说服力;(c)fidelity **默认非破坏性**(标 ⚠待核不删),删除动作需人工确认闸门 | §0.2, §5.2, §5.3, §5.4, §11.1.2 |
| **H1** | HIGH | 三重护栏两重是纯正则,防不住"条款曲解";CTA/绝对化词表可平凡绕过,假安全感 | 如实**下调宣称(正则只防 token,不防语义)**;忠实度加**结构化 heading 比对**(除外/责任类型与 chunk heading 强制匹配);词表改**硬拦 + 可疑触发两级**,可疑转人工;声明词表非穷尽 | §4.2.4-R2/R4, §5.2-fidelity, §5.3-H1, §5.7, §8 |
| **H2** | HIGH | 成本低估:漏算每 turn 6 步 tool 轮次(真实最坏≈21次/险种);"多数一次过"未验证;基线按 7 险种实为 12 | 最坏**重算含 tool 轮次**、全按 **12 险种**;加 **P0.5 实测闸门**(先测 pass 率/假阴性率再定论);加**全局调用预算硬顶 callBudget**,超顶停写采纳最优版 | §9.0, §9.2, §9.3, §9.4, PR4.5 |
| **H3** | HIGH | 工具入参无越权护栏,LLM 可对错误 lineId 调工具→跨险种污染,judge 无法发现 | worker 把 `lineId/lineName` **钉死为当前险种,对 LLM 隐藏**;执行器加 **lineScope 一致性校验,越权结构化拒绝** | §4.0, §4.3, PR2 |
| **H4** | HIGH | revise 无字段锁,重生成回归已 pass 字段,fail 集合震荡→系统性 max-out | **字段级锁**:pass 字段作不可变上下文固定,只改 fail 字段,judge 只重判被改字段 | §5.1, §5.4, §5.5 |
| **M1** | MEDIUM | MCP 的 generate/score 触发服务端 OpenAI,打破"对外=客户端模型"边界,外部客户端可烧我方 key | MCP **收敛为 4 个纯确定性 tool,删除 generate/score**;不装配 chat provider;**stdio-only,严禁无鉴权切 HTTP** | §3, §6.1, §6.2, §6.4 |
| **M2** | MEDIUM | 重度非确定性与代码库"可复现"目标冲突,阈值硬悬崖致 run-to-run 翻转、测试 flaky | 阈值加**滞回带(≥78 pass/≤72 fail)**;测试层提供**确定性 stub judge**;文档承认这是"质量换复现"的取舍 | §5.2, §5.3, §9.4, PR4 |
| **M3** | MEDIUM | "严格投喂"反噬:judge 只看被引 chunk,引错 id 即误判 not-supported 删对内容 | judge 改喂**该险种全部 top-K**;not-supported 先尝试 **rebind(改引不删)**,无果才标 | §5.3, §5.4 |
| **M4** | MEDIUM | 分阶段进度是隐藏后端 PR,"仅设计"名不副实;单条重写制造非确定翻转+无限烧钱 | 补**显式 server 进度 PR5b**(PR7 前置);单条重写加**冷却/配额/结果稳定化(不允许更差覆盖)**;P2 打磨降格 | §7.0, §7.5, §7.6, PR5b |
| **L1** | LOW | 伪工具降级协议靠贪婪正则解析,吐散文/多调用即抓成畸形串,静默不调工具 | 伪协议改**逐行 JSON + 独立分隔符,非贪婪逐块提取**;解析失败**显式打标不吞** | §11.1.1 |
| **L2** | LOW | 喂 judge 的 `PricingHint.display` 本身含数字,"不给数字"自相矛盾 | judge 价位上下文**不给 display 数值串**,价格数字泄漏本就由确定性正则判、不进 judge | §5.3-L2, §5.2 |
| **L3** | LOW | "管道重算 weightedScore"给假信心,只消算术错不消判断错 | 措辞如实:**重算仅防算术漂移,不提升维度分可信度**;不用它暗示质量保证 | §5.2 |

**未采纳/部分采纳说明**:无风险被判为无效——评审 13 条全部为有效设计风险并已落地处理。其中 C1/C2 作为最高优先级重构(数字不进生成 LLM、judge 只做软维且默认非破坏性),H2 额外新增 PR4.5 实测硬闸门作为 loop 全量上线的前置条件——即"先用真实数据验证 judge 有效性,再决定是否上这套 loop",直接回应评审"否则可能付 3–4× 成本买一个会把好输出改坏的质检员"的核心警告。