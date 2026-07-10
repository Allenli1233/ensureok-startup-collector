/**
 * 体检报告 · 纯数据模型层(无 React / DOM / 随机,同输入同输出,可单测)。
 *
 * 职责:把 ProposalItem[] 映射成 treemap 布局所需的分组 + 权重,并给出方块配色。
 * 契约(设计规格 §3.1):
 *   - 方块权重 weight = 紧迫度基权 × tier 系数。
 *   - 紧迫度基权:mandatory=100 · high=60 · advice=30。
 *   - tier 系数:tier1=1.4 · tier2=1.2 · tier3=1.0 · tier4=0.85。
 *   - 一级分组顺序固定:强制 → 高优先 → 建议;空组不产出。
 *
 * 配色(设计规格 §3.4):画布用品牌最深墨 #2A2622;方块按紧迫度取品牌「暖→冷」阶,
 * 明度随 qualityScore 微调(幅度很小,保证白字对比仍达 WCAG AA)。
 */
import type { GapUrgency, Portfolio, ProposalItem, ProposalTier } from './types';

// ─────────────────────────── 权重 ───────────────────────────

export const URGENCY_BASE: Record<GapUrgency, number> = {
  mandatory: 100,
  high: 60,
  advice: 30,
};

export const TIER_MULT: Record<ProposalTier, number> = {
  tier1: 1.4,
  tier2: 1.2,
  tier3: 1.0,
  tier4: 0.85,
};

/** 单个险种的 treemap 权重(面积 ∝ 权重)。字段缺失时退回中性默认,永不返回 0/NaN。 */
export function itemWeight(item: Pick<ProposalItem, 'urgency' | 'tier'>): number {
  const base = URGENCY_BASE[item.urgency] ?? URGENCY_BASE.advice;
  const mult = TIER_MULT[item.tier] ?? 1;
  return base * mult;
}

// ─────────────────────────── 分组 ───────────────────────────

/** 一级分组固定顺序:强制 → 高优先 → 建议 */
export const URGENCY_ORDER: GapUrgency[] = ['mandatory', 'high', 'advice'];

export interface UrgencyMeta {
  label: string;
  /** 对比表 / chips 用的前景色(浅底场景) */
  color: string;
  /** 对比表 / chips 用的浅底 */
  bg: string;
}

export const URGENCY_META: Record<GapUrgency, UrgencyMeta> = {
  mandatory: { label: '强制', color: '#b42318', bg: '#fef3f2' },
  high: { label: '高优先', color: '#b54708', bg: '#fffaeb' },
  advice: { label: '建议', color: '#5f574b', bg: '#f4f0ea' },
};

/** 报告分组结构(供 bentoLayout 展开成扁平序列;此层不依赖布局实现) */
export interface ReportGroup {
  key: GapUrgency;
  label: string;
  nodes: { id: string; weight: number }[];
}

/**
 * 把险种按紧迫度分组,产出 treemap 布局输入。
 * 分组顺序固定(强制/高优先/建议);空组不产出(§3.2)。node.id = lineId。
 */
export function buildReportGroups(items: ProposalItem[]): ReportGroup[] {
  const groups: ReportGroup[] = [];
  for (const key of URGENCY_ORDER) {
    const nodes = items
      .filter((it) => it.urgency === key)
      .map((it) => ({ id: it.lineId, weight: itemWeight(it) }));
    if (nodes.length > 0) {
      groups.push({ key, label: URGENCY_META[key].label, nodes });
    }
  }
  return groups;
}

// ─────────────────────────── 配色 ───────────────────────────

/** 暖→冷:强制赤陶暖橙(最饱和)→ 高优先陶土金 → 建议冷灰褐(最克制)。
 * 已核 WCAG:白字(#fbf6f0)对比在**基色及最亮微调后仍 ≥4.5:1**(base 5.1–5.6,最亮 4.8+)。 */
const BLOCK_FILL: Record<GapUrgency, string> = {
  mandatory: '#AC4B2E',
  high: '#856031',
  advice: '#68625A',
};

