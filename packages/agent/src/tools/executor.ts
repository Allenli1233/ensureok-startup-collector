import type { InsuranceLineId } from '@ensureok/catalog';
import { checkCompliance } from './checkCompliance';
import { computePricing } from './computePricing';
import { queryCatalog } from './queryCatalog';
import { retrieveClauses } from './retrieveClauses';
import { err, type ToolContext, type ToolErr, type ToolResult } from './types';

export type ToolInvoker = (name: string, argsJson: string) => Promise<ToolResult<unknown>>;

/**
 * 工具执行器:把 LLM 的 tool_call 路由到 tool-core。
 * pipeline 护栏:①险种钉死 ctx.lineScope,LLM 传别的 lineId → line-scope-violation 拒绝(H3);
 * ②compute_pricing 结果对 LLM 脱敏,不给任何金额(C1)。失败返回结构化 error,不抛。
 */
export function createToolExecutor(ctx: ToolContext): ToolInvoker {
  const scopedLineId = (): InsuranceLineId | undefined => (ctx.audience === 'pipeline' ? ctx.lineScope : undefined);

  const scopeViolation = (argLineId: unknown): ToolErr | null => {
    if (ctx.audience === 'pipeline' && typeof argLineId === 'string' && ctx.lineScope && argLineId !== ctx.lineScope) {
      return err('line-scope-violation', `越权:当前 worker 险种 ${ctx.lineScope},工具却请求 ${argLineId}`);
    }
    return null;
  };

  return async (name, argsJson) => {
    let args: Record<string, unknown>;
    try {
      args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      return err('bad-args', 'tool arguments 非法 JSON');
    }

    switch (name) {
      case 'query_catalog': {
        const v = scopeViolation(args.lineId);
        if (v) return v;
        const lineId = scopedLineId() ?? (args.lineId as InsuranceLineId | undefined);
        if (!lineId) return err('bad-args', '缺 lineId');
        return queryCatalog({ lineId }, ctx);
      }

      case 'compute_pricing': {
        const v = scopeViolation(args.lineId);
        if (v) return v;
        const lineId = scopedLineId() ?? (args.lineId as InsuranceLineId | undefined);
        if (!lineId) return err('bad-args', '缺 lineId');
        const r = computePricing({ lineId }, ctx);
        if (r.ok && ctx.audience === 'pipeline') {
          return {
            ok: true,
            data: {
              lineId: r.data.lineId,
              matchTier: r.data.matchTier,
              available: !r.data.unavailableReason,
              note: '价位已由系统按产品库确定,将在最终方案组装;你无需也不得书写任何金额数字。',
            },
          };
        }
        return r;
      }

      case 'retrieve_clauses': {
        const v = scopeViolation(args.lineId);
        if (v) return v;
        const scopedName = ctx.audience === 'pipeline' && ctx.lineScope ? ctx.catalogs.get(ctx.lineScope)?.lineName : undefined;
        const lineName = scopedName ?? (args.lineName as string | undefined);
        if (!lineName) return err('bad-args', '缺 lineName');
        return retrieveClauses(
          {
            lineName,
            query: String(args.query ?? ''),
            topK: typeof args.topK === 'number' ? args.topK : undefined,
            docCategories: Array.isArray(args.docCategories) ? (args.docCategories as string[]) : undefined,
          },
          ctx,
        );
      }

      case 'check_compliance':
        return checkCompliance({ text: String(args.text ?? '') });

      default:
        return err('unknown-tool', `未知工具: ${name}`);
    }
  };
}
