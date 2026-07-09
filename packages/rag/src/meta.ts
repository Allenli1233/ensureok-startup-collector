import type { ChunkMeta } from './types';

/** 数字前缀子目录 → 资料类别(保险资料/保险产品/<险种>/0X-类别/) */
const CATEGORY_BY_PREFIX: Record<string, string> = {
  '01': '学术文献',
  '02': '法律法规',
  '03': '行业报告',
  '04': '实务指南',
  '05': '司法案例',
  '06': '其它',
  '07': '政策文件',
};

/**
 * 从相对『保险资料/』的路径推导 chunk 的来源元信息(不含 headingPath)。
 * 例:
 *   保险产品/雇主责任险/02-法律法规/xxx.md → corpus=product line=雇主责任险 cat=法律法规
 *   保险产品/雇主责任险/综合介绍.md        → corpus=product line=雇主责任险 cat=总览
 *   选购指南/05-深度解读/5.1-雇主责任险.md → corpus=guide   line=null      cat=选购指南
 */
export function deriveMeta(relPath: string): Omit<ChunkMeta, 'headingPath'> {
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  const corpus: ChunkMeta['corpus'] = parts[0] === '选购指南' ? 'guide' : 'product';

  const insuranceLine = corpus === 'product' && parts.length >= 2 ? parts[1] : null;

  // 资料类别:仅产品语料按 0X- 子目录前缀映射;选购指南统一归 '选购指南'
  let docCategory = corpus === 'guide' ? '选购指南' : '总览';
  if (corpus === 'product') {
    for (const p of parts.slice(1, -1)) {
      const m = /^(\d{2})-/.exec(p);
      if (m) {
        docCategory = CATEGORY_BY_PREFIX[m[1]] ?? p.replace(/^\d{2}-/, '');
        break;
      }
    }
  }

  return { sourceFile: relPath.replace(/\\/g, '/'), corpus, insuranceLine, docCategory };
}
