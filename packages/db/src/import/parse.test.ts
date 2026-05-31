import { describe, it, expect } from 'vitest';
import { parseJobCode, excelToDate, levelNameFromLabel, categoryFromAccount } from './parse.js';

describe('parseJobCode', () => {
  it('D26NB048 -> Nutra Blend (NB beats N)', () => {
    const r = parseJobCode('D26NB048');
    expect(r.year).toBe(26);
    expect(r.customer_code).toBe('NB');
    expect(r.base_code).toBe('D26NB048');
    expect(r.billed_suffix).toBeNull();
  });
  it('D25D013.70 -> Diamond, suffix .70', () => {
    const r = parseJobCode('D25D013.70');
    expect(r.customer_code).toBe('D');
    expect(r.base_code).toBe('D25D013');
    expect(r.billed_suffix).toBe('70');
  });
  it('D24B001.01 -> Bagcraft', () => {
    const r = parseJobCode('D24B001.01');
    expect(r.customer_code).toBe('B');
    expect(r.base_code).toBe('D24B001');
    expect(r.billed_suffix).toBe('01');
  });
  it('D24MF001 -> unmapped MF (placeholder path)', () => {
    const r = parseJobCode('D24MF001');
    expect(r.customer_code).toBe('MF');
    expect(r.base_code).toBe('D24MF001');
  });
  it('D24SC001 -> Sugar Creek', () => {
    expect(parseJobCode('D24SC001').customer_code).toBe('SC');
  });
  it('longest-match: N vs NB when both present', () => {
    expect(parseJobCode('D26NB048', ['N', 'NB']).customer_code).toBe('NB');
    expect(parseJobCode('D26N048', ['N', 'NB']).customer_code).toBe('N');
  });
});

describe('excelToDate', () => {
  it('serial 45299 -> 2024-01-08', () => {
    expect(excelToDate(45299)).toBe('2024-01-08');
  });
  it('passes through a JS Date date-only', () => {
    expect(excelToDate(new Date(Date.UTC(2024, 0, 8, 13, 30)))).toBe('2024-01-08');
  });
  it('null/empty -> null', () => {
    expect(excelToDate(null)).toBeNull();
    expect(excelToDate('')).toBeNull();
  });
});

describe('levelNameFromLabel', () => {
  it('numeric -> Apprentice Yr N', () => expect(levelNameFromLabel('3')).toBe('Apprentice Yr 3'));
  it('Journeyman', () => expect(levelNameFromLabel('Journeyman')).toBe('Journeyman'));
  it('Foreman', () => expect(levelNameFromLabel('foreman')).toBe('Foreman'));
});

describe('categoryFromAccount', () => {
  it('5040 -> materials', () => expect(categoryFromAccount('5040 Job materials')).toEqual({ category: 'materials', fallback: false }));
  it('6250 -> equipment_rent', () => expect(categoryFromAccount('6250 Equipment rental')).toEqual({ category: 'equipment_rent', fallback: false }));
  it('unknown -> materials fallback', () => expect(categoryFromAccount('9999 Misc')).toEqual({ category: 'materials', fallback: true }));
});
