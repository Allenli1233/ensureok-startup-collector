# 报告视觉重构:Bento 布局 + WebGL 鼠标水波纹 + Magic UI 动效 · 实现规格

> PR-②。只改**报告页**(`src/proposal/**`),不动问卷采集器。把 treemap 换成 **Bento CSS Grid**,叠一层**自写 WebGL 鼠标跟随水波纹**,再移植 **Magic UI 两个动效组件**(BlurInText / NumberTicker)+ 详情打开的流体动效。
> 事实基线已核对真实代码:`ReportPage.tsx`、`report.css`、`BlockDetail.tsx`、`ReportChat.tsx`、`treemapLayout.ts` / `treemapLayout.test.ts`、`reportModel.ts` / `reportModel.test.ts`、`types.ts`。
> **项目无 Tailwind**——一切用 CSS 变量 / 内联样式 + `motion/react`(已装)。**禁止引入 Tailwind 或任何新运行时依赖。**

---

## 0. 目标与非目标

**目标**:报告主体从 treemap 换成更现代、可读性更强的 **Bento 网格**;最紧迫/最高权重险种占 2×2 hero,其余按权重派 span;网格上方叠一层随光标扩散的 WebGL 水波纹;文字按阅读顺序模糊浮现、非金额数字向上滚动计数;点方块进详情的共享元素放大加一层流体感。全程尊重 `prefers-reduced-motion` / 键盘可达 / Esc / 锁滚动 / 合规免责,PDF 打印文档不受影响。

**非目标(定死)**:
- 不引 Tailwind、不引任何可视化/动画/WebGL 第三方库(RippleField 自包含,零新依赖)。
- 不动问卷采集器、`src/proposal/buildRequest.ts`、`src/config/startupProfileCollector.ts`、`packages/agent/**`。
- 不改数据模型契约:`reportModel.ts`(权重 / 分组 / 配色)与 `types.ts` 保持原样、复用;`reportModel.test.ts` 不改。
- 不做承保/核保/报价;**任何金额都不进 Bento 概览**,价位只在 BlockDetail 的「参考价位」区间标签显示(维持现状)。

---

## 1. 关键决策

| # | 决策 | 取值 |
|---|---|---|
| D1 | 布局实现 | 新增纯函数 `bentoLayout.ts`(item → span 分配),CSS Grid `grid-auto-flow: row dense` 渲染;**保留** `treemapLayout.ts` 与其单测原封不动(仍导出、仍通过,只是 ReportPage 不再用它)。权重仍来自 `reportModel.itemWeight` / `buildReportGroups`(不改)。 |
| D2 | Hero | 全局权重最高(= 最紧迫 × tier)的**单个**险种占 `2×2`;并列时取 `buildReportGroups` 展开后的稳定首个(强制→高优先→建议、组内传入序),保证确定性可单测。 |
| D3 | 其余 span | 按「权重 / 最大权重」比值分档派 `2×2 / 2×1 / 1×2 / 1×1`(§2.2),`grid-auto-flow: dense` 自动填洞。 |
| D4 | 窄屏 | `<720px` 降级为 **2 列**;所有块 `colSpan ≤ 2`,hero 变整宽 `2×2`。 |
| D5 | 水波纹 | 自写 **WebGL 片元着色器**独立 `<canvas>`,`pointer-events:none` 铺在 Bento 层上;`requestAnimationFrame`;`visibilitychange` 隐藏暂停;`prefers-reduced-motion` 完全不初始化;WebGL 不可用优雅降级为静态(不报错)。顶部留 UnicornStudio 迁移 TODO。 |
| D6 | 开场文字 | 移植 Magic UI `TextAnimate(blurInUp)` / `BlurIn` → `BlurInText.tsx`,逐词/逐段 `opacity0 + blur(8px) + translateY↑ → 清晰`,stagger 40–70ms,ease `[0.22,1,0.36,1]`。 |
| D7 | 数字动效 | 移植 Magic UI `NumberTicker` → `NumberTicker.tsx`,count-up + 轻微上浮,`useInView` 触发,spring。**只对非金额数字**(可信度 / 诊断缺口 N / 险种计数),**绝不用于任何金额**。 |
| D8 | 详情动效 | 沿用共享元素 `layoutId` 放大,内容层加 `scale 0.96→1 + blur 6px→0` 流体过渡(emil);reduced-motion 退化为纯透明度。 |

