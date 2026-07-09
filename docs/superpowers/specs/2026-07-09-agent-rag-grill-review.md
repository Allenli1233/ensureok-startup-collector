# Agent + RAG 子系统设计 · 对抗评审(grillme)原始结论

> 这是 Phase 1 工作流里对抗评审 agent 的原始输出,已在设计文档 v2.0 中逐条处理(见设计文档 §13)。留档备查。

---

红队审查完成。已核对现仓代码(`package.json`/`vite.config.ts`/`tsconfig.json`/`diagnoseGaps` 的真实 coverage 串/现有合规文案与测试)以坐实以下问题。按严重度排序:

---

## P0 · 上线前必须解决

**1. 合规主风险:命名保司 + 保额 + 条款 + "方案合同" ≈ 无证从事保险中介/出具投保建议书**
- 风险:设计把旧红线"不出现具体产品+保司报价"收窄为"可列 1–3 家保司名 + 保额区间 + 关键条款要点 + 配置理由",还叫 `Proposal`/"方案合同",带公司抬头、`window.print()` 成正式 PDF。即便无保费,一份"针对某公司、指名保司、给出建议保额与条款"的文书,在中国大陆监管口径下高度接近"投保建议书/保险中介推介",而非"风险分析"。
- 后果:金融监管总局可认定 EnsureOK(自称"独立第三方、不销售保险")在未取得保险经纪/代理牌照的情况下实质从事保险中介业务;"承保由持牌经纪完成"的免责挡不住"推介动作本身由无牌工具作出"。这是能招致监管处罚、而非返工的红线。
- 修法:上线前由法务/mentor 明确定性(§12.2 已列为未决,但被降级为"确认文字",应升级为"能不能做")。保守方案:保司名改为"该险种主流承保方向(不指名到具体保司)"或"由持牌顾问在沟通时提供保司清单";文档改名(去掉"合同/Proposal 合同"字样,用"风险保障方向说明");把"指名保司"这一步移到持牌经纪账户下产生。至少要拿到法务书面结论再写代码。

**2. `showPremium` 由前端请求控制,红线可被客户端翻开**
- 风险:`ProposalRequest.options.showPremium` 来自前端,而渲染门控 `meta.showPremium`。文档只说"默认 false",没写死"服务端强制忽略客户端值"。
- 后果:任何人改一个请求字段(或前端 bug)即可让保费字段渲染,击穿 P0"不出现保费"。
- 修法:服务端 Assembler 硬编码 `meta.showPremium=false`,完全无视 `request.options.showPremium`;把它从输入契约里删掉或标注"仅供内部预留、服务端不采信"。加一条护栏单测。

**3. 跨境个人信息出境到 OpenAI(PIPL),且 PII 未真正剥离**
- 风险:文档反复说"剥离 PII(phone/wechat)",但 `ProposalRequest` 仍带 `contactName`(联系人姓名=个人信息)与 `company`,并进入 `meta`/`clientProfile`;把画像发到 OpenAI(美国)=个人信息出境。§9.2/§12.2 把这事框成"更新一句隐私文案,PR4 定稿"。
- 后果:PIPL 下个人信息出境需单独同意 + 标准合同/安全评估/认证之一;把它当"文案更新"会漏掉出境合规机制本身。且现有 `COLLECTOR_PRIVACY_NOTICE` 已上线承诺"信息仅用于生成诊断报告、不用于其他目的",喂给 OpenAI 构成用途扩张,现有测试也断言了这句——直接违背已发布承诺。
- 修法:确认 `contactName` 不进入任何发往 OpenAI 的 prompt(目前"画像切片 PII 已剥离"没把 contactName 列进剥离清单);把"出境"作为独立合规项(单独同意弹窗 + 出境机制),而非文案微调;评估是否可用境内可达的模型/embedding 规避出境。

**4. OpenAI 在中国大陆不可直连,摄取与运行时都会失败,且无兜底**
- 风险:开发/部署环境是中国大陆(`RAG_SOURCE_ROOT` 默认 `C:/Users/liwen/...`,系统为 Windows 11 China)。OpenAI API 在大陆无法直连;设计对 embedding(摄取几千块)与 gpt 生成都硬依赖 `openai` SDK,无代理配置、无区域网关、无失败降级。
- 后果:(a)`npm run ingest` 在本机跑不通,PR2 直接卡死;(b)运行时每次生成都可能连接超时,前端 `POLL_TIMEOUT_MS=60000` 会常态化触发 error;(c)成本/延迟叠加不可达=功能不可用。
- 修法:在 `.env` 增加 `OPENAI_BASE_URL`(走企业代理/Azure OpenAI/合规中转)并在设计里定死;`LlmProvider`/`EmbeddingProvider` 支持自定义 endpoint 与超时/重试预算;明确服务端单任务总超时(要 < 前端 60s)与 `timeout` 错误的用户可见文案;评估是否改用境内可直连的模型作为默认,OpenAI 作为可选。

