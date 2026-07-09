/**
 * 把保险产品数据库(仓库外)的 12 份『XX产品数据.md』解析成结构化 data/catalog.json。
 *
 *   npm run -w @ensureok/catalog build
 *
 * 源目录默认为项目同级的 ../保险产品数据库,可用 CATALOG_SOURCE_ROOT 覆盖。
 * 生成物 packages/catalog/data/catalog.json 会提交进仓库,作为前端下钻/Agent 推荐的数据集。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINE_BY_PREFIX } from '../src/lines';
import { parseProductDoc } from '../src/parseProductDoc';
import type { ProductCatalog } from '../src/types';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// packages/catalog → 上溯 3 层到 projects/,再进 保险产品数据库
const sourceRoot = process.env.CATALOG_SOURCE_ROOT
  ? resolve(process.env.CATALOG_SOURCE_ROOT)
  : resolve(PKG_ROOT, '../../../保险产品数据库');

if (!existsSync(sourceRoot)) {
  console.error(`[build-catalog] 找不到产品数据库目录:\n  ${sourceRoot}\n用 CATALOG_SOURCE_ROOT 环境变量指定其绝对路径。`);
  process.exit(1);
}

const catalogs: ProductCatalog[] = [];
const skipped: string[] = [];

for (const entry of readdirSync(sourceRoot).sort()) {
  const full = join(sourceRoot, entry);
  if (!statSync(full).isDirectory()) continue;
  const def = LINE_BY_PREFIX.get(entry.slice(0, 2));
  if (!def) {
    skipped.push(entry);
    continue;
  }
  const mdFiles = readdirSync(full).filter((f) => f.endsWith('.md'));
  const mdFile = mdFiles.find((f) => f.includes('产品数据')) ?? mdFiles[0];
  if (!mdFile) {
    skipped.push(`${entry}(无 .md)`);
    continue;
  }
  const markdown = readFileSync(join(full, mdFile), 'utf8');
  catalogs.push(
    parseProductDoc({
      lineId: def.lineId,
      lineName: def.lineName,
      sourceFile: `保险产品数据库/${entry}/${mdFile}`,
      markdown,
    }),
  );
}

catalogs.sort((a, b) => a.lineId.localeCompare(b.lineId));

const outDir = join(PKG_ROOT, 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'catalog.json');
writeFileSync(outFile, `${JSON.stringify(catalogs, null, 2)}\n`, 'utf8');

console.log(`[build-catalog] 源目录: ${sourceRoot}`);
console.log(`[build-catalog] 解析险种: ${catalogs.length} 个`);
for (const c of catalogs) {
  console.log(
    `  - ${c.lineName.padEnd(9, '　')} 采集=${c.meta.collectedAt ?? '?'} 章节=${String(c.sections.length).padStart(2)} 价格表=${String(c.priceTableCount).padStart(2)} 保司=[${c.insurers.join('/') || '—'}]`,
  );
}
if (skipped.length) console.log(`[build-catalog] 跳过(非险种目录): ${skipped.join(', ')}`);
console.log(`[build-catalog] 输出: ${outFile}`);
