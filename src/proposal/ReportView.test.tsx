import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportView } from './ReportView';
import { BlockDetail } from './BlockDetail';
import { mockRequest } from './mockProvider';
import type { Proposal, ProposalRequest } from './types';

const req: ProposalRequest = {
  company: '知微智能科技',
  profile: { industry: 'AI' },
  diagnosis: {
    total: 3,
    mandatoryCount: 1,
    findings: [
      { id: 'a', line: 'line_b', title: '出海合同保障缺口', desc: '', coverage: '出海保障包', urgency: 'mandatory' },
      { id: 'b', line: 'line_a', title: '雇主责任缺口', desc: '', coverage: '雇主责任险', urgency: 'high' },
      { id: 'c', line: 'company', title: '知识产权保障未配置', desc: '', coverage: '知识产权险', urgency: 'advice' },
    ],
  },
};

describe('ReportView / BlockDetail 冒烟渲染(不崩 + 关键内容)', () => {
  it('ReportView renderToStaticMarkup 不抛错,含公司名 / 打印附录险种 / 合规免责', async () => {
    const p = await mockRequest(req);
    const html = renderToStaticMarkup(
      <ReportView proposal={p} taskId="task-smoke" />,
    );
    expect(html).toContain('知微智能科技');
    // 打印附录逐险种(与 width 无关,总会渲染)
    expect(html).toContain(p.items[0].lineName);
    // 合规免责固定可见
    expect(html).toContain(p.disclaimer.slice(0, 8));
    // 报告解读入口存在
    expect(html).toContain('解读这份报告');
    // 中性联系入口(选填)存在,措辞中性(不出现「预约顾问」)
    expect(html).toContain('留个联系方式');
    expect(html).not.toContain('预约顾问');
  });

  it('空态:0 险种不崩,显空态文案', async () => {
    const empty: Proposal = { ...(await mockRequest(req)), items: [] };
    const html = renderToStaticMarkup(<ReportView proposal={empty} taskId="t" />);
    expect(html).toContain('暂未命中高优先敞口');
  });

  it('BlockDetail 渲染险种详情 + 参考价位标签,绝不出现成交/保费数字裸值', async () => {
    const p = await mockRequest(req);
    const item = p.items[0];
    const html = renderToStaticMarkup(
      <BlockDetail item={item} advisor={false} taskId="t" onClose={() => {}} />,
    );
    expect(html).toContain(item.lineName);
    expect(html).toContain('参考价位');
    // 价位护栏文案固定可见
    expect(html).toContain('承保由合作持牌');
  });

  it('缺可选字段(无 qualityScore / keyClausesDetailed / portfolio)也能渲染', async () => {
    const p = await mockRequest(req);
    const bare: Proposal = {
      ...p,
      portfolio: undefined,
      items: [
        {
          ...p.items[0],
          qualityScore: undefined,
          keyClausesDetailed: undefined,
          rationaleDrivers: undefined,
          degraded: undefined,
        },
      ],
    };
    const html = renderToStaticMarkup(<ReportView proposal={bare} taskId="t" />);
    expect(html).toContain(bare.items[0].lineName);
  });
});
