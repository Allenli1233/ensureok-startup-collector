import { describe, expect, it } from 'vitest';
import { chunkMarkdown, stableId } from '../src/chunk';
import { deriveMeta } from '../src/meta';

const base = { sourceFile: '保险产品/雇主责任险/x.md', corpus: 'product' as const, insuranceLine: '雇主责任险', docCategory: '法律法规' };

const md = `# 雇主责任险条款

## 一、保险责任

保险人对被保险人依法应承担的经济赔偿责任负责赔偿。

## 二、责任免除

### 2.1 故意行为

被保险人的故意行为不赔。
`;

describe('chunkMarkdown', () => {
  const chunks = chunkMarkdown(md, base);

  it('按标题切出多个块', () => {
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('headingPath 反映层级', () => {
    const c = chunks.find((x) => x.text.includes('故意行为不赔'));
    expect(c?.meta.headingPath).toEqual(['二、责任免除', '2.1 故意行为']);
  });

  it('块文本头部拼入标题路径', () => {
    const c = chunks.find((x) => x.text.includes('故意行为不赔'));
    expect(c?.text.startsWith('二、责任免除 > 2.1 故意行为')).toBe(true);
  });

  it('继承来源元信息', () => {
    expect(chunks[0].meta.insuranceLine).toBe('雇主责任险');
    expect(chunks[0].meta.corpus).toBe('product');
  });

  it('id 确定性(同输入同 id)', () => {
    const again = chunkMarkdown(md, base);
    expect(again.map((c) => c.id)).toEqual(chunks.map((c) => c.id));
    expect(stableId('a.md', ['x'], 0)).toBe(stableId('a.md', ['x'], 0));
    expect(stableId('a.md', ['x'], 0)).not.toBe(stableId('a.md', ['x'], 1));
  });
});

describe('deriveMeta', () => {
  it('保险产品/险种/类别', () => {
    const m = deriveMeta('保险产品/雇主责任险/02-法律法规/条款.md');
    expect(m).toMatchObject({ corpus: 'product', insuranceLine: '雇主责任险', docCategory: '法律法规' });
  });

  it('险种根目录文档 = 总览', () => {
    const m = deriveMeta('保险产品/网络安全险/综合介绍.md');
    expect(m).toMatchObject({ corpus: 'product', insuranceLine: '网络安全险', docCategory: '总览' });
  });

  it('选购指南 = guide,险种为 null', () => {
    const m = deriveMeta('选购指南/05-深度解读/5.1-雇主责任险.md');
    expect(m).toMatchObject({ corpus: 'guide', insuranceLine: null, docCategory: '选购指南' });
  });

  it('反斜杠路径归一为正斜杠', () => {
    const m = deriveMeta('保险产品\\雇主责任险\\综合介绍.md');
    expect(m.sourceFile).toBe('保险产品/雇主责任险/综合介绍.md');
    expect(m.insuranceLine).toBe('雇主责任险');
  });
});
