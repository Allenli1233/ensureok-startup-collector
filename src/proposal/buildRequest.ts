import {
  COLLECTOR_QUESTIONS,
  OVERSEAS_COUNTRIES,
  type CollectorAnswers,
  type CollectorDiagnosis,
  type QuestionId,
} from '../config/startupProfileCollector';
import type { ProposalRequest } from './types';

function optionLabel(qid: QuestionId, value: string | undefined): string | undefined {
  if (!value) return undefined;
  return COLLECTOR_QUESTIONS.find((q) => q.id === qid)?.options.find((o) => o.value === value)?.label;
}

function overseasLabels(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((v) => OVERSEAS_COUNTRIES.find((c) => c.value === v)?.label ?? v);
}

export interface BuildProposalInput {
  company: string;
  answers: CollectorAnswers;
  industryOther?: string;
  diagnosis: CollectorDiagnosis;
}

/**
 * 表单状态 → Agent 输入契约。
 * ★ 硬约束:绝不带 PII(姓名/手机号/微信号)——只带公司抬头、脱敏画像与诊断缺口。
 */
export function buildProposalRequest(input: BuildProposalInput): ProposalRequest {
  const { answers, diagnosis } = input;
  const industryBase = optionLabel('industry', answers.industry);
  const industry =
    answers.industry === 'other' && input.industryOther?.trim() ? input.industryOther.trim() : industryBase;

  return {
    company: input.company.trim(),
    profile: {
      industry,
      headcount: optionLabel('headcount', answers.headcount),
      funding: optionLabel('funding', answers.funding),
      hasPatent: answers.patent === 'granted',
      overseasCountries: answers.b0 === 'yes' ? overseasLabels(answers.overseasCountries) : undefined,
    },
    diagnosis: {
      total: diagnosis.total,
      mandatoryCount: diagnosis.mandatoryCount,
      findings: diagnosis.findings.map((f) => ({
        id: f.id,
        line: f.line,
        title: f.title,
        desc: f.desc,
        coverage: f.coverage,
        urgency: f.urgency,
      })),
    },
  };
}
