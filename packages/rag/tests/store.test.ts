import { describe, expect, it } from 'vitest';
import { JsonVectorStore, cosine } from '../src/store';
import { StubEmbeddingProvider } from '../src/embedding/stub';
import type { EmbeddedChunk } from '../src/types';

const stub = new StubEmbeddingProvider();
const embed = async (t: string): Promise<number[]> => (await stub.embed([t]))[0];

function chunk(id: string, line: string, text: string, vector: number[]): EmbeddedChunk {
  return {
    id,
    text,
    vector,
    meta: { sourceFile: `${id}.md`, corpus: 'product', insuranceLine: line, docCategory: '总览', headingPath: [] },
  };
}

describe('cosine', () => {
  it('相同向量 ≈ 1', () => expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1));
  it('维度不符返回 0', () => expect(cosine([1, 2], [1, 2, 3])).toBe(0));
  it('零向量返回 0', () => expect(cosine([0, 0], [1, 1])).toBe(0));
});

describe('JsonVectorStore.query', () => {
  it('按相似度降序,相关文本排最前', async () => {
    const chunks = [
      chunk('a', '雇主责任险', '雇主责任险 保障员工工伤赔偿责任', await embed('雇主责任险 保障员工工伤赔偿责任')),
      chunk('b', '网络安全险', '网络安全险 数据泄露与网络攻击应急', await embed('网络安全险 数据泄露与网络攻击应急')),
      chunk('c', '团体意外险', '团体意外险 员工意外身故伤残医疗', await embed('团体意外险 员工意外身故伤残医疗')),
    ];
    const store = new JsonVectorStore({ model: stub.model, dimensions: stub.dimensions, builtWith: stub.id, chunks });
    const res = store.query(await embed('雇主责任险 工伤赔偿'), { topK: 3 });

    expect(res[0].id).toBe('a');
    expect(res).toHaveLength(3);
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score);
    expect(res[1].score).toBeGreaterThanOrEqual(res[2].score);
  });

  it('按险种过滤', async () => {
    const chunks = [
      chunk('a', '雇主责任险', '雇主责任险 工伤', await embed('雇主责任险 工伤')),
      chunk('b', '网络安全险', '网络安全险 数据', await embed('网络安全险 数据')),
    ];
    const store = new JsonVectorStore({ model: stub.model, dimensions: stub.dimensions, builtWith: stub.id, chunks });
    const res = store.query(await embed('随便查'), { topK: 5, insuranceLines: ['网络安全险'] });
    expect(res.map((r) => r.id)).toEqual(['b']);
  });

  it('topK 截断', async () => {
    const chunks = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => chunk(`k${i}`, '雇主责任险', `文本${i}`, await embed(`文本${i}`))),
    );
    const store = new JsonVectorStore({ model: stub.model, dimensions: stub.dimensions, builtWith: stub.id, chunks });
    expect(store.query(await embed('文本'), { topK: 2 })).toHaveLength(2);
  });
});
