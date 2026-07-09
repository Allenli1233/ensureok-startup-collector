import { describe, it, expect } from 'vitest';
import { getPriceTables, getInsurers } from './catalogData';

describe('catalogData', () => {
  it('按 lineId 取到有价目表险种的价格表', () => {
    const tables = getPriceTables('employer_liability');
    expect(tables.length).toBeGreaterThan(0);
    // 每张表结构完整:有表头列与至少一行数据
    for (const t of tables) {
      expect(Array.isArray(t.columns)).toBe(true);
      expect(t.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(t.rows)).toBe(true);
      expect(t.rows.length).toBeGreaterThan(0);
      expect(Array.isArray(t.contextPath)).toBe(true);
    }
  });

  it('取到的表确实是价格表(含金额/费率数字)', () => {
    const tables = getPriceTables('group_accident');
    expect(tables.length).toBeGreaterThan(0);
    const hasMoney = tables.some((t) =>
      t.rows.some((row) => row.some((cell) => /[¥$元万%]|费率|保费/.test(cell))),
    );
    expect(hasMoney).toBe(true);
  });

  it('无公开价目表的险种(ai_liability)返回空数组,不报错', () => {
    expect(getPriceTables('ai_liability')).toEqual([]);
  });

  it('未知 lineId 返回空数组', () => {
    expect(getPriceTables('__not_a_real_line__')).toEqual([]);
    expect(getInsurers('__not_a_real_line__')).toEqual([]);
  });

  it('getInsurers 取到该险种保司清单', () => {
    const insurers = getInsurers('directors_officers');
    expect(insurers.length).toBeGreaterThan(0);
    expect(insurers).toContain('平安');
  });
});
