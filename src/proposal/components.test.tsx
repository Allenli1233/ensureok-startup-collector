/**
 * 报告动效组件冒烟测试(jsdom)。
 * 验证:渲染不抛错、可访问性(aria)、无 WebGL/IntersectionObserver 时的优雅降级。
 * 不测动画时序(spring/rAF 与真实排版无法在 jsdom 精确断言),只保证契约与降级。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NumberTicker } from './NumberTicker';
import { BlurInText } from './BlurInText';
import { RippleField } from './RippleField';

describe('NumberTicker', () => {
  it('渲染 span,不抛错', () => {
    const { container } = render(<NumberTicker value={3} />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('无 IntersectionObserver 触发(屏外)→ 直接显终值,不停在起始 0', () => {
    // 测试环境的 IO 兜底不 fire,inView 恒 false;修复后应显终值而非 0(可信度不误显 0)
    const { container } = render(<NumberTicker value={94} />);
    expect(container.textContent).toContain('94');
    expect(container.textContent).not.toBe('0');
  });
});

describe('BlurInText', () => {
  it('容器 aria-label 为完整文本(屏幕阅读器只读一次)', () => {
    const { getByLabelText } = render(<BlurInText as="p" text="保障体检报告" by="char" />);
    expect(getByLabelText('保障体检报告')).toBeTruthy();
  });

  it('渲染全部文本内容', () => {
    const { container } = render(<BlurInText as="span" text="出海保障" by="word" />);
    expect(container.textContent).toBe('出海保障');
  });
});

describe('RippleField', () => {
  it('jsdom 无 WebGL context → try/catch 静默降级,渲染不抛错', () => {
    expect(() => render(<RippleField />)).not.toThrow();
  });

  it('非 reduced-motion 下渲染 canvas 元素', () => {
    const { container } = render(<RippleField />);
    // matchMedia 兜底 matches:false → 非 reduced → 渲染 <canvas>(即便 GL 不可用也降级为空 canvas)
    expect(container.querySelector('canvas.rp-ripple-canvas')).toBeTruthy();
  });
});
