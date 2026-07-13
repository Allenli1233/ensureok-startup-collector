# 初创企业风险与保障分析

> Startup Risk & Insurance Analysis — 一份给中国初创的「保障体检报告」。
>
> 问卷画像 → **确定性缺口诊断 + 产品库候选池打分** → **对抗式逐险种生成**(RAG 条款检索 + 忠实度自检 + 合规终局闸门)→ **密铺体检报告**(大方块套小方块,面积 ∝ 紧迫度)+ 逐险种**解读 Chat** + **一键导出 PDF**。
>
> 定位:**独立第三方风险分析工具,不承保、不销售**。任何出单由合作**持牌保险经纪机构**完成——这是贯穿全栈的合规红线。

---

## 它做什么

用户答一份三段式问卷(公司基本盘 + 劳动用工 / 出海合同 / 数据合规三条风险线),系统:

1. **确定性缺口诊断**(纯规则,非 LLM):把答案映射成风险敞口清单。
2. **产品库候选池打分**:把产品库 12 个险种当候选池,按画像确定性打分,过阈值进报告(接通"死库存"险种);与缺口通道合并去重、封顶。
3. **对抗式逐险种生成**:每个险种用 RAG 检索真实条款证据 → LLM 生成承保方向/推荐理由/条款要点 →(可选)判分器打软维度分、按评语字段锁重写 → 忠实度三态标注(✓忠实 / ⚠待核 / ✗无支撑)。
4. **确定性价位与保司**:参考年保费区间**只来自产品库价格表**、隔离保费排除保额(带上限护栏),**数字从不进 LLM**。
5. **体检报告**:squarified 密铺的「体检舱」全屏页;点方块共享元素放大进详情;总览 + 逐险种两级解读 Chat;导出 PDF。

**合规红线(P0,全栈强制):** 无承保牌照;险种筛选全程确定性、无 LLM 参与;保费/保额数字物理隔离,不进生成 LLM、不进概览与 Chat;报告只解读、不做投保建议、无「立即投保」CTA;出单由持牌经纪完成。

---

## 快速开始

**前置**:Node ≥ 18;一份 `.env`(见下);首次需要 RAG 索引。

```bash
# 1) 安装
npm run setup                 # = npm install

# 2) 配置 .env(从示例复制后填 key)
cp .env.example .env          # 填 OPENAI_API_KEY、OPENAI_BASE_URL

# 3) 首次/克隆后:生成 RAG 条款索引(92MB,未入库;用 .env 的 key 做嵌入)
npm run rag:ingest            # 生成 packages/rag/data/rag-index.json
#   catalog.json 已入库,无需重建;若改了产品库源:npm run catalog:build
```

**起服务(开两个终端):**

```bash
npm run backend               # 后端 API → http://localhost:8787(tsx watch,改后端自动重载)
npm run frontend              # 前端    → http://localhost:5273(vite;已 proxy /agent → :8787,免 CORS)
```

打开 **http://localhost:5273**,填问卷 → 领取完整体检报告。

> **更高质量(更慢):** 开启对抗式生成 loop(judge + 重写)——`ADV_LOOP=1 npm run backend`(Windows PowerShell:`$env:ADV_LOOP=1; npm run backend`)。默认关闭 = 单次生成、最快,适合 Demo。

---

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run backend` | 起后端 API(:8787,tsx watch 热重载) |
| `npm run frontend` | 起前端(:5273,vite) |
| `npm run setup` | 安装依赖 |
| `npm run rag:ingest` | 对条款库做嵌入,生成 RAG 索引(需 key) |
| `npm run catalog:build` | 从产品库源重建 `catalog.json` |
| `npm run build` | 前端生产构建(`dist/`) |
| `npm test` | 前端 + 诊断引擎单测(vitest) |
| 各包 `-w @ensureok/<pkg> test` | 分包测试(agent/rag/catalog/server 各自 node 环境) |

---

## 架构(npm workspaces 单仓多包)

```
问卷(React/Vite)
   │  POST /agent/proposals      建异步任务(画像 + 缺口)
   │  GET  /agent/proposals/:id  轮询,ready 后取报告
   │  POST /agent/proposals/:id/chat  报告解读 Q&A(总览 / 逐险种)
   ▼
后端 API(@ensureok/server,:8787,key 只在后端)
   └─ @ensureok/agent  生成流水线:候选池打分 → 逐险种(RAG+LLM+判分+合规闸门)→ 确定性价位/保司
        ├─ @ensureok/rag      条款库嵌入 + 向量检索(RAG)
        └─ @ensureok/catalog  产品库(险种/条款/价格表/保司)
```

- **前端** `src/`：问卷采集器 + `src/proposal/` 体检报告(Bento 密铺、详情、解读 Chat、PDF、Magic UI 风格开场动效)。
- **`packages/agent`**：生成流水线、候选池打分(`lineRelevance`)、缺口→险种映射(`planLines`)、判分器、合规工具、价位计算。
- **`packages/rag`**：条款语料的嵌入与检索。
- **`packages/catalog`**:产品库解析(`catalog.json`)。
- **`packages/server`**:最小 HTTP 后端(异步任务 API + 解读 Chat)。
- **`packages/mcp`**:MCP 封装(可选)。
- **诊断引擎** `src/config/startupProfileCollector.ts` 的 `diagnoseGaps` 是纯确定性规则(非 LLM),改文案不改逻辑。

---

## 配置(`.env`)

| 变量 | 说明 | 默认 |
|---|---|---|
| `OPENAI_API_KEY` | LLM / 嵌入的 key(**只在后端读**) | 必填；用户报告禁止静默回退 stub |
| `OPENAI_BASE_URL` | OpenAI 兼容网关(含 `/v1`) | `https://api.openai.com/v1` |
| `OPENAI_CHAT_MODEL` / `LLM_MODEL` | 生成用对话模型；后者兼容 baoduile | `gpt-4o-mini` |
| `OPENAI_QA_MODEL` / `LLM_FAST_MODEL` | 报告解读 Chat 用的模型；缺省复用生成模型 | 空 |
| `AGENT_PORT` | 后端端口 | `8787` |
| `ADV_LOOP` | `1` 开启对抗式生成(judge+重写,更慢更稳) | 关 |
| `AGENT_TARGET` | 前端 dev proxy 的后端地址 | `http://localhost:8787` |
| `ALLOW_STUB_AI` | 仅自动化测试/离线开发允许桩模型 | 关 |

> `.env` 已被 git 忽略;`packages/rag/data/rag-index.json`(92MB)亦忽略,克隆后用 `npm run rag:ingest` 重建。

---

## 技术栈

TypeScript · React 18 + Vite · Motion(motion/react)· 零依赖 squarified 密铺 · 自研 OpenAI 兼容 Provider(node http/https,规避 undici 并发崩溃)· RAG(嵌入 + 余弦检索)· 对抗式生成(判分 + 字段锁重写)· vitest(jsdom + node 分环境)。

---

## 合规注意(上线前替换)

- 持牌出单机构全称 + 许可证号在免责文案里是占位("顾问沟通时披露"),正式获客前替换真实信息。
- 隐私声明的个保法保存期限与删除渠道需法务补全。
- 险种准确性与话术合规性以持牌顾问/法务终审为准。
