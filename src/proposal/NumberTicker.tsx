/**
 * NumberTicker —— 数字向上滚动浮现(count-up + 轻微上浮)。
 * 移植自 Magic UI(MIT,magicui.design 的 NumberTicker),改用 motion/react + 本项目 CSS,
 * 无 Tailwind、无新依赖。useInView 进入视口触发,spring count-up;订阅 motion value 写 ref.textContent。
 *
 * 合规红线:**只用于非金额数字**(可信度分 / 诊断缺口 N / 险种计数),
 *          绝不包裹 pricing.* 或任何金额 / 保费 / 保额。
 * prefers-reduced-motion:直接渲染终值,无 count-up、无上浮。
 */
import { animate, motion, useInView, useMotionValue, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useEffect, useRef } from 'react';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export interface NumberTickerProps {
  value: number;
  start?: number;
  decimals?: number;
  className?: string;
}

export function NumberTicker({
  value,
  start = 0,
  decimals = 0,
  className,
}: NumberTickerProps): React.ReactElement {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const mv = useMotionValue(start);
  // 首帧是否已在视口:决定是否播 count-up。屏外的数字直接显终值(不能停在 start,
  // 否则可信度等会误显 0/起始值);滚动进来的屏外数字只补终值、不倒退闪一下。
  const rollOnMount = useRef<boolean | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = value.toFixed(decimals);
      return;
    }
    if (rollOnMount.current === null) rollOnMount.current = inView; // 记录挂载时是否可见
    if (!inView || !rollOnMount.current) {
      // 屏外(或挂载时屏外、之后才滚入)→ 直接显终值,不倒退、不误显起始值
      el.textContent = value.toFixed(decimals);
      return;
    }
    const controls = animate(mv, value, { type: 'spring', stiffness: 90, damping: 20, mass: 0.8 });
    const unsub = mv.on('change', (v) => {
      el.textContent = v.toFixed(decimals);
    });
    return () => {
      controls.stop();
      unsub();
    };
  }, [inView, value, reduce, decimals, mv]);

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums', display: 'inline-block' }}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      {(reduce ? value : start).toFixed(decimals)}
    </motion.span>
  );
}
