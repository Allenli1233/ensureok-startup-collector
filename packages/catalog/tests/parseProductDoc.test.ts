import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProductDoc } from '../src/parseProductDoc';
import { identifyInsurers } from '../src/markdown';

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, 'fixtures/employer-sample.md'), 'utf8');
const cat = parseProductDoc({
  lineId: 'employer_liability',
  lineName: '雇主责任险',
  sourceFile: 'fixtures/employer-sample.md',
  markdown: md,
});

describe('parseProductDoc', () => {
  it('解析一级标题', () => {
    expect(cat.title).toBe('雇主责任险产品数据');
  });

  it('解析头部元信息', () => {
    expect(cat.meta.collectedAt).toBe('2026年7月9日');
    expect(cat.meta.sources).toEqual(['各保险公司官网', '沃保网', '行业公开数据']);
    expect(cat.meta.applicableScenario).toContain('国内企业');
  });

  it('meta 不被文末/其它章节干扰(只扫到首条分割线)', () => {
    expect(cat.meta.sources).not.toContain('44%');
  });

  it('切出章节树', () => {
    const headings = cat.sections.map((s) => s.heading);
    expect(headings).toContain('一、产品概述');
    expect(headings).toContain('二、主要保险公司产品对比');
    expect(headings).toContain('2.1 中国人保雇主责任险（全国版）');
  });

  it('章节路径体现层级', () => {
    const s = cat.sections.find((x) => x.heading.startsWith('2.1'));
    expect(s?.path).toEqual(['二、主要保险公司产品对比', '2.1 中国人保雇主责任险（全国版）']);
  });

  it('金额表被正确解析且标记为价格表', () => {
    const priceTables = cat.sections.flatMap((s) => s.tables).filter((t) => t.isPriceTable);
    expect(priceTables.length).toBe(2); // 人保表 + 平安表
    const renbao = priceTables.find((t) => t.contextPath.some((p) => p.includes('人保')));
    expect(renbao).toBeTruthy();
    expect(renbao!.columns).toEqual(['职业类别', '10万保额', '30万保额', '50万保额']);
    expect(renbao!.rows[0]).toEqual(['1-2类（办公室/文职）', '93元', '240元', '366元']);
  });

  it('非金额表(市场渗透率 44%)不标记为价格表', () => {
    const pen = cat.sections.find((s) => s.heading.includes('市场渗透率'));
    expect(pen?.tables[0].isPriceTable).toBe(false);
  });

  it('概述信息表不标记为价格表', () => {
    const overview = cat.sections.find((s) => s.heading.includes('产品概述'));
    expect(overview?.tables[0].isPriceTable).toBe(false);
  });

  it('识别保司(去重:中国人保吸收人保)', () => {
    expect(cat.insurers).toContain('平安');
    expect(cat.insurers).toContain('中国人保');
    expect(cat.insurers).not.toContain('人保'); // 被更长的「中国人保」吸收
  });

  it('hasPriceTable/priceTableCount 正确', () => {
    expect(cat.hasPriceTable).toBe(true);
    expect(cat.priceTableCount).toBe(2);
  });
});

describe('identifyInsurers', () => {
  it('长名吸收子串', () => {
    expect(identifyInsurers('中国人保与平安承保')).toEqual(['中国人保', '平安']);
  });
  it('无匹配返回空', () => {
    expect(identifyInsurers('某不知名互助计划')).toEqual([]);
  });
});