---

## 2. Bento 布局(`bentoLayout.ts` + `ReportPage`/`report.css`)

### 2.1 数据来源(复用,不改)
- `buildReportGroups(proposal.items)` → 分组(强制→高优先→建议,空组不产出)。
- 把各组 `nodes` **按传入顺序展开成一个扁平序列**,每项已带 `weight = itemWeight(item)`(`mandatory100/high60/advice30 × tier1.4/1.2/1.0/0.85`)。
- `blockColor(urgency, qualityScore)` 继续给方块底色 + 光晕(暖→冷阶,WCAG 已核)。

### 2.2 纯函数 `bentoLayout(items, opts?) → Placement[]`
零依赖、无 React/DOM/随机,同输入同输出,可单测。签名建议:

```ts
export type BentoSpan = '2x2' | '2x1' | '1x2' | '1x1';
export interface Placement {
  id: string;            // = lineId
  rank: number;          // 0 = hero(全局权重最高)
  span: BentoSpan;
  colSpan: number;       // 1 | 2
  rowSpan: number;       // 1 | 2
}
export interface BentoOptions { columns?: 2 | 4; } // 默认 4;窄屏传 2
export function bentoLayout(
  items: { id: string; weight: number; order: number }[],
  opts?: BentoOptions,
): Placement[];
```

**排名与分档规则**(确定性):
1. 以 `weight` 降序、`order`(展开序)为 tiebreak 排出 `rank`(0-based)。
2. `rank === 0` → `2x2`(hero)。
3. 其余按 `r = weight / maxWeight` 分档:
   - `r ≥ 0.80` → `2x2`
   - `0.55 ≤ r < 0.80` → `i` 偶 `2x1`(宽)/ 奇 `1x2`(高)(交替制造节奏,`i` = 该项在 rank≥1 中的序)
   - `0.35 ≤ r < 0.55` → `1x2`(高)
   - `r < 0.35` → `1x1`
4. **窄屏(`columns === 2`)**:任何 `colSpan` 夹到 `≤ 2`;hero 保持 `2×2`(整宽两行);其余 `2x2→2x1`、`2x1→2x1`、`1x2→1x2`、`1x1→1x1`(即只压 col,不压 row),保证 2 列不溢出。

> 之所以用比值分档 + `grid-auto-flow: dense` 而非精确打包:CSS Grid dense 会自动回填空洞,无需自写二维装箱;分档保证「权重越大块越大」的单调直觉(hero 最大,其后 2×2 > 2×1/1×2 > 1×1)。

### 2.3 渲染(`ReportPage.tsx`)
- `ReportBody` 里把 `layoutReport(...)` 那套绝对定位 treemap 替换为一个 `.rp-bento` 容器:
  ```
  .rp-bento { display:grid; grid-template-columns:repeat(4,1fr);
              grid-auto-rows: <base 132–160px, clamp>; gap:12px;
              grid-auto-flow: row dense; }
  @media (max-width:720px){ .rp-bento{ grid-template-columns:repeat(2,1fr); } }
  ```
- 每个方块类名带 span:`.rp-cell.rp-cell-2x2 { grid-column:span 2; grid-row:span 2; }` 等四档;窄屏媒体查询里把 `2x2` 的 `grid-column` 覆盖为 `span 2`(已 ≤2,天然成立),把原 `2x1`/`1x1` 维持。
- **保留**「点方块进详情」:方块仍是 `motion.button` + `layoutId={`rp-block-${lineId}`}`;被选中的块渲染占位(现有逻辑照搬)。
- 险种名 / 承保方向摘要 / tier chip / 可信度分数照旧;字号可随 span 微调(hero 更大),用 CSS 变量 `--rp-s`(hero=1.4、2×格=1.15、1×格=1)驱动,复用现有 `--rp-s` 排版体系。
- **分组信息**:treemap 的绝对定位组标签取消;改为 Bento 上方一排「组计数 chip」(强制 N · 高优先 N · 建议 N,复用 `URGENCY_META` 文案),计数用 §4 的 `NumberTicker`;方块内保留 urgency/tier chip 表明归属。
- **0 险种空态**:保留现有空态(clientSummary + 「暂未识别到需要展示的险种」+ disclaimer),不渲染 Bento/Ripple。
- 现有方块内的 DOM 点击 ripple(`.rp-ripple`)可**保留**作为点击反馈(与光标 WebGL 水波纹不冲突,一个是点击、一个是悬停跟随);若视觉冗余可仅留 `whileTap` 缩放。二选一,实现时取更干净者,不影响合规。

