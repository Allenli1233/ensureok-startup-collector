/**
 * PR4.5 实测闸门(§9.0):批量生成一组 proposal,汇总对抗 loop 的可测指标,判定"是否达标上线"。
 *
 *   ADV_LOOP=1 npm run -w @ensureok/agent measure                 # 用内置 measure-set.json
 *   ADV_LOOP=1 npm run -w @ensureok/agent measure -- my-set.json  # 自定义一批 request(数组)
 *
 * 重要:judge 忠实度**准确率/假阴性率需人工标注比对**——本脚本给出 pass 率、降级率、调用数、
 * gate 命中率、faithfulness 分布 + 逐条原始数据(写盘)供人工审;不自动判"准确率达标"。
 * 建议 ≥30 份、覆盖 12 险种后再据此决定 fidelityDestructive 是否开启。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbeddingProvider, loadStore } from '@ensureok/rag';
import { loadCatalogs } from '../src/catalogData';
import { createChatProvider } from '../src/llm';
import { createJudge } from '../src/judge';
import { summarizeProposals } from '../src/measure';
import { generateProposal } from '../src/pipeline';
import type { Proposal, ProposalRequest } from '../src/types';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');
const proc = process as unknown as { loadEnvFile?: (p: string) => void };
try {
  proc.loadEnvFile?.(join(REPO_ROOT, '.env'));
} catch {
  /* 无 .env */
}

const fileArg = process.argv.slice(2).find((a) => a.endsWith('.json'));
const setPath = fileArg ? (isAbsolute(fileArg) ? fileArg : resolve(fileArg)) : join(PKG_ROOT, 'tests/fixtures/measure-set.json');
const requests = JSON.parse(readFileSync(setPath, 'utf8')) as ProposalRequest[];

const catalogs = loadCatalogs(resolve(REPO_ROOT, 'packages/catalog/data/catalog.json'));
const ragStore = await loadStore(resolve(REPO_ROOT, 'packages/rag/data/rag-index.json'));
const embedding = createEmbeddingProvider();
const chat = createChatProvider();
const loopOn = process.env.ADV_LOOP === '1';
const judge = loopOn ? createJudge() : undefined;

console.log(`实测集: ${requests.length} 份 · LLM=${chat.id}/${chat.model} · 对抗loop=${loopOn ? `on(judge=${judge?.model})` : 'off'}`);
if (!loopOn) console.log('⚠️ 未开 ADV_LOOP:无 judge 评分,报告只反映结构不反映质量。设 ADV_LOOP=1 复测。');

const proposals: Proposal[] = [];
for (let i = 0; i < requests.length; i++) {
  process.stdout.write(`  生成 ${i + 1}/${requests.length} (${requests[i].company})… `);
  const p = await generateProposal(requests[i], {
    catalogs, ragStore, embedding, chat, judge,
    loop: { enabled: loopOn, maxRevisions: Number(process.env.ADV_MAX_REV ?? 2), callBudget: process.env.ADV_BUDGET ? Number(process.env.ADV_BUDGET) : undefined },
    generatedAt: new Date().toISOString(),
    topK: 5,
  });
  proposals.push(p);
  console.log(`${p.items.length} 险种`);
}

const report = summarizeProposals(proposals);
console.log('\n═══ 实测报告 ═══');
console.log(`份数 ${report.proposals} · loop 险种 ${report.loopItems} · 覆盖险种 ${report.linesCovered.length}: ${report.linesCovered.join('、')}`);
console.log(`pass 率 ${pct(report.passRate)} · 降级率 ${pct(report.degradedRate)} · gate 命中率 ${pct(report.gateHitRate)}`);
console.log(`调用数 平均 ${report.calls.avg} / 最坏 ${report.calls.max} / 合计 ${report.calls.total}`);
console.log(`weightedScore 最低 ${report.score.min} / 平均 ${report.score.avg} / 最高 ${report.score.max}`);
console.log(`忠实度分布 忠实${report.faithfulness.entailed} · 待核${report.faithfulness.unverified} · 无支撑${report.faithfulness['not-supported']} · 讲反${report.faithfulness.contradicted}`);
console.log(`降级原因 ${JSON.stringify(report.degradedReasons)}`);
console.log(`\n⚠️ ${report.note}`);

const outDir = join(PKG_ROOT, 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'measure-report.json');
writeFileSync(outFile, `${JSON.stringify({ report, proposals }, null, 2)}\n`, 'utf8');
console.log(`\n报告 + 逐条原始数据(供人工核对忠实度)写入: ${outFile}`);

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
