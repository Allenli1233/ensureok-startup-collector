/**
 * PR4.5 人工标注模板生成:把 measure-report.json 里逐条 keyClause 摊成一张待标注表(TSV),
 * 供人工核对 judge 忠实度的**假阴性率**(judge 判 entailed 但实际 not-supported 的比例)。
 *
 *   npm run -w @ensureok/agent measure -- ...        # 先跑实测,产出 data/measure-report.json
 *   npm run -w @ensureok/agent label:template         # 生成 data/label-sheet.tsv
 *
 * 标注完成后:human_faithful 列填 y/n(该条是否真被证据支撑),据此算 judge 假阴性/假阳性率;
 * 达标(如假阴性率 < 阈值)方可开 fidelityDestructive(§9.0)。本脚本不判定,只出表。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Proposal } from '../src/types';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = join(PKG_ROOT, 'data/measure-report.json');

let parsed: { proposals?: Proposal[] };
try {
  parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as { proposals?: Proposal[] };
} catch {
  console.error(`读不到 ${reportPath}。先跑:ADV_LOOP=1 npm run -w @ensureok/agent measure`);
  process.exit(1);
}
const proposals = parsed.proposals ?? [];

const header = ['company', 'lineName', 'clause_index', 'clause_text', 'evidenceRefs', 'judge_faithfulness', 'human_faithful(y/n)', 'notes'];
const rows: string[][] = [header];
for (const p of proposals) {
  for (const it of p.items) {
    (it.keyClausesDetailed ?? []).forEach((c, i) => {
      rows.push([
        p.meta.company,
        it.lineName,
        String(i),
        c.text.replace(/\s+/g, ' ').slice(0, 200),
        (c.evidenceRefs ?? []).join('|'),
        c.faithfulness ?? '(none)',
        '',
        '',
      ]);
    });
  }
}

const tsv = rows.map((r) => r.map((c) => c.replace(/\t/g, ' ')).join('\t')).join('\n');
const outFile = join(PKG_ROOT, 'data/label-sheet.tsv');
writeFileSync(outFile, `${tsv}\n`, 'utf8');
console.log(`待标注条款 ${rows.length - 1} 行 → ${outFile}`);
console.log('用法:human_faithful 列填 y/n;judge 判 entailed 而人工填 n 的即"假阴性"(误放过),据此算准确率决定 fidelityDestructive。');
