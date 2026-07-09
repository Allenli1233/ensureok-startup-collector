# 保障方案子系统 · 设计增补 v3.1（对抗评审修订版）—— 两库分工 + 推荐产品与价位 + 保司下钻

> 状态：定稿（无 TODO，所有决策均已定死）。本版为 v3 经对抗评审后的修订：把评审确认的有效风险应对写进对应章节（价位护栏、价格测算边界、幻觉溯源、COI 兜底、两套声明边界）。文末附「评审已处理的风险清单」。
> 性质：对 **PR1 设计文档**的**增量修订**。本文只写「新增什么 / 覆盖什么 / 为什么 / 怎么落地」，不复制 PR1 全文。凡本文未提及的 PR1 条款一律继续生效。
> 数据基准时间：2026-07-09（12 份产品数据当日采集）。

---

## 1. 概述（需求变更点）

### 1.1 一句话复述本次变更
PR1 的默认合规立场偏保守（只讲风险方向、不点名保司/不报价位）。本次用户**主动放开**：最终方案要**直接展示「推荐产品 + 参考价位」，并支持「下钻」查看哪些保司有相关产品、以及价格表/职业分级/选购建议等明细**。为支撑这一点，数据层从「单一 RAG」升级为「RAG 语义库 + 结构化产品知识库」两层，并明确三个数据源的分工。

### 1.2 具体变更点清单（相对 PR1）

| 编号 | 变更点 | 相对 PR1 的性质 |
|---|---|---|
| C1 | 引入**结构化产品知识库**（12 份「XX产品数据.md」）作为「产品 + 价位」的唯一权威源 | 新增数据层 |
| C2 | 明确**三数据源分工**：保险资料/=RAG、保险产品数据库/=结构化库、公司保险/=忽略 | 新增约定 |
| C3 | Agent 推荐管道新增「产品选取 + 价位测算 + 护栏套写」三步 | 修订 §Agent 管道 |
| C4 | Proposal/ProposalItem 契约**新增** `recommendedProducts / pricing / drilldown` 三组字段，且**价位与依据分字段分来源标记** | 扩展契约 |
| C5 | 前端**新增下钻 UX**（保司清单 / 价格表 / 职业分级 / 选购建议）与打印/导出适配 | 新增前端能力 |
| C6 | 合规默认从「不点名不报价」放开为「可展示产品/保司/价位 + 强制价位护栏」 | **覆盖** PR1 保守默认 |
| C7 | 产品库**按险种结构化直接加载**，不进 embedding；RAG **只对保险资料建** embedding | 覆盖 PR1「全部资料统一 RAG」的隐含假设 |

### 1.3 不变的部分（继续沿用 PR1）
monorepo 结构（`apps/web` + `apps/server` + `packages/{shared,rag}`）、异步任务 API 形态、服务端合规强制层、`LlmProvider`/`Retriever` 适配层、G1/G2/G3 三道质量门——**均不推翻**，本文只在其上增补。

---

## 2. 三数据源分工定义

三个物理目录，职责互斥，边界定死：

| 数据源（绝对路径） | 角色 | 负责回答 | 加载方式 | 在方案里的地位 |
|---|---|---|---|---|
| `C:/Users/liwen/desktop/projects/保险资料/`（含 `保险产品/` 条款PDF·法规·案例·实务、`选购指南/` 方法论·深度解读） | **RAG 语义检索库** | 「为什么这么配、条款里写了什么、赔不赔、怎么选」——需要推理与原文依据 | **只对本库建 embedding**，语义检索 | 提供 `rationale / clauseNotes / cases` 等**依据**字段 |
| `C:/Users/liwen/desktop/projects/保险产品数据库/`（12 险种，每份「XX产品数据.md」+ `16-推荐引擎规则库/`） | **结构化产品知识库** | 「买谁家、多少钱、保多少」——确定性事实 | **按险种直接结构化加载/解析**，不 embedding | 提供 `recommendedProducts / pricing / drilldown` 等**产品与价位**字段，且为其**唯一权威源** |
| `C:/Users/liwen/desktop/projects/公司保险/` | **忽略** | —— | 不加载、不索引、不引用 | 旧子集，任何管道均不得读取 |

**权威口诀（写入工程规范，强制执行）：**
> 价格只信产品库，条款只信 RAG 条款PDF；数字冲突时产品库赢，方法论冲突时 RAG 赢；RAG 负责「讲道理」，产品库负责「报数字」。

**RAG 独占价值（产品库无法替代的 5 类，防止「有了产品库就砍 RAG」的误判）：**
1. 条款要点原文（保障责任清单，如「雇主险保不保上下班途中」）；
2. 责任免除 / 除外责任（产品库结构里根本没有这一层）；
3. 司法案例 / 理赔实务（说服力与风险实感）；
4. 选购方法论（风险自评、配置流程、保额计算公式、checklist——是「过程」，产品库的选购建议是「结果」）；
5. 险种配置组合逻辑（三件套为什么这么配、哪些重叠该砍、哪些缺口该补）。

---

## 3. 两层数据架构（RAG + 结构化产品库）

### 3.1 架构总图（逻辑分层）

```
                ┌─────────────────────────────────────────────┐
   客户画像 ──▶ │  Agent 推荐管道（apps/server）                │
                │                                              │
                │  ① 规则库(R001–R029) 算应推 lineId 列表       │
                │        │                                     │
                │        ├──▶ [结构化产品库]  取产品+价格行 ──┐ │
                │        │     packages/catalog(新增)         │ │
                │        │     确定性查表·可回溯·不可编       │ │
                │        │                                    ▼ │
                │        └──▶ [RAG 语义库]    取依据/条款/案例  │
                │              packages/rag                    │
                │              embedding·语义召回              │
                │                     │                        │
                │                     ▼                        │
                │           Proposal 组装层（分字段·分来源标记）│
                └─────────────────────────────────────────────┘
```

