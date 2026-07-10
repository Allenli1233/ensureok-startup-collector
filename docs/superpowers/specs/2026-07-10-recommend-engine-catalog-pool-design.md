# PR-① 推荐引擎:产品库驱动候选池(方案 B)实现 spec

- 日期:2026-07-10
- 分支:feat/adv-pr4-adversarial-loop(本 PR 只改文件,统一由主进程提交)
- 范围(硬约束):仅 `packages/agent/**` 与 `src/proposal/buildRequest.ts`、`src/config/startupProfileCollector.ts`、`src/proposal/types.ts`。**不碰** `src/proposal/ReportPage.tsx` / `report.css` / `BlockDetail.tsx` / `treemapLayout.ts` / `reportModel.ts`(并行 PR 领域)。
- 红线:险种筛选**全程确定性、无 LLM 参与**;**价格数字不进筛选、不进 LLM**。

---

## 1. 目标(一句人话)

报告推荐哪些险种,不再只由 `diagnoseGaps` 的 coverage 关键词硬映射决定;而是把产品库 12 险种当**候选池**,用画像做**确定性打分**,过阈值的险种也能进报告。目标是接通 3 个当前"任何答案都出不来"的死库存险种,并修掉 fintech 缺口文案里一处悬空引用导致的静默丢弃。

---

## 2. 现状与问题

### 2.1 当前链路

`diagnoseGaps(answers)` 产出 `GapFinding[]`(每条带 `coverage` 文本)→ `planLines(findings)`(`packages/agent/src/lineMapping.ts`)用 `RULES` 关键词把 `coverage` 文本映射成 `InsuranceLineId[]` → `pipeline.ts:68 const planned = planLines(req.diagnosis.findings)` 消费。

险种是否进报告,**完全**取决于 `diagnoseGaps` 恰好写出了能被 `RULES` 命中的 coverage 文案。这是"文案驱动"而非"画像驱动"。

### 2.2 三个死库存(任何答案都触达不到)

产品库 12 险种(`@ensureok/catalog` `INSURANCE_LINES` / `LINE_BY_ID`):
`employer_liability, product_liability, public_liability, group_accident, directors_officers, cyber, ip, tech_eo, ai_liability, cargo, credit_surety, environmental`。

`RULES` 只覆盖 9 个(employer_liability / group_accident / tech_eo / cyber / product_liability / public_liability / directors_officers / ip / ai_liability)。

以下 3 个**没有任何 RULE、且 `diagnoseGaps` 的任何 coverage 文本都不含其触发词**,故永远出不来:

| 险种 | lineName | 目录 | 现状 |
|---|---|---|---|
| `cargo` | 货物运输险 | 10 | 无 RULE、无 coverage 命中 → 死库存 |
| `credit_surety` | 信用保证保险 | 11 | 无 RULE、无 coverage 命中 → 死库存 |
| `environmental` | 环境污染责任险 | 12 | 无 RULE、无 coverage 命中 → 死库存 |

### 2.3 Crime 静默丢弃

`startupProfileCollector.ts` 的 `fintech_base` 缺口(第 ~455 行)coverage 写:

```
coverage: '网络安全保险(Cyber)+ 犯罪保障(Crime)',
```

`网络安全` 命中 RULE → `cyber`;但"犯罪保障(Crime)"**产品库无 crime 险种、`RULES` 无对应映射**,`mapCoverageToLines` 直接跳过 → 悬空引用被**静默丢弃**。用户读到"建议犯罪保障(Crime)",报告里却永远没有这一条,是一个说了不给的失信点。

**修法(本 spec 采用):从 `fintech_base.coverage` 移除 `+ 犯罪保障(Crime)` 悬空引用**,coverage 收敛为 `'网络安全保险(Cyber)'`。理由:产品库确无 crime 险种,`credit_surety`(信用保证保险)语义是信用/保证,并非欺诈犯罪险,不宜张冠李戴;而"内外部欺诈"的风险叙事保留在 `desc` 中不动。收敛后 fintech 画像的候选池由 §4 打分补齐(fintech → tech_eo + cyber),不再引用不存在的 crime。

