import type { Chunk, ChunkMeta } from './types';

/** 目标块大小(字符);超过后在段落边界切分 */
const TARGET_CHARS = 900;

/** 稳定 id(djb2 哈希十六进制)——同源文件同章节同序号则 id 稳定,支持增量摄取 */
export function stableId(sourceFile: string, headingPath: string[], ordinal: number): string {
  const s = `${sourceFile}::${headingPath.join('>')}::${ordinal}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * 结构感知分块:按 Markdown 标题(#–######)切,累积正文到目标大小后在空行处 flush。
 * 每块头部拼入 `headingPath`(『A > B』),让检索命中时带上章节上下文。
 */
export function chunkMarkdown(
  markdown: string,
  base: Omit<ChunkMeta, 'headingPath'>,
): Chunk[] {
  const lines = markdown.split(/\r?\n/);
  const stack: Array<{ level: number; text: string }> = [];
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let ordinal = 0;

  const flush = () => {
    const body = buf.join('\n').trim();
    buf = [];
    if (!body) return;
    const headingPath = stack.map((s) => s.text);
    const prefix = headingPath.length ? `${headingPath.join(' > ')}\n` : '';
    chunks.push({
      id: stableId(base.sourceFile, headingPath, ordinal++),
      text: prefix + body,
      meta: { ...base, headingPath },
    });
  };

  for (const line of lines) {
    const hm = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (hm) {
      flush();
      const level = hm[1].length;
      if (level === 1) continue; // # 视为文档标题,不进章节路径(sourceFile 已标识文档)
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: hm[2].trim() });
      continue;
    }
    buf.push(line);
    if (line.trim() === '' && buf.join('\n').length >= TARGET_CHARS) flush();
  }
  flush();
  return chunks;
}