### 3.2 为什么产品库不进 embedding（四条定死理由）
1. **规模小**：12 份、每份约 60–130 行、纯结构化 Markdown 表格，解析成 JSON 后仅几十 KB，可全量常驻内存，无需向量召回。
2. **价格必须精确、可回溯、不能被「编」**：embedding 会把表格切碎，数字与其维度（哪个保司/哪档保额/哪类职业）易错配或被幻觉。价位要求确定性查表。
3. **下钻是确定性取数**：`lineId → InsurerProduct[] → PriceRow[]` 结构化过滤即可，embedding 做不到精确下钻。
4. **推荐已有结构化规则库**：`16-推荐引擎规则库/03-产品映射规则表.md`（R001–R029 IF-THEN）天然配结构化库。

### 3.3 两库字段级重叠的去重规则（核心工程约束）
**已核实的冲突根源**：RAG 的 `选购指南/05-深度解读/` 里**也含**「保费参考区间/建议保额/分行业费率排序/费率结构」，与产品库物理重叠。若不设规则，Agent 会从两处拿到不一致的数字。

**解决：字段级唯一权威源路由（硬规则，检索层按字段路由，不靠模型临场判断）**

| 信息类型 | 唯一权威源 | 另一库处理 |
|---|---|---|
| 具体产品名、保司清单 | **产品库** | RAG 不得列举「XX保司有XX产品」 |
| 保额→保费价格表、年保费数字 | **产品库** | RAG 的「保费参考区间」仅供 Agent 内部推理量级，**不得写进方案价位** |
| 分行业费率、职业类别分级 | **产品库** | RAG 的费率排序只作「哪个行业风险更高」的定性判断，不出具体费率 |
| 按规模的推荐配置/预算 | **产品库**（结果） | RAG 提供推导逻辑，不覆盖最终数字 |
| 条款保障责任、除外责任原文 | **RAG（条款PDF/深度解读）** | 产品库不展开，只在下钻里链接指向 |
| 法规依据、司法案例、理赔流程 | **RAG** | 产品库无此内容 |
| 险种定义、选购方法论、组合逻辑 | **RAG** | 产品库无此内容 |

**三条落地实现约束：**
1. **Retriever「险种感知」召回，且给数字段落打 `type: pricing_hint` 标签**：Agent 可读它做推理，但 **Proposal 组装层禁止把 `pricing_hint` 内容写入价位字段**；价位字段只接受产品库解析器的值。
2. **Proposal 契约里价位与依据分字段、分来源**：`price` → `source=product_db`（带保司+采集时间+行级锚点）；`rationale/clauseNotes/cases` → `source=rag`（带文件出处）。
3. **冲突/缺口判定复用 `16-推荐引擎规则库/07-产品冲突重叠检测表`（确定性）**：判定用规则库，叙述用 RAG。

**（评审新增）pricing_hint 打标不完备的兜底——防止价格从依据文案泄漏：**
`pricing_hint` 标签依赖 Retriever 正确识别所有带数字段落，但**标漏在所难免**。若某个含保费数字的 RAG 段落未被打标，它仍可能作为 `rationale` 正文进入方案，绕过价位字段直接把价格「说」出来。故增设**第二道正交防线（不依赖打标）**：Proposal 组装层与 G2 对所有 `source=rag` 的文本（`rationale/clauseNotes/cases`）执行**保费金额形态扫描**——正则匹配「`¥`/`元`/`万元`/`人均…费` + 数字」等保费措辞，命中即视为疑似价格泄漏，**剥离该数字表述或整段拒绝**，不进方案。依据文案只允许出现「量级/高低」定性词，具体保费金额一律只能来自产品库价位字段。

---

## 4. 产品知识库解析层与数据模型

### 4.1 关键事实：12 份是「家族相似」而非「严格同构」
共有骨架一致，但**价格表维度每个险种不同**（职业/场所/市值/规模/行业/类目/运输方式），不能强套一张统一价格表——数据模型必须把「价格行」设计成**多维可空**结构。

各险种价格表结构盘点（定死）：

| # | 险种 | lineId | 每份保司数 | 价格表形态 |
|---|---|---|:--:|---|
| 01 | 雇主责任险 | `employer_liability` | 6 | ✅ 5 家「职业×保额」矩阵（A 级最全） |
| 02 | 产品责任险 | `product_liability` | 6 | ⚠️ 仅分类目费率+公式（逐单核保，行业常态） |
| 03 | 公众责任险 | `public_liability` | 5 | ✅ 场所类型→保额→年保费 |
| 04 | 团体意外险 | `group_accident` | 5 | ✅ 三档方案→保额→人均年费 |
| 05 | 董责险 D&O | `directors_officers` | 5 | ✅ 市值→保额→年保费 |
| 06 | 网络安全险 | `cyber` | 5 | ✅ 规模→保额→年保费 |
| 07 | 知识产权保险 | `ip` | 4 | ⚠️ 仅保额+费率区间 |
| 08 | Tech E&O | `tech_eo` | 3 | ⚠️ 仅规模→保额→年保费区间 |
| 09 | AI 服务责任险 | `ai_liability` | 0 | ❌ **无价格表**（市场极早期，纯设计建议） |
| 10 | 货物运输险 | `cargo` | 3 | ⚠️ 分险种/运输方式/类目费率 |
| 11 | 信用保证保险 | `credit_surety` | 2 | ⚠️ 仅费率区间 |
| 12 | 环境污染责任险 | `environmental` | 3 | ✅ 行业→费率→保额→年保费 |

