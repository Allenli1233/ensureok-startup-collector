# Backlog:单条方案条目重写(「重写这一条」)

> GitHub issues 在本 fork 关闭,故以 in-repo backlog 形式跟踪。后期解决。

## 背景
设计文档 §7.5 M4 要求「重写这一条」:对单个险种条目触发一次对抗 judge loop 重写,而非整份重生成。

当前状态(adv-PR3–PR8):
- 前端 `src/proposal/ProposalView.tsx` 已留 `TODO(backend)` 占位,未编造该功能。
- 后端只有整份重生成端点 `POST /agent/proposals`,**无 per-item 重写端点**。

## 待做

**后端(`packages/server` + `packages/agent`)**
- 新增 per-item 重写端点(如 `POST /agent/proposals/:id/items/:lineId/revise`),复用对抗 loop 只跑该险种。
- 输入沿用该 item 的证据/画像;输出新的 `ScoreCard` / `keyClausesDetailed` / `degraded`。

**前端(§7.5 M4 约束)**
- 「重写这一条」按钮 + **冷却时间 + 次数上限**(如每 item 每会话 ≤ 3 次),防无限点烧钱。
- **结果稳定化**:同一 item 重跑取历史最优版(按 `qualityScore`),**不允许比当前更差的结果覆盖**(避免 clean→degraded 翻转削弱信任信号)。
- 合规护栏文案不可编辑、不可移除。

## 明确不做(本轮已决)
- **compute_pricing 精确 matchTier(画像,§4.2.3)**:需先在采集端补「职业类别」等维度,否则会给出误导性偏低报价。当前保留诚实全档区间,暂不做。
