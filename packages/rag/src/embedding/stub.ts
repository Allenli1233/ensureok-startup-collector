import type { EmbeddingProvider } from '../types';

/**
 * 离线确定性桩嵌入(无需 key,供开发与单测)。
 * 用字符二元组(bigram)散列成 64 维词袋并归一化:共享子串越多的文本向量越接近,
 * 因此检索的『相关文本排更前』这一机制可被确定性地验证(非真实语义质量)。
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'stub';
  readonly model = 'stub-bigram-64';
  readonly dimensions = 64;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const s = text.toLowerCase();
    for (let i = 0; i < s.length; i++) {
      const bigram = s.charCodeAt(i) * 31 + (s.charCodeAt(i + 1) || 0);
      v[((bigram % this.dimensions) + this.dimensions) % this.dimensions] += 1;
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return v.map((x) => x / norm);
  }
}
