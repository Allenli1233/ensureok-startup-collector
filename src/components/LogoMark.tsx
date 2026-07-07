/**
 * LogoMark —— EnsureOK.ai 品牌标记(盾牌打勾描边),1:1 摘自主站 src/components/Icons.tsx。
 * 陶土橙 #D9743C 是「accent 仅用于 logo/图标」规范的允许例外,保留品牌色。
 */
import type { CSSProperties } from 'react';

interface BrandIconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const base = (): CSSProperties => ({ display: 'block', flexShrink: 0 });

export function LogoMark({ size = 24, className, style, title }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? 'EnsureOK.ai'}
      className={className}
      style={{ ...base(), ...style }}
    >
      <path
        d="M32 5l23 8v18c0 14.5-9.8 24.8-22.6 30a1.2 1.2 0 0 1-.9 0C18.8 55.8 9 45.5 9 31V13z"
        fill="none"
        stroke="#D9743C"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <path d="M21 32l8 8 14-16" fill="none" stroke="#D9743C" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default LogoMark;
