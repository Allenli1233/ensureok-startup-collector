import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ReportPage } from './ReportPage';
import type { Proposal } from './types';

const proposal: Proposal = {
  meta: {
    documentName: '保障方案建议',
    company: '示例科技有限公司',
    generatedAt: '2026-07-13T00:00:00.000Z',
    engine: 'test',
    llmModel: 'test',
    ragModel: 'test',
  },
  clientSummary: '科技企业，存在数据与雇佣相关风险。',
  disclaimer: '方向性风险建议，不构成成交报价。',
  items: [
    {
      lineId: 'cyber',
      lineName: '网络安全险',
      urgency: 'mandatory',
      tier: 'tier1',
      gapTitles: ['敏感数据泄露责任', '系统中断损失'],
      coverageDirection: '覆盖数据泄露、网络攻击和业务中断造成的第一方损失及第三方责任。',
      rationale: '贵司处理客户数据并依赖在线系统持续提供服务，网络事件会直接影响收入与客户责任。',
      keyClauses: ['核对数据泄露响应费用', '核对业务中断等待期'],
      recommendedProducts: [
        { insurer: '示例保司', sourceFile: 'test' },
        { insurer: '第二保司', sourceFile: 'test', matchReason: '适合线上业务场景' },
      ],
      pricing: { display: '约 ¥8,000-20,000 / 年', disclaimer: '以保司实际报价为准', unavailable: false },
      drilldownSourceFile: null,
      citations: [],
      evidenceInsufficient: false,
      qualityScore: 92,
    },
  ],
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null });
});

describe('ReportPage risk heatmap', () => {
  it('一级卡片完整展示风险、公司关联和价格，二级页逐项覆盖详情', () => {
    const { container } = render(
      <ReportPage
        state={{ status: 'ready', proposal, taskId: 'test-task' }}
        onClose={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getAllByText('网络安全险').length).toBeGreaterThan(0);
    expect(screen.getByText('有什么风险')).toBeTruthy();
    expect(screen.getByText('为什么和你有关')).toBeTruthy();
    expect(screen.getByText('建议怎么处理')).toBeTruthy();
    expect(screen.getByText('大概要多少钱')).toBeTruthy();
    expect(screen.getAllByText('约 ¥8,000-20,000 / 年').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('贵司处理客户数据');
    expect(document.body.textContent).not.toContain('可信度');

    fireEvent.click(screen.getByRole('button', { name: /网络安全险.*查看详情/ }));
    expect(screen.getByRole('dialog', { name: '网络安全险风险详情' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '为什么与 示例科技有限公司 有关' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '风险详细解释' })).toBeTruthy();
    expect(screen.getAllByText('敏感数据泄露责任').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('系统中断损失').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: '公司关联' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '风险详解' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '保障与价格' })).toBeTruthy();
    expect(screen.getByText('第二保司')).toBeTruthy();
  });

  it('二级页使用明确的高对比配色，不继承全局浅色主题变量', () => {
    const css = readFileSync('src/proposal/report.css', 'utf8');
    const detailCss = css.slice(css.lastIndexOf('/* 二级页面'));
    expect(detailCss).toContain('background: #a9482d;');
    expect(detailCss).toContain('background: #f4eee7;');
    expect(detailCss).toContain('color: #fffaf4;');
    expect(detailCss).toContain('color: #2a231e;');
  });
});