/** 微调锚点:高分向暖亮靠、低分向墨深靠(幅度很小) */
const LIGHTEN_TARGET = '#F0D8C6';
const DARKEN_TARGET = '#2A2622';

export interface BlockColor {
  /** 方块主填充 */
  fill: string;
  /** 光晕色(低透明度,用于 box-shadow) */
  glow: string;
}

/**
 * 方块配色。qualityScore 缺省时用基色;有分时以 75 分为中枢做 ±6% 明度微调,
 * 高分更暖亮、低分更克制,但始终保证白字可读。
 */
export function blockColor(urgency: GapUrgency, qualityScore?: number): BlockColor {
  const base = BLOCK_FILL[urgency] ?? BLOCK_FILL.advice;
  let fill = base;
  if (typeof qualityScore === 'number' && Number.isFinite(qualityScore)) {
    const t = clamp((qualityScore - 75) / 25, -1, 1) * 0.045; // ±4.5%(封顶:最亮微调后白字仍 ≥4.5:1)
    fill = t >= 0 ? mixHex(base, LIGHTEN_TARGET, t) : mixHex(base, DARKEN_TARGET, -t);
  }
  return { fill, glow: hexToRgba(fill, 0.42) };
}

// ─────────────────────────── 颜色工具(纯函数) ───────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 解析 #rrggbb → [r,g,b] */
export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/** 线性混合两色:t=0 得 a,t=1 得 b */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = clamp(t, 0, 1);
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return `#${[r, g, bl].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─────────────────────────── tier / 忠实度 / 可信度(展示数据) ───────────────────────────

export const TIER_LABEL: Record<ProposalTier, string> = {
  tier1: '合同/合规强制型',
  tier2: '高优先级',
  tier3: '建议关注',
  tier4: '品类共创',
};
export const TIER_COLOR: Record<ProposalTier, string> = {
  tier1: '#b42318',
  tier2: '#b54708',
  tier3: '#475467',
  tier4: '#6941c6',
};

/** 忠实度四态(icon+文字双编码,色盲友好) */
export const FAITH_META: Record<
  string,
  { icon: string; label: string; color: string; bg: string; title: string }
> = {
  entailed: { icon: '✓', label: '忠实', color: '#067647', bg: '#ecfdf3', title: '已核对到条款原文支撑' },
  unverified: { icon: '⚠', label: '待核', color: '#b54708', bg: '#fffaeb', title: '待持牌顾问核对确认,并非错误' },
  'not-supported': { icon: '✗', label: '无支撑', color: '#b42318', bg: '#fef3f2', title: '暂未检索到条款支撑,已交顾问复核' },
  contradicted: { icon: '✗', label: '讲反', color: '#b42318', bg: '#fef3f2', title: '与条款原文不一致(讲反了),已交顾问复核' },
};

/** 可信度分档(信任信号,不排名):≥85 高 / ≥70 中 / 其余 低 */
export function trustLevel(score: number): { label: string; color: string; bg: string; border: string } {
  if (score >= 85) return { label: '高', color: '#067647', bg: '#ecfdf3', border: '#abefc6' };
  if (score >= 70) return { label: '中', color: '#b54708', bg: '#fffaeb', border: '#fedf89' };
  return { label: '低', color: '#b42318', bg: '#fef3f2', border: '#fecdca' };
}

/** 组合角色:该险种在 portfolio.bundles / overlaps 里扮演的角色(按险种名匹配),无则 '—' */
export function portfolioRole(item: ProposalItem, portfolio?: Portfolio): string {
  if (!portfolio) return '—';
  const roles: string[] = [];
  for (const b of portfolio.bundles ?? []) {
    if (b.lines.includes(item.lineName)) roles.push(`组合包·${b.name}`);
  }
  for (const o of portfolio.overlaps ?? []) {
    if (o.lines.includes(item.lineName)) roles.push('有重叠');
  }
  return roles.length ? roles.join(' / ') : '—';
}
