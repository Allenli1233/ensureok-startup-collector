/**
 * 端到端生成一份方案(诊断结果 → 推荐险种 → 产品/价位 + 条款依据 → LLM 叙述)。
 *
 *   npm run -w @ensureok/agent generate                 # 用内置 demo 画像
 *   npm run -w @ensureok/agent generate -- 某request.json
 *
 * 用 .env 的 OpenAI(需先 rag:ingest 生成索引)。无 key 则用 stub(可跑通结构,无真实叙述)。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddingProvider, loadStore } from '@ensureok/rag';
import { createChatProvider } from '../src/llm';
import { createJudge } from '../src/judge';
import { loadCatalogs } from '../src/catalogData';
import { generateProposal } from '../src/pipeline';
import type { ProposalRequest } from '../src/types';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* 无 .env */
}

const fileArg = process.argv.slice(2).find((a) => a.endsWith('.json'));
const reqPath = fileArg ? (isAbsolute(fileArg) ? fileArg : resolve(fileArg)) : join(PKG_ROOT, 'tests/fixtures/demo-request.json');
const req = JSON.parse(readFileSync(reqPath, 'utf8')) as ProposalRequest;

const catalogs = loadCatalogs(resolve(REPO_ROOT, 'packages/catalog/data/catalog.json'));
const ragStore = await loadStore(resolve(REPO_ROOT, 'packages/rag/data/rag-index.json'));
const embedding = createEmbeddingProvider();
const chat = createChatProvider();

// 对抗式 loop 默认关闭;ADV_LOOP=1 开启(judge 用异构模型,见 .env)
const loopOn = process.env.ADV_LOOP === '1';
const judge = loopOn ? createJudge() : undefined;

console.log(
  `引擎: LLM=${chat.id}/${chat.model} · RAG=${embedding.id}/${embedding.model} · 险种库=${catalogs.size} · 索引=${ragStore.size()} 块` +
    (loopOn ? ` · 对抗loop=on(judge=${judge?.model})` : ' · 对抗loop=off'),
);

const proposal = await generateProposal(req, {
  catalogs,
  ragStore,
  embedding,
  chat,
  judge,
  loop: { enabled: loopOn, maxRevisions: Number(process.env.ADV_MAX_REV ?? 2) },
  generatedAt: new Date().toISOString(),
  topK: 5,
});

console.log(`\n═══ ${proposal.meta.documentName} · ${proposal.meta.company} ═══`);
console.log(`画像: ${proposal.clientSummary}\n`);
for (const it of proposal.items) {
  const scoreTag = it.qualityScore
    ? ` [质检 ${it.qualityScore.total}/10 忠实${it.qualityScore.fidelity}/说服${it.qualityScore.persuasion}${it.qualityScore.passed ? '✓' : '✗'} 重写${it.revisions}次${it.degraded ? ' ·降级' : ''}]`
    : '';
  console.log(`【${it.tier} · ${it.urgency}】${it.lineName}   缺口: ${it.gapTitles.join('、')}${scoreTag}`);
  console.log(`  承保方向: ${oneLine(it.coverageDirection)}`);
  if (it.rationale) console.log(`  推荐理由: ${oneLine(it.rationale)}`);
  if (it.keyClauses.length) console.log(`  条款要点: ${it.keyClauses.map(oneLine).join(' | ')}`);
  console.log(`  推荐保司: ${it.recommendedProducts.map((r) => r.insurer).join('、') || '—'}`);
  console.log(`  参考价位: ${it.pricing.display}`);
  console.log(`            ${it.pricing.disclaimer}`);
  console.log(`  下钻数据: ${it.drilldownSourceFile ?? '—'} · RAG 证据 ${it.citations.length} 条${it.evidenceInsufficient ? '(证据不足)' : ''}\n`);
}
console.log(`免责声明: ${proposal.disclaimer}`);

const outDir = join(PKG_ROOT, 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'last-proposal.json');
writeFileSync(outFile, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
console.log(`\n完整方案 JSON 写入: ${outFile}`);

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