---

## High · 会返工或造成事故

**5. "可溯源"≠"忠实",护栏挡不住"给真保司安真条款"的幻觉**
- 风险:护栏只校验 `citationIds` 非空 + 保司名在证据 `insurer_name` 白名单内。但 `keyClauses[].detail`/`exclusions[].point` 是 LLM 自由文本,只要它引用一个真实存在的 chunk id 即通过——LLM 完全可以引用平安某 chunk,却把条款文义改写/张冠李戴。
- 后果:输出"平安某产品保险责任含 X"而实际条款无 X,且带着可信的引用编号,恰恰是最难被人工发现、又最危险的合规幻觉(错误条款+真实保司名一起打印成文书)。
- 修法:对 `detail`/`point` 增加忠实性校验(如要求 detail 为证据原文近似子串/或二次"引用核对"LLM 校验),而非只查引用是否存在;条款要点优先直接摘录 chunk 原文而非改写;`authority_level` 低于"保司条款/示范条款"的一律不产出条款级主张。

**6. 打印方案:`body *{visibility:hidden}` + `position:absolute; inset:0` 会导致多页 PDF 只打第一页**
- 风险:§8.4 的打印方案是经典的"绝对定位+可见性反转"技巧。这个组合在 Chrome 下对超过一页的内容会截断——绝对定位元素打印时常只渲染首页,后续险种卡片丢失。方案主体是 10 张险种卡片,几乎必然多页。
- 后果:用户导出的"完整方案"PDF 只有第一页,核心交付物直接残废,且 PR5 验收若只看单页会漏检。
- 修法:改用"打印时隐藏兄弟节点/用独立打印路由或 `@media print` 下 `display:none` 非目标区域",不要用 `position:absolute` 承载长文档;真机验证 3+ 页、卡片跨页、宽表(费率表)在 Chrome/Edge 的分页;宽表加 `overflow-x` 在屏显、打印时缩放或换布局。

**7. 根 `dev` 脚本 `&` 在 Windows(实际开发环境)不并行,server 阻塞、web 起不来**
- 风险:`"dev": "npm -w server run dev & npm -w web run dev"`。`&` 是 bash 后台符;npm 在 Windows 走 cmd.exe,`&` 是顺序分隔符,第一条是常驻不退出的 server watch,web 永远轮不到启动。
- 后果:`npm run dev` 一键起在本机(Windows)直接不工作,PR5 验收项"根 dev 一键起 web+server"失败。
- 修法:用 `concurrently`/`npm-run-all -p` 跨平台并行,而非 `&`。

