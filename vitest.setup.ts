/**
 * vitest 全局 setup(jsdom 环境)。
 * jsdom 不实现 matchMedia / IntersectionObserver / ResizeObserver;
 * motion 的 useReducedMotion / useInView 与 RippleField/BlurInText/NumberTicker 依赖它们,
 * 这里给出无副作用的兜底实现,保证组件在测试里能渲染而不抛错。
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  class IOStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  if (typeof window.IntersectionObserver === 'undefined') {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IOStub;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IOStub;
  }

  class ROStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  if (typeof window.ResizeObserver === 'undefined') {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ROStub;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ROStub;
  }
}

afterEach(() => cleanup());