### 4.2 TypeScript 数据模型（`packages/catalog` 落地，定死）

```typescript
/** 险种枚举(与目录 01–12 一一对应) */
export type InsuranceLineId =
  | 'employer_liability'  | 'product_liability' | 'public_liability'
  | 'group_accident'      | 'directors_officers'| 'cyber'
  | 'ip'                  | 'tech_eo'           | 'ai_liability'
  | 'cargo'               | 'credit_surety'     | 'environmental';

/** 数据可信度(来自审计报告 A/B/C) */
export type DataGrade = 'A' | 'B' | 'C';

/** 顶层:一个险种一份 = 一个 ProductCatalog(整份加载) */
export interface ProductCatalog {
  lineId: InsuranceLineId;
  lineName: string;               // "雇主责任险"
  sourcePath: string;             // 绝对路径,供下钻回溯
  meta: CatalogMeta;
  overview: Overview;
  insurers: InsurerProduct[];     // 各保司产品(含价格表)
  industryRates?: IndustryRate[]; // 分行业/类目/运输方式费率(可空)
  advice: PurchaseAdvice[];       // 选购建议(按规模)
  addons?: Addon[];
  hasPriceTable: boolean;         // AI=false,兜底判断
}

export interface CatalogMeta {
  collectedAt: string;            // "2026-07-09"
  sources: string[];              // ["官网","沃保网",...]
  applicableScenario: string;
  overallGrade: DataGrade;        // 险种整体可信度(审计聚合)
}

export interface Overview {
  legalBasis?: string;
  coverageTarget?: string;
  coverageScope?: string;
  marketSize?: string;            // "约1,032亿元(+9.7%)"
  concentrationCR?: string;       // "CR3 约60.6%"
}

export interface InsurerProduct {
  insurer: string;                // "中国人保财险"
  productName: string;            // "雇主责任险(全国版)"
  isForeign?: boolean;            // 外资多无公开报价
  grade: DataGrade;
  highlights?: string;
  priceRows: PriceRow[];          // AI/外资可能为空
  suggestedCoverage?: string;
}

/** 统一价格行——可空多维,吸收 12 险种不同价格结构 */
export interface PriceRow {
  rowKey: string;                 // (评审新增)行级稳定锚点,供溯源与实存校验
  // 维度键(按险种选填)
  coverageAmount?: string;        // "50万"/"$200万"/"累计500万"
  occupationClass?: string;       // "1-2类"/"5-6类+高空"(雇主)
  venueType?: string;             // "零售商场(5,000㎡)"(公众)
  companyScale?: string;          // "中型SaaS(500-3,000万)"(网安/E&O)
  marketCap?: string;             // "市值50-300亿"(董责)
  industry?: string;              // "化工(高)"/"电子产品"(环境/产品/货运)
  transportMode?: string;         // "海运(一切险)"(货运)
  planTier?: string;              // "基础型/标准型/增强型"(团意)
  // 价格值(按可得性选填)
  currency?: 'CNY' | 'USD';       // (评审新增)显式币种,禁跨币种合并/比较
  annualPremium?: string;         // "366元"/"¥20-80万"
  monthlyPremium?: string;        // 月缴(雇主太保有)
  rate?: string;                  // "0.05%-0.5%"/"保额的2%-5%"
  premiumExample?: string;        // "¥30,000-80,000(年销1,000万)"
  isRange: boolean;               // true=区间/估算(B/C),false=精确(A)
}

/** 分行业/类目/运输方式基准费率(独立于保司) */
export interface IndustryRate {
  dimension: string;              // "行业"/"产品类目"/"运输方式"
  category: string;               // "建筑业/重工"
  rate: string;                   // "1.2%-2.3%"
  note?: string;
}

/** 选购建议(按规模) */
export interface PurchaseAdvice {
  companyProfile: string;         // "初创/小型(<30人)"
  suggestedCoverage: string;      // "30-50万/人"
  annualBudget: string;           // "¥4,500-15,000"
  recommendedProduct?: string;    // 优选产品(来自规则库 R001…)
  note?: string;
}

export interface Addon {
  name: string;
  description?: string;
  importance?: 'high' | 'medium' | 'low';
  scenario?: string;
}
```

### 4.3 解析器落地方案（构建期解析，定死）
- **位置**：新增 `packages/catalog`（与 `packages/rag` 并列）。
- **解析锚点**：头部引用块与脚注用正则抓 `采集时间/数据来源/适用场景/查询时间`；「产品概述」是稳定两列表→键值映射到 `Overview`；价格表用 GFM 表格解析器（`remark` + `mdast`）读 header 行**判断维度并路由**：表头含「职业类别」→ 雇主矩阵、含「场所类型」→ 公众、含「市值」→ 董责，依此填对应 `PriceRow` 维度。每行解析时生成稳定 `rowKey`（`lineId#insurer#维度签名`）以供 §5.3 实存校验回指。
- **join 富化**：`InsurerProduct.grade` 从 `15-综合报告/数据质量审计报告.md` 按「险种+保司」回填；`isRange = (grade !== 'A')`；`advice.recommendedProduct` 从 `16-推荐引擎规则库/03-产品映射规则表.md` join。
- **产物**：构建/启动时把 12 份解析成 `ProductCatalog[]` JSON，按 `lineId` 建索引，全量常驻。

### 4.4 覆盖对照与三处兜底（定死）
**库 12 险种 vs 采集器诊断 10 险种：** 库比诊断多出 **10 货运 / 11 信用保证 / 12 环境污染**；诊断里的 **COI 库中无专属文件**——COI 本质是「保险凭证」而非险种，散见于产品责任险 R006 与 Tech E&O 第六节。

