import { describe, expect, it, vi } from 'vitest';
import { askReportQuestion, CHAT_UNAVAILABLE } from './useReportChat';

/** 造一个可断言调用的 fetch mock */
function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('askReportQuestion — 报告解读单轮请求', () => {
  it('成功:透传 answer / refused / disclaimer', async () => {
    const { fn, calls } = mockFetch(() => ({
      ok: true,
      json: async () => ({ answer: '这份报告里最紧迫的是…', refused: false, disclaimer: '本回答不构成投保建议。' }),
    }));
    const r = await askReportQuestion('task-1', 'report', '哪项最紧迫?', fn);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.answer).toContain('最紧迫');
      expect(r.refused).toBe(false);
      expect(r.disclaimer).toContain('不构成投保建议');
    }
    // 请求打到正确端点、body 带 scope + question
    expect(calls[0].url).toContain('/agent/proposals/task-1/chat');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ scope: 'report', question: '哪项最紧迫?' });
  });

  it('婉拒态如实透传(refused=true)', async () => {
    const { fn } = mockFetch(() => ({
      ok: true,
      json: async () => ({ answer: '这超出本次报告范围,建议由持牌经纪评估。', refused: true, disclaimer: '' }),
    }));
    const r = await askReportQuestion('t', 'line_x', '能赔多少钱?', fn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.refused).toBe(true);
  });

  it('scope 支持任意 lineId', async () => {
    const { fn, calls } = mockFetch(() => ({ ok: true, json: async () => ({ answer: 'a', refused: false, disclaimer: '' }) }));
    await askReportQuestion('t', 'mock_0', '这个险种保什么?', fn);
    expect(JSON.parse(String(calls[0].init?.body)).scope).toBe('mock_0');
  });

  it('缺 taskId → 优雅降级为「暂不可用」,且不发请求', async () => {
    const spy = vi.fn();
    const r = await askReportQuestion(undefined, 'report', '你好', spy as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(CHAT_UNAVAILABLE);
    expect(spy).not.toHaveBeenCalled();
  });

  it('空问题 → 提示,不发请求', async () => {
    const spy = vi.fn();
    const r = await askReportQuestion('t', 'report', '   ', spy as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('请输入问题');
    expect(spy).not.toHaveBeenCalled();
  });

  it('后端非 2xx(如报告过期 404)→ 优雅降级,不崩', async () => {
    const { fn } = mockFetch(() => ({ ok: false, status: 404, json: async () => ({ error: {} }) }));
    const r = await askReportQuestion('t', 'report', 'x', fn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(CHAT_UNAVAILABLE);
  });

  it('网络异常(fetch throw)→ 优雅降级,不抛错', async () => {
    const fn = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const r = await askReportQuestion('t', 'report', 'x', fn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(CHAT_UNAVAILABLE);
  });

  it('返回体缺 answer 字段 → 视为不可用', async () => {
    const { fn } = mockFetch(() => ({ ok: true, json: async () => ({ refused: false }) }));
    const r = await askReportQuestion('t', 'report', 'x', fn);
    expect(r.ok).toBe(false);
  });
});