---

## 3. 设计总览

在"findings 驱动线"之外,新增一条"画像打分线"通道,两条通道**确定性合并、去重、封顶**:

```
                 ┌─ findings 驱动(现有 planLines 逻辑,保留 urgency/叙事)
diagnosis ──────►│                                                        ├─► 合并去重 ─► 封顶(≤8) ─► PlannedLine[]
profile(结构化)─► lineRelevance(profile) ─► 打分线(score≥阈值 → advice)┘
```

- findings 驱动:`mandatory` / `high` **只来自强 findings**(合同强制 COI、IPO 董责等),保留现有 urgency 与 `gapTitles` 叙事。
- 打分驱动:`lineRelevance` 对 12 险种打分,score≥阈值的默认以 `urgency='advice'` / `tier3` 进候选(`ai_liability` 仍 `tier4`)。
- 合并:同一 lineId 两边都出 → 取**更紧迫**的 urgency(findings 若更急则用 findings 的;**绝不降级**打分线到更低优先级),`gapTitles` 与打分 `reasons` 合并。
- 封顶:`mandatory + high` 全进;其余按分数排序填到总数 ≤ 8。

全链路无 LLM、无价格。`lineRelevance` 只读 `profile` 的结构化布尔/枚举信号。

---

## 4. `lineRelevance` 打分引擎(新增 `packages/agent/src/lineRelevance.ts`)

### 4.1 纯函数签名

```ts
export interface LineRelevance { score: number; reasons: string[]; }
export function lineRelevance(profile: ProposalRequest['profile']): Map<InsuranceLineId, LineRelevance>;
```

- 纯函数,无副作用,无 LLM,无网络,无价格。
- 只读 profile 的**结构化信号**(§6),不读 label 文本(label 是本地化展示串,不稳定)。
- 输出只含 score>0 的险种;调用方按阈值过滤。

### 4.2 序数化辅助(确定性映射)

```
hc(headcountValue):  lt10→1  10to30→2  31to100→3  gt100→4   其它/缺省→0
fund(fundingValue):  none→0  angel→1  pre_a→2  b_plus→3  ipo→4  其它/缺省→0
ind ∈ {saas, ai, hardware, fintech, health, ecom, other}
```

### 4.3 打分表(基线分 + 触发加权)

阈值 `THRESH = 2`:score ≥ 2 的险种进候选池。每条命中追加一条中文 `reason`(供可解释,不含价格)。

| lineId | 触发条件 | score | reason 示例 |
|---|---|---|---|
| `employer_liability` | **有员工恒基线**(人数越多越高) | `2 + hc`(3–6) | 有雇员(雇主责任基线)· 人数 {label} |
| `group_accident` | 人数 ≥ 10(hc≥2) | `hc`(2–4) | 团队 ≥10 人,团体意外保障 |
| `tech_eo` | ind ∈ {saas, ai, fintech} | `3` | 技术/软件服务责任(Tech E&O) |
| `cyber` | dataSensitive **或** ind ∈ {saas, ai, fintech, health, ecom} | `(ind命中?2:0)+(dataSensitive?2:0)`,cap 4 | 处理敏感数据 / 数字化业务网络责任 |
| `product_liability` | ind ∈ {hardware, ecom} **或** (overseas && hasPhysicalProduct) | `(ind命中?3:0)+(海外实体?2:0)`,cap 4 | 实体产品责任 / 出口产品责任 |
| `public_liability` | ind ∈ {ecom, hardware} | `3` | 经营场所/第三者责任 |
| `directors_officers` | funding ≥ pre_a(fund≥2),ipo 最高 | `fund`(2–4) | 融资阶段董监高责任(D&O) |
| `ip` | hasPatent **或** ind ∈ {ai, hardware} | `(hasPatent?3:0)+(ind命中?2:0)`,cap 4 | 有专利 / 技术密集知识产权敞口 |
| `ai_liability` | ind = ai(**tier4**) | `3` | AI 输出责任(品类共创) |
| `cargo` | (overseas && hasPhysicalProduct) **或** ind ∈ {hardware, ecom} | `(海外实体?3:0)+(ind命中?2:0)`,cap 4 | 跨境货物运输 / 硬件电商物流 |
| `environmental` | ind = hardware | `3` | 硬件制造环境责任 |
| `credit_surety` | overseas **或** ind ∈ {ecom, hardware} | `(overseas?2:0)+(ind命中?2:0)`,cap 4 | 出海应收/信用 · 贸易信用保证 |