三处兜底策略（工程强制）：
1. **AI 险（`hasPriceTable=false`）**：不出任何价位，方案里提示「中国市场几乎无独立标准化 AI 责任险，建议用 Tech E&O / 产品责任险条款扩展覆盖」。留白态仍须挂精简护栏（见 §8.2）。
2. **C 级 / 外资无价产品**（Chubb 出口 CGL、安盛天平/平安/中华联合产品险、大地公众险）：只列「该保司有此产品」，价位留白，引导经纪报价。属行业常态，**不报「覆盖缺失」**。

3. **COI 兜底（评审重写——修补触发漏检、宿主线缺失、承保保司缺失三个断点）**：
   COI 做同义归一 `COI → {product_liability, tech_eo}` 的**附加交付项**，不当独立产品；仅出现在下钻/操作提示里，**不进「推荐产品价位」主表**。三条硬约束：
   - **触发信号显式化 + 存疑即触发**：画像必须承载 `hasOverseasB2B` / `crossBorderSales` 布尔位，由 R006（跨境电商平台销售）或「有海外 B2B 合同」映射填充。**该信号缺失或不确定时，采取保守侧——仍输出 COI 操作提示**（宁可多提示一次流程，不可静默漏掉合规凭证需求）。
   - **宿主线缺失时不丢，降级挂载**：COI 提示优先挂在**实际已推荐且承保确定**的 `product_liability` / `tech_eo`；若这两条均未入选，则挂到与该海外义务最相关的已推荐险种（如为海外活动配置的公众险）；若**无任何合适宿主线**，降级为 **proposal 级操作提示**（不依附任何 item），确保永不丢失。
   - **承保保司需真实存在**：提示文案「向承保保司申请出具 COI，并将平台/客户列为附加被保险人（Additional Insured）」中的「承保保司」须引用该线**实际优选的保司**；若该线为留白 / 外资无价 / 无 concrete 保司，措辞改为「**需与最终承保保司确认出具 COI**」，不虚指某家。
   - **COI 提示自带来源**：文本标注出处（R006 / Tech E&O 第六节），纳入溯源体系。

---

## 5. Agent 推荐管道修订（产品 + 价位测算 + 护栏）

### 5.1 修订后的管道步骤（在 PR1 管道中插入 P3a/P3b/P3c）

```
P1  画像归一          （PR1 原样,补 hasOverseasB2B/crossBorderSales 归一）
P2  RAG 召回依据      （PR1，但 Retriever 改为「险种感知」+ pricing_hint 打标）
P3  规则库决策        （PR1，用 R001–R029 得出应推 lineId 列表 + 建议保额档）
─── 以下为本次新增 ───
P3a 产品选取          从 ProductCatalog[lineId] 取 InsurerProduct[]，
                      按 advice.recommendedProduct + grade 排序优选
P3b 价位测算          按画像维度(规模/职业/市值/行业/场所/运输方式)在
                      priceRows 里确定性匹配 → 判定 matchTier(见 5.2)，
                      分级取值/就近档/回落预算/留白，禁插值禁外推
P3c 护栏套写          纯代码模板拼接 display + 强制套写护栏文案 + 按
                      A/B/C 与 matchTier 决定精确值/区间/留白;
                      **P3c 不调用 LLM 生成任何数字**(见 5.3 溯源)
─── 回到 PR1 ───
P4  Proposal 组装     价位与依据分字段分来源(见 §6)
P5  G1/G2/G3 三门     G2 增补「价位来源校验 + 回表实存校验」(见 5.3)
```

### 5.2 价位测算规则（确定性 + 边界，评审强化）
- **匹配维度由 lineId 决定**：雇主→`occupationClass × coverageAmount`；公众→`venueType × coverageAmount`；董责→`marketCap × coverageAmount`；网安/TechE&O→`companyScale × coverageAmount`；团意→`planTier × coverageAmount`；环境/产品/货运→`industry`(+`transportMode`)×费率。

- **四级匹配结果 `matchTier`（评审新增——把「未命中→回落」这个模糊语义拆成可判定的分级，杜绝静默造数）**：

  | matchTier | 触发条件 | 展示与标注 | insurer 字段 |
  |---|---|---|---|
  | `exact` | **全维精确命中** 某 priceRow，且该行 grade=A | 展示精确价（`isRange=false`） | 必填（命中行的保司） |
  | `bracket` | 命中**相邻档**（画像值落在某档标签覆盖内，或就近档），或 B 级 | 展示区间/就近档值，标「参考价 · 就近档」（`isRange=true`） | 必填 |
  | `budget` | 无 priceRow 可命中，仅能回落到 `advice.annualBudget` | 展示按规模预算，标「**按规模预算估算，非某保司报价**」 | **置空**（不得冒充某保司精确价） |
  | `blank` | 画像**超出全部档位区间**、C 级、外资无价、或 `hasPriceTable=false` | 价位留白，引导持牌经纪报价 | 空 |

- **禁止插值 / 外推（边界铁律）**：画像值落在两档之间、或超出最大档 / 小于最小档，**一律不计算中间数、不外推端点**；只能标注就近档（→`bracket`）或留白（→`blank`）。**绝不生成价格表里不存在的数字。**
- **部分维度命中即降级**：如命中职业类别但未命中保额档，不得当 `exact`；按可得性降为 `bracket` 或 `budget`。
- **跨币种 / 跨单位不合并**：`currency` 不同的行（¥ 与 $，见货运/董责保额）**不相加、不比较、不折算**；`display` 原样透传单位与币种符号。
- **回落到 `advice.annualBudget` 的归属标注**：`budget` 级必须在 `matchedDimensions` 写入 `_estimateBasis: 'budget_by_scale'`，且 `insurer` 置空，防止把「按规模预算」误呈现为「某保司对该画像的精确报价」。
- **数字只来自产品库**：RAG 的 `pricing_hint` 只允许影响「量级判断/该不该配」，**绝不写入 `pricing` 字段**。
- **时效语义**：费率按年调整、实际保费随核保浮动（雇主险出险 ±15%–25%、网安险安全评估 ±5%–15%），故展示价位在语义上只是「某时点参考区间」，非成交价——由护栏文案固化这一点。