---

## 3. RippleField(`RippleField.tsx` · 自写 WebGL)

### 3.1 结构与集成
- 独立组件,渲染一个 `<canvas class="rp-ripple-canvas" aria-hidden="true">`,绝对定位铺满 `.rp-bento` 的定位父级,`pointer-events:none`、`z-index` 在方块之下或之上取「装饰但不挡点击」(建议置于方块**之下**做背景水光,或之上但 `pointer-events:none`+低 alpha)。GPU 合成层,不参与布局。
- 挂载在 `.rp-stage`/`.rp-bento` 的相对定位容器内;`ResizeObserver` 同步 canvas 尺寸(`devicePixelRatio` 上限取 2,控性能)。
- 光标坐标:在容器上监听 `pointermove`(容器 `pointer-events` 正常,canvas 不吃事件),把 client 坐标换算成 uv 传入。

### 3.2 着色器方案(GLSL,内联字符串)
- **顶点**:全屏三角/四边形,传 `uv`。
- **片元**:在暖调深色底(品牌 ink `#231f1b`)上叠**跟随光标的同心水波**:
  - 维护一个 **ring buffer(如 8 个)** 的「波源」`vec3(uvx, uvy, birthTime)`:光标移动超过阈值距离时压入一个新波源(或每 ~90ms 采样一次),形成拖尾扩散。
  - 片元对每个存活波源计算 `d = distance(uv*aspect, center*aspect)`;`age = now - birth`;
    `phase = d*FREQ - age*SPEED`;`ring = sin(phase) * exp(-d*FALLOFF) * exp(-age*DECAY)`。
  - 累加 `ring` → 两个用途:(a)**位移**:用 `ring` 扰动采样一张程序化径向渐变(暖橙微光)的 uv,制造水面折射;(b)**高光**:`spec = smoothstep(edge0,edge1,ring)`,加一层白色高光。
  - 输出低 alpha(≤0.5)预乘,叠加模式让它读作「深舱里的水光」,不压过方块可读性。
- 参数(FREQ/SPEED/FALLOFF/DECAY)取到「柔和、非炫技」,与 chamber 暖黑调协调。

### 3.3 生命周期与降级(硬性)
- **rAF**:唯一动画循环,`cancelAnimationFrame` 于卸载。
- **`visibilitychange`**:`document.hidden` 时停 rAF、页面可见再起(省电、防后台空转)。
- **`prefers-reduced-motion`**:通过 `useReducedMotion()` 判定;为真则**根本不初始化 WebGL**,组件返回 `null`(或静态深色 div),零动画。
- **WebGL 不可用**:`canvas.getContext('webgl'|'experimental-webgl')` 为 `null`,或 shader 编译 / program link 失败 → `try/catch` 捕获,清理资源、组件降级为静态(返回 `null` 或纯 CSS 渐变),**绝不抛错**、不影响 Bento。
- 只动 canvas 内像素(GPU),不触发布局/回流;不写 DOM 动画。

### 3.4 UnicornStudio 迁移 TODO(组件顶部注释)
在文件头写明将来如何换成托管场景,便于替换:
```txt
// TODO(unicornstudio): 现为自包含 WebGL 着色器,零依赖。将来若接 UnicornStudio 托管场景:
//   1) 渲染 <div data-us-project="<PROJECT_ID>" class="rp-ripple-canvas" /> 取代本 <canvas>;
//   2) 动态注入其 script 后在挂载时调用
//      window.UnicornStudio?.addScene({ elementId, projectId: '<PROJECT_ID>', ... })
//      并在卸载时销毁该 scene;
//   3) 保持本组件对外 props / 定位 / pointer-events:none / reduced-motion 降级不变。
```

---

## 4. Magic UI 组件移植(CSS/motion,不引 Tailwind)

> 两个组件均在文件头注释注明来源:`// 移植自 Magic UI(MIT,magicui.design),改用 motion/react + 本项目 CSS,无 Tailwind`。

