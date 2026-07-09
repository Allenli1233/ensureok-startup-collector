import type { ToolDef } from '../llm/types';

/**
 * 生成 pipeline 内(对内)暴露给 LLM 的工具定义。
 * 险种(lineId/lineName)由 worker 钉死、不作为 LLM 参数(越权护栏 H3);
 * compute_pricing 只回 matchTier/available,数值对 LLM 脱敏(C1)。
 */
export const PIPELINE_TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'query_catalog',
      description: '取当前险种在产品库里的承保方(保司)清单与产品库元信息。不含价格数字。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retrieve_clauses',
      description: '从条款/资料库检索当前险种的条款、保障范围、责任免除、案例等证据(条款只信这里)。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索意图,如 "保险责任 保障范围"、"责任免除"、"理赔实务"' },
          docCategories: {
            type: 'array',
            items: { type: 'string' },
            description: '可选:限定资料类别(法律法规/实务指南/司法案例/行业报告/学术文献/政策文件/总览)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compute_pricing',
      description:
        '让系统按产品库确定当前险种的参考价位。返回是否可得与匹配档位;具体金额由系统在最终方案组装,你不会看到也不得书写任何金额数字。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_compliance',
      description: '把你打算写入方案的一段文本交给合规检查,返回是否含红线(保费金额/招揽CTA/监管强制暗示/指名保司报价)。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '待检查的方案文本' } },
        required: ['text'],
      },
    },
  },
];