### 5.3 G2 质量门增补子规则（价位来源校验 + 回表实存校验，评审强化幻觉防线）
G2 不再只信「来源标签」，改为**标签校验 + 回表实存校验**双层（因为 buggy/被篡改的组装层可能给幻觉数字盖上 `source=product_db` 章）：

1. **来源标签校验**：每个 `pricing` 项 `source === 'product_db'` 且带 `insurer`（`exact/bracket` 级必填）+ `collectedAt`；来源为 `rag` 或缺来源 → **拒绝**，管道回退。
2. **（评审新增）回表实存校验（反幻觉核心）**：`PricingBlock.display` 内出现的每个数字子串，必须能在对应 `ProductCatalog` 的某个 `priceRow` 字段里**精确字符串匹配**到（凭 `rowRef.rowKey` 回指原始行）；`budget` 级则须精确等于 `advice.annualBudget` 且 `matchTier='budget'`。**匹配不到 = 疑似幻觉/篡改 → 拒绝回退。** 这保证每一位展示数字都能回指一行真实产品数据，而非 LLM 生成。
3. **（评审新增）依据文案价格泄漏扫描**：对 `rationale/clauseNotes/cases`（RAG 文本）扫描保费金额形态（`¥\d`/`\d+元`/`\d+万元`/`人均…费` 等 + 语境），命中 → 剥离或拒绝（与 §3.3 第二道防线一致）。
4. **模板化校验**：要求 `display` 为 P3c 纯代码拼接产物、携带 `rowRef`（`sourcePath` + `rowKey`）；无 `rowRef` 或来源不可回指 → 拒绝。
5. **兜底一致性校验**：`hasPriceTable=false` 的险种没有产出任何 `pricing` 值；C 级 / 外资无价产品未产出精确数字（`matchTier` 只能是 `blank`）。
6. **护栏存在性校验**：每个 `PricingBlock`（**含 `blank` 留白态**）必带护栏串（§8.2）；缺失 → 拒绝。

---

## 6. Proposal 契约扩展（推荐产品 / 价位 / 下钻）

在 PR1 的 `Proposal` / `ProposalItem` 上**新增字段**（不改动 PR1 既有字段）：

```typescript
// —— ProposalItem 扩展 ——（一个 item 对应一个推荐险种 lineId）
export interface ProposalItem {
  // …… PR1 既有字段（riskDirection、coverageIntent 等）保持不变 ……

  lineId: InsuranceLineId;                 // 新增:该条对应险种

  recommendedProducts: RecommendedProduct[]; // 新增:推荐产品(源=product_db)
  pricing: PricingBlock;                     // 新增:价位(源=product_db)
  drilldown: DrilldownRef;                   // 新增:下钻取数指针

  // 依据类字段一律 source=rag,与价位物理分区
  rationale?: SourcedText;                  // 为什么这么配
  clauseNotes?: SourcedText[];              // 条款要点/免责(链接指向,不展开正文)
  cases?: SourcedText[];                    // 司法案例/理赔实务
}

export interface RecommendedProduct {
  insurer: string;
  productName: string;
  grade: DataGrade;
  isPreferred: boolean;                     // 来自规则库优选
  source: 'product_db';
  sourcePath: string;                       // 回溯到具体 .md(建议带 section 锚点)
}

export interface PricingBlock {
  display: string;                          // 展示串(P3c 纯代码模板化,非LLM生成)
  matchTier: 'exact' | 'bracket' | 'budget' | 'blank'; // (评审新增)匹配级别
  isRange: boolean;
  grade: DataGrade;                         // 决定精确值/区间/留白
  currency?: 'CNY' | 'USD';                 // (评审新增)禁跨币种合并
  matchedDimensions: Record<string, string>;// 命中维度;budget级含 _estimateBasis
  insurer?: string;                         // exact/bracket 必填;budget/blank 置空
  source: 'product_db';
  rowRef?: { sourcePath: string; rowKey: string }; // (评审新增)行级溯源锚点,供G2回表实存校验
  collectedAt: string;                      // "2026-07-09"
  disclaimer: string;                       // 强制护栏文案(见 §8,日期由collectedAt模板化)
  unavailableReason?: 'ai_no_table' | 'foreign_no_quote' | 'grade_c' | 'out_of_range';// 留白时填
}

export interface DrilldownRef {
  lineId: InsuranceLineId;                  // 前端按此拉 ProductCatalog
  // 下钻内容 = 该 catalog 的 insurers[](保司清单)、priceRows[](价格表)、
  //           职业分级、advice[](选购建议);COI 作为操作提示挂在此处
  coiHint?: string;                         // 命中 R006/海外B2B 时的 COI 出具提示
}

export interface SourcedText {
  text: string;
  source: 'rag';
  sourcePath: string;                       // RAG 文件出处
}

// —— Proposal 级(评审新增)——承载无宿主线时的 COI 提示与文档命名判定
export interface Proposal {
  // …… PR1 既有字段保持不变 ……
  items: ProposalItem[];
  proposalLevelCoiHint?: string;            // 无合适宿主线时的 COI 降级挂载(§4.4)
  documentName: '保障方案建议' | '风险保障方向说明'; // 由 §8.4 判定规则确定
}
```