死库存接通验证(证明现可达):
- `cargo`:overseas&&hasPhysicalProduct(≥3)或 hardware/ecom(≥2)→ 可达。
- `credit_surety`:overseas(2)或 ecom/hardware(2)→ 可达。
- `environmental`:hardware(3)→ 可达。

fintech 画像:命中 `tech_eo`(3)+`cyber`(ind 命中 2,dataSensitive 时 4),**不再引用不存在的 crime**。

### 4.4 tier 归属

打分线默认 `urgency='advice'`,tier 由现有 `tierFor(lineId, urgency)` 决定:`ai_liability → tier4`,其余 advice → `tier3`。合并后若 urgency 被 findings 提升到 mandatory/high,则 tier 随之为 tier1/tier2(`ai_liability` 恒 tier4)。

---

## 5. `planLines` 合并 / 去重 / 封顶(改 `packages/agent/src/lineMapping.ts`)

### 5.1 `PlannedLine` 扩展(向后兼容)

在现有字段上追加可选字段,老消费点不受影响:

```ts
export interface PlannedLine {
  lineId: InsuranceLineId;
  urgency: GapUrgency;
  tier: ProposalTier;
  gapTitles: string[];
  // 新增(可选,向后兼容)
  source?: 'finding' | 'relevance' | 'both';
  relevanceScore?: number;
  relevanceReasons?: string[];
}
```

`gapTitles` 语义不变(来自 findings,供 RAG query 与 rationaleDrivers);纯打分线 `gapTitles` 可为空,由 `relevanceReasons` 承载"为何推荐"。下游 `pipeline.ts` 的 RAG query 用 `lineName + gapTitles.join(' ')`,空 gapTitles 时退化为仅按 lineName 检索,可接受。

### 5.2 `planLines` 新签名

```ts
export function planLines(findings: GapFinding[], profile?: ProposalRequest['profile']): PlannedLine[];
```

`profile` 可选:不传则退回纯 findings 行为(老测试/老调用不回归)。`pipeline.ts:68` 改为 `planLines(req.diagnosis.findings, req.profile)`。

### 5.3 合并算法(确定性)

1. **findings 通道**:沿用现有逻辑,得到 `Map<lineId, {urgency, titles}>`。urgency 取该 lineId 命中的最紧迫 finding urgency;`mandatory`/`high` 只可能从这里来。标记 `source:'finding'`。
2. **打分通道**:`lineRelevance(profile)`,过滤 `score ≥ THRESH`,默认 `urgency='advice'`,标记 `source:'relevance'`,带 `relevanceScore`/`relevanceReasons`。
3. **合并去重**(按 lineId):
   - 两边都有 → `source:'both'`;urgency 取更紧迫者(`URGENCY_RANK` 小者胜,即 findings 若为 mandatory/high 则用之,**打分线不下拉、findings 线不被打分线降级**);gapTitles 用 findings 的;附上 relevanceScore/reasons。
   - 仅 findings → 保留原样,`source:'finding'`。
   - 仅打分 → `urgency='advice'`,gapTitles 空,`source:'relevance'`。
4. `tier` 一律由 `tierFor(lineId, finalUrgency)` 重算。

### 5.4 封顶(总量 ≤ 8)

