import { describe, expect, it } from 'vitest';
import { convert } from '../src/shared/units';

describe('unit conversions', () => {
  it('converts lengths in French and English syntax', () => {
    expect(convert('10 km en mi')!.result).toBeCloseTo(6.2137, 3);
    expect(convert('5 ft to m')!.result).toBeCloseTo(1.524, 3);
    expect(convert('12 pouces en cm')!.result).toBeCloseTo(30.48, 2);
  });

  it('converts temperatures', () => {
    expect(convert('100 c to f')!.result).toBeCloseTo(212);
    expect(convert('72 f en c')!.result).toBeCloseTo(22.22, 2);
    expect(convert('0 c to k')!.result).toBeCloseTo(273.15);
  });

  it('handles data sizes with octet aliases', () => {
    expect(convert('2 go en mo')!.result).toBe(2000);
    expect(convert('1 gib to mib')!.result).toBe(1024);
  });

  it('accepts expressions as the value', () => {
    expect(convert('2*3 kg to lb')!.result).toBeCloseTo(13.2277, 3);
  });

  it('refuses incompatible dimensions or garbage', () => {
    expect(convert('10 km en kg')).toBeNull();
    expect(convert('hello world')).toBeNull();
    expect(convert('10 parsecs en km')).toBeNull();
  });
});