**契约铁律**：`pricing` / `recommendedProducts` 的 `source` 恒为 `product_db`；`rationale` / `clauseNotes` / `cases` 的 `source` 恒为 `rag`。组装层拒绝跨源写入。`pricing.display` 必须可凭 `rowRef` 或 `_estimateBasis` 回指真实数据行（无则 G2 拦截）。

---

## 7. 前端下钻 UX 与打印

### 7.1 主视图（默认展开）
每个 `ProposalItem` 渲染为一张「险种卡」：
- 标题：险种名 + 风险方向说明；
- **推荐产品行**：优选产品（保司 + 产品名 + 数据可信度徽标 A/B/C），最多展示 3 家；
- **价位行**：`pricing.display`，紧随其后**固定内联**护栏小字（§8）；`budget` 级标「按规模预算估算」；`blank`（C 级 / 无表 / 超档）显示「价位待经纪报价」灰态并仍带精简护栏；
- 「查看明细 ▸」下钻入口。

### 7.2 下钻抽屉（点击展开，按 `DrilldownRef.lineId` 拉 `ProductCatalog`）
分四个物理分区（价格与条款不混）：
1. **哪些保司有相关产品**：`insurers[]` 全列（含外资无价者，标「不公开报价」）；
2. **价格表**：`priceRows[]` 按险种维度渲染成矩阵（雇主=职业×保额、董责=市值×保额…）；A 级标「精确」、B 级标「参考价」；跨币种行分区展示、不并列相加；
3. **职业分级 / 分行业费率**：`industryRates[]`；
4. **选购建议**：`advice[]`（按规模的建议保额 + 年预算 + 优选产品）。
- **条款/免责/案例**分区单独一栏，来自 RAG，仅显示要点 + 「查看原文」链接（指向条款PDF），**不在此处展开数字**。
- **COI 提示**：若 `drilldown.coiHint` 非空，作为「操作提示」卡片出现在本抽屉底部（出具流程 + 附加被保险人），**不进价格表**；若为 `proposalLevelCoiHint`（无宿主线），则在方案总览区顶部统一呈现一张 COI 操作提示卡。

### 7.3 打印 / 导出适配
- 打印时**下钻内容全部展开为附录**（抽屉→静态分节），保证纸质版信息完整；
- **每个价位就近内联护栏文案**（不只靠页脚）——保证**非分页导出（单页 HTML / 长 PDF / 富文本）**下每个数字旁都带护栏；分页格式**额外**在每页页脚重复价位护栏与采集时间；
- 导出文件名与文档标题按 §8.4 判定用「风险保障方向说明」或「保障方案建议」，**不叫「报价单 / 合同」**；
- 数据可信度徽标（A/B/C）在打印版转为脚注图例。

---

## 8. 合规重述与护栏

### 8.1 立场变更（覆盖 PR1 保守默认）
PR1 默认「不点名保司、不报价位」。**本次用户已决定放开**：方案**可展示产品 / 保司 / 价位**。以下护栏为放开后的**强制补偿**，服务端合规层（PR1 已有）继续在**产出前强制校验**。

### 8.2 价位护栏（每个价位旁固定标注；评审：日期模板化 + 留白态也强制）
**精确/区间价位（`exact/bracket/budget`）护栏——文案固定、日期由 `collectedAt` 模板化（不写死字面量，防数据重采后日期与护栏串脱节）：**
> 参考区间 · 数据采集时间 {collectedAt} · 以保司实际报价为准 · 非成交报价，承保由合作持牌经纪机构完成。

**留白价位（`blank`）精简护栏——同样强制，不可省略：**
> 价位待持牌经纪报价 · 承保由合作持牌经纪机构完成。

- 展示粒度按 A/B/C 级与 `matchTier` 切换（精确值 / 区间+参考价 / 预算估算 / 留白引导经纪，见 §5.2）。
- **强制性由 G2 保证**：每个 `PricingBlock`（含留白）缺护栏即拦截回退（§5.3-6）。

### 8.3 其余护栏（保留 PR1，继续强制）
- **禁止招揽 CTA**：不出现「立即投保 / 立即购买」等按钮或文案；
- **对外命名**：产物统一「风险保障方向说明 / 保障方案建议」（二选一判定见 §8.4），禁用「报价单 / 合同 / 保单」；
- **来源可追溯**：价位必带保司 + 采集时间 + `rowRef`（行级）；条款/案例必带 RAG 文件出处；
- **不编价格**：RAG 的 `pricing_hint` 严禁进入展示价位（由 G2 拦截），依据文案的保费金额亦被扫描剥离（§3.3、§5.3-3）；
- **兜底不误导**：AI 险不报价、外资无价只列存在、COI 不单列（§4.4）。

### 8.4 两套声明的边界（评审新增——两个对外名称与两层声明的作用域定死）

**（A）两个文档命名的适用判定（硬规则，写入组装层，`Proposal.documentName` 据此赋值）**
「风险保障方向说明」与「保障方案建议」是**两种合规姿态、不可混用**，判定标准为**方案是否含至少一个 concrete 已定价产品**：

| 判定条件 | 文档命名 | 理由 |
|---|---|---|
| proposal 中**至少一个** item 的 `matchTier ∈ {exact, bracket}`（有 concrete 保司 + 具体价位/就近档） | **「保障方案建议」** | 已展示实质产品与价位，用「方向说明」会**低报（under-claim）**、与内容不符 |
| proposal **全部** item 为 `budget / blank`（无任何 concrete 保司精确/就近档价位，如全 AI 无表 / 全 C 级留白） | **「风险保障方向说明」** | 无实质价位可承诺，若强称「方案建议」会**过报（over-claim）** 逼近「报价单」语义 |