```
MUST = 所有 urgency ∈ {mandatory, high} 的线      // 全进,不受 8 限制约束(强 findings 不砍)
REST = 其余(urgency = advice)
排序 REST:按 sortScore 降序;sortScore = relevanceScore ?? FINDING_ADVICE_DEFAULT(=2)
          // 使"findings 建议线"与"打分建议线"可同尺度排序,findings-advice 至少拿到阈值分
取 REST 前 (8 - MUST.length) 条(若 MUST 已 ≥8,REST 全丢,只留 MUST)
最终 = MUST ∪ 选中的 REST
排序输出:先按 URGENCY_RANK,再(同级)按 sortScore 降序,末尾按 lineId 稳定
```

`MAX_LINES = 8`、`THRESH = 2`、`FINDING_ADVICE_DEFAULT = 2` 作为文件内常量,便于测试与调参。

### 5.5 不回归保证

- 不传 `profile` 时,`planLines` 行为与今日逐字节一致(打分通道空)。
- 现有 `mapCoverageToLines` / `RULES` / `tierFor` 不动(Crime 的修法在采集器文案侧,不在此)。

---

## 6. 接口改动:`ProposalRequest.profile` 扩展

### 6.1 后端 `packages/agent/src/types.ts`

在 `ProposalRequest.profile` 追加**可选**结构化信号(全部 optional,向后兼容;label 字段保留不动):

```ts
profile: {
  industry?: string;            // 展示 label(保留)
  headcount?: string;           // 展示 label(保留)
  funding?: string;             // 展示 label(保留)
  hasPatent?: boolean;          // 保留
  overseasCountries?: string[]; // 保留(展示 + 现有 rationaleDrivers)
  // ── 新增:稳定结构化信号(打分用,不进 LLM 事实推断)──
  industryValue?: 'saas' | 'ai' | 'hardware' | 'fintech' | 'health' | 'ecom' | 'other';
  headcountValue?: string;      // 'lt10' | '10to30' | '31to100' | 'gt100'
  fundingValue?: string;        // 'none' | 'angel' | 'pre_a' | 'b_plus' | 'ipo'
  hasPhysicalProduct?: boolean; // b2 === 'yes'
  overseas?: boolean;           // b0 === 'yes'
  dataSensitive?: boolean;      // c1 === 'yes'
};
```

> headcountValue/fundingValue 用 string 宽松类型(与现有枚举取值一致即可),避免跨包硬耦合到采集器的字面量联合;`lineRelevance` 内部做序数映射,未知值落 0。

### 6.2 前端镜像 `src/proposal/types.ts`

同步在 `ProposalRequest.profile` 追加同名可选字段(纯声明镜像,保持前后端契约一致)。

### 6.3 组装 `src/proposal/buildRequest.ts`

`buildProposalRequest` 从原始 `answers` 追加填充(label 字段照旧):

```ts
profile: {
  industry, headcount: ..., funding: ..., hasPatent: ..., overseasCountries: ...,
  // 新增
  industryValue: answers.industry as ...,          // 直接透传枚举 value
  headcountValue: answers.headcount,
  fundingValue: answers.funding,
  hasPhysicalProduct: answers.b2 === 'yes',
  overseas: answers.b0 === 'yes',
  dataSensitive: answers.c1 === 'yes',
}
```

均为可选、缺省安全(未答 → undefined → 打分落 0),旧调用不受影响。

### 6.4 采集器 `src/config/startupProfileCollector.ts`

唯一改动:`fintech_base.coverage` 去掉 `+ 犯罪保障(Crime)`(§2.3),`desc` 与其它逻辑不动。

---

## 7. 测试计划(`packages/agent/tests/`,vitest)

新增 `lineRelevance.test.ts` + 扩充 `lineMapping.test.ts`。

### 7.1 `lineRelevance` 多画像

- **死库存可达**(核心目标验证):
  - hardware 画像 → `environmental` score≥2、`cargo`≥2、`product_liability`≥3、`public_liability`≥3 均在结果内。
  - overseas && hasPhysicalProduct 画像 → `cargo`≥3、`credit_surety`≥2、`product_liability` 命中。
  - ecom 画像 → `credit_surety`≥2、`public_liability`≥3、`cargo` 命中。
