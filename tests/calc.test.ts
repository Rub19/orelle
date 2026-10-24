import { describe, expect, it } from 'vitest';
import { evaluate, formatNumber, looksLikeMath } from '../src/shared/calc';

describe('calculator', () => {
  it('respects precedence and parentheses', () => {
    expect(evaluate('2+2*3')).toBe(8);
    expect(evaluate('(2+2)*3')).toBe(12);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('10 % 4')).toBe(2);
  });

  it('supports functions, constants and implicit multiplication', () => {
    expect(evaluate('sqrt(16) + abs(-2)')).toBe(6);
    expect(evaluate('2pi')).toBeCloseTo(2 * Math.PI);
    expect(evaluate('3(4+1)')).toBe(15);
    expect(evaluate('max(1, 7, 3)')).toBe(7);
  });

  it('accepts French decimal commas and ×/÷', () => {
    expect(evaluate('3,5 + 1')).toBe(4.5);
    expect(evaluate('6 × 7')).toBe(42);
    expect(evaluate('9 ÷ 3')).toBe(3);
  });

  it('rejects anything that is not arithmetic (no code execution)', () => {
    expect(evaluate('process.exit()')).toBeNull();
    expect(evaluate('alert(1)')).toBeNull();
    expect(evaluate('2 +')).toBeNull();
    expect(evaluate('1/0')).toBeNull();
    expect(evaluate('')).toBeNull();
  });

  it('only triggers on math-looking input', () => {
    expect(looksLikeMath('2+2')).toBe(true);
    expect(looksLikeMath('sqrt(2)')).toBe(true);
    expect(looksLikeMath('chrome')).toBe(false);
    expect(looksLikeMath('2024')).toBe(false);
  });

  it('formats numbers for display', () => {
    expect(formatNumber(1234567, 'en-US')).toBe('1,234,567');
    expect(formatNumber(0.1 + 0.2, 'en-US')).toBe('0.3');
  });
});
