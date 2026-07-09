# @ensureok/catalog

保险产品数据库(仓库外 `../保险产品数据库`,12 份『XX产品数据.md』)的**结构化解析器**——把每份 Markdown 解析成 `ProductCatalog`(标题 + 头部元信息 + 章节树 + 表格,自动标记金额/价格表与保司)。

这是「结构化产品知识库」的数据层,是 Agent 推荐产品/价位、以及前端下钻的**权威数据源**。价格只信这里,不从 RAG 里编。

## 设计取向

12 份文件「家族相似而非严格同构」——价格表维度各险种不同(职业/市值/规模/行业/运输方式…)。故本包只做**结构保真**解析,忠实保留原始表格结构;把价格表映射成带维度的价位行、用于价位测算的**险种化解读留到 PR3**(Agent 管道)。详见 `docs/superpowers/specs/2026-07-09-agent-rag-design-v3-products-pricing.md`。

## 用法

```ts
import { parseProductDoc } from '@ensureok/catalog';

const cat = parseProductDoc({
  lineId: 'employer_liability',
  lineName: '雇主责任险',
  sourceFile: '保险产品数据库/01-雇主责任险/雇主责任险产品数据.md',
  markdown, // 文件内容
});
// cat.sections[].tables[] —— 结构化表格;isPriceTable 标记金额表;cat.insurers —— 识别到的保司
```

## 脚本

```bash
npm run -w @ensureok/catalog test       # 单测(vitest,对 fixture)
npm run -w @ensureok/catalog build      # 解析真实 12 份 → data/catalog.json
npm run -w @ensureok/catalog typecheck  # tsc --noEmit
```

`build` 默认从 `../保险产品数据库` 读取,可用 `CATALOG_SOURCE_ROOT` 覆盖源目录。

## 已知边界(诚实标注)

- **价格表识别基于货币形态**(¥/$/元/万);只有百分比费率、无金额示例的表可能不被标记为价格表——PR3 险种化解读时补齐。
- 结构保真解析**不做**跨险种维度归一;`ProductCatalog.sections` 保留原始层级,消费方自行按险种解读。
- 产品数据的时效/来源见每份 `meta.collectedAt` / `meta.sources`,展示时须挂价位护栏(以保司实际报价为准)。