- **fintech 不引用 crime**:fintech 画像 → 结果含 `tech_eo`、`cyber`,且 Map 的 key 集合 ⊆ 12 合法 lineId(无 crime/未知 key)。
- **基线与加权**:employer_liability 随 hc 单调递增(lt10 < gt100);group_accident 在 hc<2 时不出、hc≥2 出;directors_officers 随 fund 增(pre_a<ipo);ip 在 hasPatent 时命中。
- **缺省安全**:空 profile → 返回空 Map 或全 <阈值(不抛错)。

### 7.2 `planLines` 合并 / 去重 / 封顶

- **合并去重**:同一 lineId 既是 finding(high)又被打分命中 → 只出一条,urgency=high(不被 advice 降级),`source:'both'`。
- **不降级**:finding mandatory 的线,打分同命中,最终 urgency 仍 mandatory。
- **打分补线**:纯 hardware 画像 + 空/无关 findings → 输出含 environmental/cargo(证明打分通道独立补线)。
- **封顶 ≤8**:构造 > 8 候选(多条 advice)→ 断言 `result.length ≤ 8` 且所有 mandatory/high 保留、advice 按分数截断。
- **老缺口线不回归**:不传 profile 调用 `planLines(findings)` → 与当前输出等价(沿用现有 3 个 planLines 用例断言)。

### 7.3 端到端小样(可选)

用 `buildProposalRequest` 造 hardware+overseas 的 request,断言 `planLines(req.diagnosis.findings, req.profile)` 里出现至少一个原死库存险种。

---

## 8. 合规注记(红线自查)

1. **险种筛选全程确定性**:`lineRelevance` 与 `planLines` 均为纯函数 + 序数/布尔判断,零 LLM、零网络。
2. **价格不进筛选、不进 LLM**:打分只读 profile 的行业/人数/融资阶段/布尔信号,**不读任何价格字段**;价格仍在 pipeline §5(`computePricing`/`buildPricing`)确定性组装,与筛选解耦。
3. **无成交暗示**:打分线默认 `advice`,不新增 mandatory;强制型仍仅 COI 合同强制与 IPO 董责两类(采集器不动)。
4. **Crime 修复不新增悬空**:移除 crime 悬空引用后,fintech 由已存在的 tech_eo/cyber 补齐,报告"说到的都给得出"。
5. **无 PII**:新增 profile 字段全是脱敏枚举/布尔,无姓名/电话/微信。

---

## 9. 自检命令(不启任何服务)

```
npx tsc --noEmit -p packages/agent          # agent 包类型
npx tsc --noEmit                            # web 根(buildRequest / types 镜像改动)
npx vitest run packages/agent/tests/lineRelevance.test.ts packages/agent/tests/lineMapping.test.ts
```

## 10. 改动文件清单

| 文件 | 改动 |
|---|---|
| `packages/agent/src/lineRelevance.ts` | 新增:`lineRelevance` 打分纯函数 + 打分表 |
| `packages/agent/src/lineMapping.ts` | `planLines` 加 `profile` 参数;合并/去重/封顶;`PlannedLine` 扩字段 |
| `packages/agent/src/types.ts` | `ProposalRequest.profile` 加结构化信号(可选) |
| `packages/agent/src/pipeline.ts` | 第 68 行改 `planLines(req.diagnosis.findings, req.profile)` |
| `src/proposal/types.ts` | 前端 `ProposalRequest.profile` 镜像加同名可选字段 |
| `src/proposal/buildRequest.ts` | 从 answers 填新结构化信号 |
| `src/config/startupProfileCollector.ts` | `fintech_base.coverage` 移除 `+ 犯罪保障(Crime)` |
| `packages/agent/tests/lineRelevance.test.ts` | 新增单测 |
| `packages/agent/tests/lineMapping.test.ts` | 扩充合并/封顶/不回归用例 |

> 本 PR 只改文件、跑校验;**不执行任何 git 命令**,统一由主进程提交。