**8. PDF 保单条款抽取被低估:扫描件比例、CJK 抽取顺序、"第X条"正则都脆**
- 风险:保单条款 PDF 实际常是扫描件(不止"少数大图报告");pdfjs `getTextContent()` 对中文的字符顺序/空格切分不稳,难保按阅读顺序;"责任免除"往往是一条超长 `第X条` 含多子项;`OCR_CHARS_PER_PAGE_THRESHOLD=100` 的判定粗糙;tesseract.js `chi_sim` 在 Node 内存/耗时高。
- 后果:条款切块错乱→检索到的"条款要点"证据本身失真→喂给 LLM 产出错误条款(叠加 #5)。这是整条"条款要点权威来源"的地基,估算过于乐观。
- 修法:PR2 先对那约 20 个条款 PDF 做抽取质量抽检(人工核对切块),再决定阈值与 OCR 策略;`第[一二三…0-9]+条` 正则要覆盖"第X条之X/附则/释义"变体并有失败回退;扫描件 OCR 结果标低置信、`needsManualReview`,默认不作为条款级主张来源。

---

## Medium · 需在对应 PR 前定清

**9. 异步任务态:内存/文件在"第一版单实例生产"就会出事**
- 风险:`MemoryJobStore` 进程崩/重部署=在途任务全丢;若生产用 PM2 cluster/多 worker(常见默认),A worker 建的 taskId,B worker 轮询查不到→稳定 404。`FileJobStore` 无锁,worker 写与 GET 读并发→读到半截 JSON 解析失败。文档把这些都推给"生产换 Redis",但很可能首版就直接单实例上线。
- 修法:明确首版部署形态(强制单进程单 worker,或直接上 Redis);`FileJobStore` 用原子写(临时文件 + rename);轮询接口对"任务不存在 vs 未就绪"要能区分,避免 cluster 下误 404。

**10. coverage→险种映射不完整,真实自由文本会漏拆**
- 风险:实测 `diagnoseGaps` 的 coverage 串含映射词典没覆盖的碎片:`关键人保障`、`整套用工风险管理`、`认知铺垫`、`相关责任保障`(如 `'关键人保障 + 董责险(认知铺垫)'`、`'雇主责任险 + 团体保障(整套用工风险管理)'`、`'网络安全保险(Cyber)+ 相关责任保障'`)。文档声称"单测覆盖全量 coverage 字面值,不漏不错",但这些非险种短语无对应 code。
- 后果:要么被当未知项漏掉(缺卡片),要么误拆;§6.2"不漏不错"承诺无法兑现。
- 修法:PR2 映射单测直接用 `diagnoseGaps` 所有分支的真实 coverage 输出做黄金样本;对"关键人保障/整套用工风险管理/认知铺垫/相关责任保障"这类修饰性短语显式定义为"忽略"或映射规则,写进词典并测。

**11. Monorepo 迁移会绊住现有 typecheck/test**
- 风险:(a)`packages/shared` 若只导出 `dist`,则 `dev`/`test`/`typecheck` 未先 build shared 就解析 `@ensureok/shared` 会失败(根脚本只有 `build` 先建 shared,`test`/`typecheck`/`dev` 没有);(b)现有 web 用 `moduleResolution: bundler` + `allowImportingTsExtensions`,server 计划用 `NodeNext`,同一 `shared` 被两套解析规则消费,`.ts` 扩展名/`exports` 字段易冲突;(c)现有 `tests/startup-profile-collector.test.ts` 从 `../src/config/...` 导入,迁入 `apps/web` 后路径与 `@ensureok/shared` 抽出的类型都要改,vitest v4 需配 workspace 解析。
- 后果:PR2"前端行为不变、typecheck 全绿"验收易翻车。
- 修法:`shared` 以源码 TS 作为 `exports`(或 tsconfig project references + `paths`)让 bundler/vitest 直接吃源码,避免"必须先 build";统一或显式验证两套 moduleResolution 对 shared 的兼容;迁移 PR 里同步改测试导入路径并跑通 `test`/`typecheck`。

**12. 成本/延迟与无鉴权导致的 token 烧钱**
- 风险:每份方案最多 10 险种 × 逐险种 LLM 调用(含每险 6–8 块证据入 prompt)+ 失败重试,单份就是 10–20 次调用、可观 prompt tokens;`POST /agent/proposals` 无鉴权,只有 IP 限流。
- 后果:延迟数十秒(叠加大陆不可达更糟);任何人可脚本刷接口直接烧 OpenAI 额度(成本型 DoS)。
- 修法:给出每份方案的 token/耗时预算与并发上限的量化估算;接口加轻量校验(如与 `leadId` 绑定/一次性 token/更严格限流 + 每日额度熔断);评估险种卡片按 tier 只对高优先险种调 LLM、其余用模板降本。

---

## Low · 记一笔

- **中文语义检索**:`text-embedding-3-small` 对中文保险术语召回弱于中文专用模型(BGE 等);好在 `insurance_line` 硬预过滤兜底,风险有限。换模型要全量重嵌(库已有维度校验,OK)。
- **费率表整块嵌入**:大费率表"整表不切"→单个 embedding 语义被稀释,`table` 块检索命中质量可能差;可对大表加行/段落级二级块或结构化抽取。
- **Key 处理本身是稳的**:Vite 只暴露 `VITE_` 前缀,key 在 server `.env` 不进产物,判断正确。唯一提醒:确保任何读 `process.env.OPENAI_API_KEY` 的 server 模块不被 web 打包图误引(靠 `packages/shared` 零运行时依赖 + 目录纪律保证即可)。

---
最关键三条:**#1(指名保司/条款/保额的方案文书是否越过无牌中介红线)、#3(出境合规被当文案处理且 contactName 未剥离)、#4(OpenAI 大陆不可达无兜底)**——这三条不是返工级别,是"能不能上线"级别,建议在 PR2 写第一行代码前就拿到法务与网络可达性的确定答案。