- 两种命名**都禁用**「报价单 / 合同 / 保单」等词；**两种命名的文档都必带**文档级合规声明（下条 B）。
- 命名与内容必须自洽：含价位的文档不得叫「方向说明」，纯留白的文档不得叫「方案建议」。

**（B）两层声明作用域不重叠（各司其职，互不替代，均强制）**

| 声明层 | 出现位置 | 作用域 / 说什么 |
|---|---|---|
| **文档级合规声明** | 文首 1 处 + 每页页脚 | 讲**整份文档的性质与承保主体**：本文为「风险保障方向说明/保障方案建议」，非报价单/合同/保单；承保由合作持牌经纪机构完成；不构成投保要约 |
| **价位级护栏** | **每个价位就近内联** | 讲**该具体数字的参考性与时点**：参考区间 · 采集时间 · 以保司实际报价为准 · 非成交（§8.2） |

- 两层**都必须存在**：文档级声明不能替代逐价位护栏（读者可能只截取某张险种卡），逐价位护栏也不能替代文档级性质声明（整份文档的法律定性只在文档级表达一次）。G2/合规层对两层分别校验存在性。

---

## 9. 对 PR1 各节的覆盖对照表

| PR1 章节 | 本增补动作 | 对应本文章节 |
|---|---|---|
| 数据架构（单层 RAG） | **覆盖**：升级为 RAG + 结构化产品库两层；产品库不 embedding | §3、§4 |
| 数据源约定 | **新增**：三源分工，`公司保险/` 明确忽略 | §2 |
| Retriever 适配层 | **修订**：改「险种感知」召回 + `pricing_hint` 打标 + 依据文案价格泄漏第二道防线 | §3.3、§5.1(P2) |
| Agent 推荐管道 | **修订**：插入 P3a 产品选取 / P3b 价位测算(四级匹配·禁外推) / P3c 护栏套写(纯模板) | §5 |
| `Proposal` / `ProposalItem` 契约 | **扩展**：新增 `recommendedProducts / pricing / drilldown` + 分源标记 + 行级 `rowRef` + `matchTier` + Proposal 级 COI/命名 | §6 |
| 服务端合规强制层 | **修订**：合规放开 + 价位护栏(含留白态)强制 + 两套声明边界判定 | §8 |
| G2 质量门 | **增补**：价位来源校验 + 回表实存校验(反幻觉) + 泄漏扫描 + 护栏存在性 | §5.3 |
| 前端方案视图 | **新增**：下钻 UX + 打印/导出(逐价位内联护栏)适配 | §7 |
| `LlmProvider` 适配层 | 不变 | —— |
| 异步任务 API / 任务形态 | 不变 | —— |
| monorepo 结构 | **增补**：新增 `packages/catalog` | §3.1、§4.3 |
| G1 / G3 质量门 | 不变 | —— |
| PR1 其余未列条款 | 不变，继续生效 | —— |

---

## 10. 更新后的分阶段计划（PR2–PR5 影响）

> 沿用 PR1 的 PR 分期编号，仅标注本增补带来的**新增/修订工作项**。均为定项，无 TODO。

### PR2 —— 数据层与解析（受影响最大）
- 新增 `packages/catalog`：实现 §4.2 数据模型（含 `rowKey / currency`）+ §4.3 解析器（remark/mdast 表格路由、正则抓元数据、生成行级锚点）。
- 构建期把 12 份 `产品数据.md` 解析成 `ProductCatalog[]` JSON，按 `lineId` 建索引并常驻。
- join `15-综合报告/数据质量审计报告.md` 回填 `grade`、join `16-推荐引擎规则库/03` 回填 `recommendedProduct`。
- RAG 侧（`packages/rag`）：**只对 `保险资料/` 建 embedding**；对 `选购指南/05-深度解读/` 的数字段落打 `type: pricing_hint` 标签。
- 交付判据：12 份全部解析通过；每 `priceRow` 有稳定 `rowKey`；AI 份 `hasPriceTable=false`；C 级/外资产品价位为空且可解释。

### PR3 —— Agent 管道与契约
- 修订 Retriever 为「险种感知」召回。
- 实现 P3a/P3b/P3c 三步（§5）与确定性价位测算（§5.2，四级 `matchTier`、禁插值外推、跨币种不合并、`budget` 归属标注）；**P3c 纯代码模板、不调 LLM 生成数字**。
- 扩展 `Proposal`/`ProposalItem` 契约（§6，含 `rowRef / matchTier / _estimateBasis / documentName / proposalLevelCoiHint`），组装层强制分源写入。
- 三处兜底（AI/外资/COI，§4.4）落地到组装层；COI 触发信号归一、宿主线降级挂载、承保保司真实性。
- 交付判据：产出的每个价位 `source=product_db` 且带保司+采集时间+`rowRef`；`pricing_hint` 不入价位字段；`budget` 级 insurer 置空且标估算。

### PR4 —— 合规层与质量门
- 合规强制层：放开产品/保司/价位展示 + 价位护栏文案（日期模板化，含留白态）强制注入（§8.2）+ 禁招揽 CTA/命名校验 + 两套声明边界判定（§8.4）。
- G2 增补：价位来源校验 + **回表实存校验（反幻觉）** + 依据文案价格泄漏扫描 + 护栏存在性校验（§5.3）。
- 交付判据：缺护栏/跨源价位/AI 险报价/C 级精确值/display 数字回表匹配失败/依据文案含保费金额/文档命名与内容不符 → 一律被 G2/合规层拦截回退。