### 4.1 `BlurInText.tsx`(TextAnimate blurInUp / BlurIn)
- **API**:`<BlurInText text | children as={'h1'|'p'|'span'} by={'word'|'char'|'line'} startDelay={0} stagger={0.05} once />`。
- **动效**:把文本按 `by` 切段(默认逐词),每段 `motion.span`:
  - `initial`: `{ opacity:0, filter:'blur(8px)', y:8 }`
  - `animate`: `{ opacity:1, filter:'blur(0px)', y:0 }`
  - `transition`: `{ duration:0.5, ease:[0.22,1,0.36,1], delay: startDelay + i*stagger }`(stagger 40–70ms)。
  - 用 container `staggerChildren` 或逐段 `delay` 均可;段间保留空格(`white-space` / 用 `inline-block` + 尾随空格节点)。
- **触发时机**(页面打开的阅读顺序):挂载即播,用递增 `startDelay` 编排——
  `Header 标题 kicker (0)` → `clientSummary 摘要 (~0.15s)` → `组计数 chips (~0.28s)` → `rp-hint 提示 (~0.4s)` → `disclaimer` 可选。首屏文案用 `animate`(非 whileInView);靠下文本可 `useInView({once})`。
- **reduced-motion**:`useReducedMotion()` 为真 → 不切词、不 blur/位移,整体一次性淡入(或直接可见),`duration` 收到 ≤0.2s。

### 4.2 `NumberTicker.tsx`(NumberTicker)
- **API**:`<NumberTicker value={number} start={0} decimals={0} className? />`,`useInView({ once, margin })` 触发。
- **动效**:`useMotionValue(start)` → 进入视口 `animate(mv, value, { type:'spring', stiffness/damping 调柔 })`;`mv.on('change')` 里把 `ref.textContent` 更新为 `toFixed(decimals)`(motion 不能直接把数字渲进文本,用订阅写 ref)。外层 `motion.span` 加 `initial{opacity:0,y:8}→animate{opacity:1,y:0}` 轻微上浮。`font-variant-numeric: tabular-nums`(复用现有 `.rp-block-score` 习惯)防跳动。
- **用途(合规,只非金额)**:
  - 组计数 chip 的「强制 N / 高优先 N / 建议 N」(N = 该组险种数)。
  - 顶部/摘要区「识别 N 项待关注」(N = `proposal.items.length`)或「诊断缺口 N 项」。
  - 方块内「可信度 <qualityScore>」分数(0–100,非金额)。
- **reduced-motion**:直接渲染终值,无 count-up、无上浮。
- **合规红线**:**绝不**包裹 `pricing.display` 或任何金额/保额/保费;金额始终是静态文本、且只在 BlockDetail。

---

## 5. 详情打开动效(`ReportPage` + `BlockDetail`)

- 维持现有共享元素:被选块 `motion.button(layoutId)` → `.rp-detail(layoutId)` 的形变放大(现有 spring 保留)。
- **加 emil 流体感**:在 `rp-detail` 内容层(或 `BlockDetailBody` 外包一层 `motion.div`)加
  `initial:{ scale:0.96, filter:'blur(6px)', opacity:0.6 }` → `animate:{ scale:1, filter:'blur(0px)', opacity:1 }`,`transition` 用 `[0.22,1,0.36,1]` 短时长,避免与外层 layout 形变打架(内容层只做细微 blur/scale 收束,外层负责位置/尺寸 morph)。
- 关闭(`AnimatePresence` exit)对称退化。
- **reduced-motion**:内容层退化为纯 `opacity` 过渡,无 blur/scale;外层 spring 时长收短、bounce=0(现有已如此)。
- Esc / 焦点管理 / 背景锁滚动 / `overscroll-behavior` / `touch-action` 全部沿用现有实现,不回退。

---

## 6. 合规注记(不可协商)

- **金额只在 BlockDetail 的「参考价位」**(区间标签 + 「以保司实际报价为准,非成交报价」),Bento 概览、组 chip、方块面、水波纹层**均不出现任何金额/保费/保额数字**。
- **NumberTicker 只用于非价格数字**(可信度分、缺口/险种计数);实现层面禁止把 `pricing.*` 传入 NumberTicker。
- 合规免责(`proposal.disclaimer`)固定可见,位置不变。
- PDF 打印文档(`.rp-print` / `@media print`)**不受本次改动影响**:仍是屏幕隐藏、打印可见的干净文档,Bento/Ripple/动效均不进打印流;自检需确认打印样式未被波及。

---

## 7. 文件改动清单(范围仅 `src/proposal/**`)

