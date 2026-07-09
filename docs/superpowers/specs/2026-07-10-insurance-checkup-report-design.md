# 保障体检报告(Treemap + 两级 Chat)· 设计规格

> 把「诊断 → 预约顾问留资」改成「诊断 →**直接给一份可交互的保障体检报告**」。报告用 treemap(大方块套小方块)呈现,方块大小与风险紧迫度正相关,配震撼动画与暖调深色高级设计;报告内提供两级 LLM chat(总览问整份 / 方块内问该险种)。
> 事实基线已核对真实代码:`src/components/StartupProfileCollector.tsx`、`src/proposal/*`、`src/index.css`(品牌色)、`packages/server/src/server.ts`、`packages/agent/src/*`。

---

## 0. 目标与非目标

**目标**:诊断出保障缺口后,用户点「领取完整体检报告」→ 直接看到一份 treemap 体检报告;能点方块下钻到险种详情;能在总览/详情两处向 LLM 提问理解报告。

**非目标(定死)**:不做承保/核保/报价;不采集必填联系方式作为看报告的前置;不引入可视化/动画第三方库(零新运行时依赖);不重构问卷采集页(只对齐设计语言);不做画像精确保额测算(沿用既有)。

---

## 1. 关键决策(brainstorm + grill 已定)

| # | 决策 | 取值 |
|---|---|---|
| D1 | Chat 严格度 | **报告解读员**:仅基于已生成报告 + RAG 证据回答;答不出用固定话术婉拒;硬禁价格/保额/投保建议/招揽;答案过 `checkCompliance` 闸门 + 附免责;低温 |
| D2 | Chat 对话模型 | **单轮无状态**(每问独立 grounding,不记历史)+ 每会话软上限(默认 20 问) |
| D3 | 留资 | **报告直给**(点击直接生成+展示,无必填联系方式);报告内留**可选、中性**联系入口(「持牌经纪跟进?留个联系方式」),填了才 POST `/api/startup-leads`;埋点保留 `lead_submitted` + 新增 `report_viewed` |
| D4 | Treemap 实现 | **零依赖自写 squarified treemap**(纯函数)+ 纯 CSS/transform 动画 |
| D5 | 窄屏(<720px) | 降级为**加权竖排堆叠**(整宽行,高度 ∝ 权重,仍分组、可点) |
| D6 | 配色 | **暖调深色**:画布用品牌最深 ink(#2A2622 档),方块按紧迫度用品牌暖→冷阶(强制赤陶暖橙 → 高优先陶土 → 建议灰褐),微光晕 + 编辑级排版 |
| D7 | 层级 | 大方块 = 紧迫分层(强制 / 高优先 / 建议),小方块 = 险种;点小方块入详情 |
| D8 | 方块大小 | ∝ 紧迫度权重 × tier 系数(见 §3.1) |
| D9 | 与旧视图 | treemap 为主;卡片内容并入险种详情;**对比表保留为次要 tab**;**PDF 导出重做**(treemap 总览 + 险种附录,保留客户/顾问双版) |
| D10 | Chat 传输 | **同步** `POST`(一次快 LLM 调用,hold 几秒返回,不轮询) |
| D11 | 交付 | **2 个 PR**:PR-A(流程/文案/config + 后端 chat 端点 + 测试)先行;PR-B(报告前端主体) |

---

## 2. 架构总览

```
诊断完成(现有)
   │  「领取完整体检报告」(替换「预约顾问…」)
   ▼
proposal.start(request)  ── 现有异步生成(POST /agent/proposals → 轮询)
   │  生成中:报告"组装中"动画骨架(treemap 扫描/拼装)
   ▼
ReportView(新·报告主页)
   ├─ Treemap 总览(大套小,面积∝紧迫度;暖黑配色;进场/hover 动画)
   ├─ 总览 Chat(问整份报告)────────┐
   ├─ 次要 tab:对比表 / 导出 PDF    │  POST /agent/proposals/:id/chat
   └─ 点小方块 → BlockDetail(下钻)  │  {scope:'report'|<lineId>, question}
        ├─ 险种详情(复用卡片内容:方向/理由/条款三态/证据/价位)
        └─ 该块 Chat(只问该险种)──┘
```

**前端新增**:`ReportView`、`treemapLayout.ts`(纯函数布局)、`InsuranceBlock`、`BlockDetail`、`ReportChat`(总览/块两处复用)、`useReportChat`。
**后端新增**:`packages/agent` 加 `answerQuestion()`(grounded 问答 + 合规);`packages/server` 加 `POST /agent/proposals/:id/chat` 路由 + 每会话计数。
**改动**:`StartupProfileCollector`(按钮/文案/流程/埋点)、`src/config/startupProfileCollector.ts`(去留资话术、留合规免责、改成功态)。

---

## 3. Treemap(前端,PR-B)

### 3.1 方块权重与尺寸
- 紧迫度基权:`mandatory=100 · high=60 · advice=30`。
- tier 系数:`tier1=1.4 · tier2=1.2 · tier3=1.0 · tier4=0.85`。
- 方块 `weight = 基权 × tier系数`;treemap 面积 ∝ weight。
- **最小面积地板**:保证最小块能显示险种名(短名)+ 紧迫标记;不足则截断名 + hover 显全名。

### 3.2 层级与分组
- 一级 = 紧迫分层容器(强制 / 高优先 / 建议),按顺序、按组内总权重分区。空组不渲染。
- 二级 = 组内险种小块。
- 单组(全同紧迫度)= 一个大块内套小块,仍成立;单险种 = 一个大块。

### 3.3 布局算法
- 自写 **squarified treemap**(纯函数 `layout(nodes, rect) → {node, x,y,w,h}[]`),追求接近正方的宽高比。纯函数、可单测(给定权重+容器→确定坐标)。

### 3.4 配色(D6)
- 画布 `--ink-900`(#2A2622)暖黑;块底色按紧迫度取品牌暖→冷阶,饱和/明度随 `qualityScore` 微调;降级/待核块加低调角标(不改主色)。
- 合规:块与详情**绝不显示保费/成交数字**(价位只显参考区间标签)。

### 3.5 动画(D4,尊重 `prefers-reduced-motion`)
- 进场:方块按权重错峰 scale/opacity 展开(CSS transition + stagger)。
- hover:微抬升 + 光晕。
- 点块→详情:共享元素 zoom 过渡(FLIP/transform)。
- 生成中:treemap "拼装中"骨架动画。

### 3.6 响应式(D5)
- `<720px`:`treemapLayout` 换"加权竖排"模式(整宽行,高 ∝ weight,分组标题分隔),复用同一数据。

---

## 4. 两级 Chat

### 4.1 后端端点(PR-A)
`POST /agent/proposals/:id/chat` · body `{ scope: 'report' | <lineId>, question: string }` · 同步返回 `{ answer, refused, disclaimer }`。
- 查 JobStore 取该 proposal;`scope='report'` → 上下文=整份方案(各险种方向/理由/条款 + portfolio);`scope=<lineId>` → 该 item + 该险种 `retrieve_clauses` 证据。
- 每会话(taskId)chat 计数软上限(默认 20),超限返回固定婉拒。

### 4.2 `answerQuestion()`(`packages/agent`,PR-A)
- system 提示:你是"报告解读员",**只依据给定报告/证据回答**;超范围用固定话术婉拒「这超出本次报告范围,建议由持牌经纪结合贵司情况评估」;**硬禁**具体保额/保费数字、"应该买X"、"能赔多少"、投保/成交 CTA。低温。
- 产出答案 → 过 `checkCompliance` 终局闸门(命中红线→隐去/换婉拒)→ 附免责串。复用 tool-core(`retrieveClauses`/`checkCompliance`)。
- 返回 `{ answer, refused, groundedRefs? }`。

### 4.3 前端(PR-B)
- `ReportChat` 组件两处复用:总览页(`scope='report'`)、险种详情(`scope=lineId`)。UI 呈对话流,但每问独立(D2)。
- `useReportChat(taskId, scope)`:调端点、管本地消息列表、软上限提示、loading。缺后端/报错优雅降级(显示"暂不可用",不崩)。

### 4.4 合规(不可协商)
- 答案红线与生成一致:无价格数字、无招揽、无投保建议;免责固定可见。
- chat 不产出联系方式采集(留资仅在 D3 的可选入口)。

---

## 5. 流程 / 文案改动(PR-A)

- CTA「预约顾问领取完整体检报告」→「**领取完整体检报告**」;点击 = 触发生成 + 进报告(不再 POST lead、不再必填联系方式)。
- 移除:成功态「顾问会在 24 小时内联系你」、「顾问 24h 联系」等留资/招揽话术。
- 保留(红线):`COLLECTOR_DISCLAIMER` 中「出单由合作持牌经纪机构完成 / 持牌顾问评估」等合规免责。
- 报告内**可选联系入口**:中性文案「需要持牌经纪跟进?留个联系方式(选填)」;填写并提交才 POST `/api/startup-leads` + `track('startup_profile.lead_submitted')`。
- 埋点:进报告 `track('report_viewed')`;联系提交仍记 `lead_submitted`。
- 问卷采集页联系方式字段从"必填前置"降为"报告内可选"(不删字段,移出关键路径)。

---

## 6. 边界与降级
- 生成失败/超时:报告页显式错误态 + 重试,不静默。
- 险种为 0(诊断无缺口):报告显"未命中高优先敞口"空态 + 中性说明(不留资话术)。
- 降级/合规隐去的险种:块正常显示带"待核"角标;详情显占位;该块 chat 仅从证据答。
- JobStore 过期(内存丢失):chat 端点返回「报告已过期,请重新生成」。

---

## 7. 测试
- **后端**:`answerQuestion` 合规护栏(泄价格→隐去/婉拒)、超范围婉拒、scope 路由;chat 端点软上限、过期任务;`treemapLayout` 纯函数(权重→坐标、面积占比、竖排模式)。
- **前端**:treemap 分组/尺寸映射、点块入详情、两级 chat(mock)、缺字段优雅降级、`prefers-reduced-motion`。

---

## 8. 交付(D11)
- **PR-A**:§5 流程/文案/config + §4.1/4.2 后端 chat 端点 + `answerQuestion` + 测试。(风险隔离:改了合规红线的后端单独审)
- **PR-B**:§3 treemap + §4.3 两级 chat UI + BlockDetail + 动画 + 暖黑配色(实现时用 taste / emil-design-eng / web-design-guidelines)+ 响应式 + 重做导出 + 对比表次要 tab。

**不可协商红线**:价格数字物理不进报告/chat;合规免责固定可见;chat 只解读不建议;treemap 不出现成交/保费数字。