### PR5 —— 前端下钻与打印
- 险种卡主视图 + 下钻抽屉四分区（保司清单/价格表/职业分级/选购建议，§7.2）。
- 条款/免责/案例分区（RAG 来源，仅要点+原文链接）。
- COI 操作提示卡（item 级条件渲染 + proposal 级降级卡）。
- 打印/导出：下钻展开为附录、**逐价位内联护栏**（覆盖非分页导出）、分页页脚重复护栏、按 §8.4 合规命名。
- 交付判据：屏显与打印版信息一致；价格分区与条款分区物理隔离；A/B/C 徽标正确；每个价位（含留白）旁均有护栏。

---

## 附录 · 评审已处理的风险清单

| # | 风险领域 | 评审发现的有效风险 | 本版应对 | 落地章节 |
|---|---|---|---|---|
| R1 | **价位护栏** | 护栏字符串把日期写死 `2026-07-09`，数据重采后护栏日期与 `collectedAt` 脱节 | 护栏日期改由 `collectedAt` 模板化注入，不写字面量 | §8.2 |
| R2 | **价位护栏** | 留白态（C 级/AI 无表/超档）不是「价位」，原护栏「每个价位旁」覆盖不到它 | 新增留白态精简护栏，G2 对含留白的每个 `PricingBlock` 校验护栏存在性 | §8.2、§5.3-6 |
| R3 | **价位护栏** | 只靠页脚重复护栏，在非分页导出（单页 HTML/长 PDF）与「只截一张险种卡」场景下护栏丢失 | 护栏改为**逐价位就近内联**，分页格式再额外页脚重复 | §7.3 |
| R4 | **价格测算边界** | 「未命中→回落 industryRates/annualBudget」是模糊静默回落，可能产出误导数字 | 拆成四级 `matchTier`（exact/bracket/budget/blank），每级展示与标注定死 | §5.2、§6 |
| R5 | **价格测算边界** | 画像值落两档之间或超出档位时可能被插值/外推，生成表中不存在的数字 | 明令**禁插值禁外推**，只能就近档标注或留白 | §5.2 |
| R6 | **价格测算边界** | 回落到 `advice.annualBudget` 时易被当成「某保司对该画像的精确报价」 | `budget` 级 `insurer` 置空 + `_estimateBasis` 标注 + 展示明标「按规模预算估算」 | §5.2、§6 |
| R7 | **价格测算边界** | ¥ 与 $ 跨币种价格行可能被并列/相加/比较 | `PriceRow.currency` 显式化，禁跨币种合并，`display` 原样透传单位 | §4.2、§5.2、§7.2 |
| R8 | **幻觉溯源** | G2 只校验 `source` 标签，buggy/篡改的组装层可给幻觉数字盖 `product_db` 章 | 增**回表实存校验**：display 每个数字须凭 `rowRef.rowKey` 在真实 priceRow 精确匹配到，否则拒绝 | §5.3-2、§6 |
| R9 | **幻觉溯源** | P3c「护栏套写」若由 LLM 格式化 display，可能篡改数字 | P3c 定为**纯代码模板拼接、不调 LLM 生成数字**；display 必带可回指 `rowRef` | §5.1(P3c)、§5.3-4 |
| R10 | **幻觉溯源** | `pricing_hint` 打标必有遗漏，未打标的含价数字段落可作 `rationale` 正文把价格「说」出来，绕过价位字段 | 增第二道正交防线：对所有 RAG 文本扫描保费金额形态，命中即剥离/拒绝 | §3.3、§5.3-3 |
| R11 | **幻觉溯源** | `sourcePath` 只到文件级，无法逐数字回溯 | 新增行级锚点 `rowKey` / `rowRef`，解析期生成、G2 回指 | §4.2、§4.3、§6 |
| R12 | **COI 兜底** | 「有海外 B2B 合同」如何从画像检出未定义，信号缺失则 COI 静默漏提 | 画像显式化 `hasOverseasB2B/crossBorderSales`；**存疑即保守触发** | §4.4-3、§5.1(P1) |
| R13 | **COI 兜底** | COI 只挂 product_liability/tech_eo，若二者未入选则无处挂载 = 丢失 | 宿主线降级：优先两线→最相关已推荐线→proposal 级提示，永不丢 | §4.4-3、§6 |
| R14 | **COI 兜底** | 提示「向承保保司申请出具」但该线留白/无 concrete 保司时无真实保司可指 | 引用实际优选保司；无则改措辞「需与最终承保保司确认出具」 | §4.4-3 |
| R15 | **两套声明边界** | 「风险保障方向说明 / 保障方案建议」全程混用，何时用哪个未定义，含价位却叫「方向说明」会低报、纯留白叫「方案建议」会过报 | 按「是否含 concrete 已定价产品」硬判定 `documentName`，命名须与内容自洽 | §8.4-A、§6 |
| R16 | **两套声明边界** | 文档级性质声明与逐价位护栏作用域不清，易互相替代导致某一层缺位 | 明确两层作用域不重叠、均强制、G2 分别校验存在性 | §8.4-B |

**相关绝对路径**
- RAG 语义库：`C:/Users/liwen/desktop/projects/保险资料/`（`保险产品/`、`选购指南/`，其中 `选购指南/05-深度解读/` 为重叠高发区，需打 `pricing_hint` 并接受价格泄漏扫描）
- 结构化产品库：`C:/Users/liwen/desktop/projects/保险产品数据库/`（`01~12` 各 `XX产品数据.md` = 价格权威源；`15-综合报告/数据质量审计报告.md` = A/B/C 分级源；`16-推荐引擎规则库/` = 冲突/缺口/优选判定源）
- 忽略：`C:/Users/liwen/desktop/projects/公司保险/`