**新增**
- `src/proposal/bentoLayout.ts` — 纯函数 span 分配(§2.2)。
- `src/proposal/bentoLayout.test.ts` — 单测(§8)。
- `src/proposal/RippleField.tsx` — 自写 WebGL 水波纹(§3)。
- `src/proposal/BlurInText.tsx` — Magic UI 文字模糊浮现(§4.1)。
- `src/proposal/NumberTicker.tsx` — Magic UI 数字滚动(§4.2)。

**修改**
- `src/proposal/ReportPage.tsx` — treemap→Bento 渲染、挂 RippleField、接 BlurInText/NumberTicker、详情内容层流体动效。
- `src/proposal/report.css` — `.rp-bento` grid + span 四档 + 窄屏 2 列 + ripple canvas 定位 + 新组件样式;`@media print` / `prefers-reduced-motion` 段相应补齐。
- `src/proposal/BlockDetail.tsx` — 详情内容层加流体动效包裹(若在此实现)。

**不改(复用/保持)**
- `reportModel.ts` / `reportModel.test.ts`、`types.ts`、`ReportChat.tsx`、`treemapLayout.ts` / `treemapLayout.test.ts`(保留、仍通过)、`print.css`、`buildRequest.ts`。
- **禁碰**:`packages/agent/**`、`src/proposal/buildRequest.ts`、`src/config/startupProfileCollector.ts`。

---

## 8. 测试与降级

### 8.1 单测(vitest,web 根)
- **`bentoLayout.test.ts`(新增)**:
  - rank 0 = 全局最大权重、且 `span==='2x2'`(hero)。
  - 单调性:hero 面积(colSpan×rowSpan)≥ 任意非 hero;更大权重不给出更小档(比值分档正确)。
  - 分档边界:`r≥0.8→2x2`、`0.55≤r<0.8` 交替 `2x1/1x2`、`0.35≤r<0.55→1x2`、`r<0.35→1x1`。
  - 窄屏 `columns:2`:所有 `colSpan≤2`;hero 仍 `2x2`。
  - 空输入 → `[]`;单险种 → 单 hero;确定性(同输入同输出,含并列 tiebreak)。
- **保持通过(不改)**:`treemapLayout.test.ts`、`reportModel.test.ts`;现有前端 79 测试全绿,新增 bento 测试为增量。
- **组件测试(可选、轻量,避免脆弱)**:
  - `BlurInText`:渲染后文本内容完整(逐词切分不丢字/不丢空格);reduced-motion 分支不崩。
  - `NumberTicker`:渲染出数字节点;jsdom 无 IntersectionObserver 时需 mock 或 polyfill(或组件对缺失 `useInView` 优雅处理,直接显示终值)。
  - `RippleField`:jsdom 无 WebGL,`getContext` 返回 `null` → 组件降级返回 `null`、**不抛错**(可加一条渲染冒烟测试)。

### 8.2 降级矩阵
| 条件 | 行为 |
|---|---|
| `prefers-reduced-motion` | RippleField 不初始化;BlurInText 一次性淡入(无 blur/位移);NumberTicker 直接显终值;详情内容层仅 opacity;方块 whileInView 不位移(沿用现有)。 |
| WebGL 不可用 / 编译失败 | RippleField 静态降级(返回 null 或纯 CSS 渐变),不报错,Bento 正常。 |
| `document.hidden`(切后台) | RippleField 暂停 rAF,可见再恢复。 |
| 窄屏 `<720px` | Bento 降 2 列;hero 整宽 2×2;所有块 colSpan≤2。 |
| 0 险种 | 保留空态,不渲染 Bento/Ripple。 |
| 打印 / 导出 PDF | 走 `.rp-print` 文档,动效与 canvas 不进打印流。 |

### 8.3 自检命令(web 根,不启任何服务)
```
npx tsc --noEmit      # 类型通过
npx vitest run        # 现有 79 + 新增 bento 测试全绿
npm run build         # tsc --noEmit && vite build 成功
```

**不可协商红线**:金额物理不进 Bento/chip/水波纹层,只在 BlockDetail 参考价位;NumberTicker 不碰任何金额;免责固定可见;PDF 打印不受影响;`prefers-reduced-motion` / 键盘可达 / Esc / 锁滚动全部保留;不引 Tailwind、不加新运行时依赖;不动问卷采集器与禁碰文件。
