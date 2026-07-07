# 创业公司保障画像采集器

围绕中国初创绕不开的三条风险线——**劳动用工 · 出海合同 · 数据合规**——的三段式问卷 +
确定性缺口诊断反馈页。终点是「保障缺口诊断 + 预约顾问」,不是自动核保报价(无承保牌照,合规红线)。

从 [EnsureOK](https://ensureok.ai) 主站 `/qiye/profile` 抽出的独立纯前端站,便于单独部署 /
迭代 / 交付渠道。**本 repo 只有前端**;留资与埋点跨域回流 EnsureOK 现有服务。

## 架构

```
浏览器(本站,纯前端)
   │  POST /api/startup-leads   (留资:画像 + 缺口快照 + 联系方式)
   │  POST /api/events          (埋点:page_view / preview_viewed / lead_submitted)
   ▼
EnsureOK 现有服务(ensureok.ai)
   └─ startup_leads 表 + admin 看板(数据回流,与主站 /qiye/profile 同一套)
```

- **诊断引擎** `src/config/startupProfileCollector.ts` 的 `diagnoseGaps` 是纯前端确定性规则
  (非 LLM):字段定义、三条线缺口逻辑、紧迫度分级、补贴提示、全部合规文案都在这一个文件,
  改文案不改逻辑,可不发版热改。
- **无后端、无数据库、无密钥**:提交直接打 EnsureOK 的两个公开匿名口。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5273 —— vite proxy 把 /api 转发到 ensureok.ai,免 CORS
npm run typecheck
npm test           # 诊断引擎 + 合规护栏单测(vitest)
npm run build      # 产物 dist/,纯静态,可挂任意 CDN / 静态托管
```

## 配置(`.env`)

| 变量 | 说明 | 默认 |
|------|------|------|
| `VITE_API_BASE` | 留资/埋点提交的目标 API 基址(生产构建编进产物) | 空(dev 走 proxy);生产建议 `https://ensureok.ai` |

生产构建:`VITE_API_BASE=https://ensureok.ai npm run build`。

## 依赖:EnsureOK 侧 CORS

本站部署在独立域名后,提交是**跨域**请求。EnsureOK 主站需对这两个公开口开放 CORS
(`Access-Control-Allow-Origin`,允许 `POST` + `Content-Type` 头,预检可缓存):

- `POST /api/startup-leads`
- `POST /api/events`

这两个本就是匿名无鉴权的公开留资/埋点口,开放 CORS 不引入新的鉴权风险。埋点 unload 兜底
用 `fetch(keepalive)` 复用已缓存的预检,不用 `sendBeacon`(跨域 JSON 会被 CORS 拦)。

## 与主站的复用关系

以下文件与 EnsureOK 主站保持**逐字一致**,是从主站移植的,改动应双向同步:

- `src/config/startupProfileCollector.ts` — 字段 + 诊断引擎 + 合规文案(唯一事实源)
- `src/components/StartupProfileCollector.tsx` — 采集器组件(仅 import 路径 + 跨域 fetch 有差异)
- `src/api/tracker.ts` — 埋点 SDK(跨域改造:去 credentials、unload 用 keepalive fetch)
- `tests/startup-profile-collector.test.ts` — 诊断引擎 + 合规护栏单测

## 合规注意(上线前替换)

- 隐私声明缺个保法保存期限与权利行使渠道(「可随时要求删除」未给具体渠道)——需法务补。
- 持牌出单机构全称 + 许可证号在 `COLLECTOR_DISCLAIMER` 里是占位("顾问沟通时披露"),
  正式获客前替换为真实信息。
- 合规红线(P0):全程不出现保费金额、不出现「具体产品+保司」报价、无「立即投保/购买」CTA。
