/**
 * BlurInText —— 文字按阅读顺序模糊浮现。
 * 移植自 Magic UI(MIT,magicui.design 的 TextAnimate blurInUp / BlurIn),
 * 改用 motion/react + 本项目 CSS,无 Tailwind、无新依赖。
 *
 * 每段(逐词 / 逐字 / 逐行)从 opacity0 + blur(8px) + translateY↑ → 清晰,
 * stagger 40–70ms,强 ease-out [0.22,1,0.36,1]。
 * 无障碍:整体文本挂在容器 aria-label,分段 aria-hidden,屏幕阅读器只读一次完整文本。
 * prefers-reduced-motion:不切段、不 blur/位移,整体一次性淡入(≤0.2s)。
 */
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

type AsTag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
type By = 'word' | 'char' | 'line';

export interface BlurInTextProps {
  text: string;
  as?: AsTag;
  by?: By;
  /** 首段延迟(秒),用于按阅读顺序编排 */
  startDelay?: number;
  /** 段间隔(秒),40–70ms */
  stagger?: number;
  className?: string;
}

/** 把文本按 by 切段,保留空格 / 换行,便于原样拼回。 */
function segment(text: string, by: By): string[] {
  if (by === 'char') return Array.from(text);
  if (by === 'line') return text.split('\n');
  // word:每段 = 词 + 其后的空白,inline-block + white-space:pre 保住词间距
  return text.match(/\S+\s*/g) ?? [text];
}

export function BlurInText({
  text,
  as = 'span',
  by = 'word',
  startDelay = 0,
  stagger = 0.05,
  className,
}: BlurInTextProps): React.ReactElement {
  const reduce = useReducedMotion();
  // motion[as] 在类型上较宽松,这里以 any 索引取对应 motion 元素
  const MotionTag = (motion as unknown as Record<AsTag, React.ElementType>)[as];

  if (reduce) {
    return (
      <MotionTag
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: EASE_OUT, delay: startDelay }}
      >
        {text}
      </MotionTag>
    );
  }

  const segs = segment(text, by);
  const display = by === 'line' ? 'block' : 'inline-block';

  return (
    <MotionTag className={className} aria-label={text}>
      {segs.map((seg, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          style={{ display, whiteSpace: 'pre' }}
          initial={{ opacity: 0, filter: 'blur(8px)', y: 8 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: startDelay + i * stagger }}
        >
          {seg}
        </motion.span>
      ))}
    </MotionTag>
  );
}
