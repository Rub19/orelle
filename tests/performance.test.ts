import { describe, expect, it } from 'vitest';
import { isModestPc, resolvePerformance, tuning } from '../src/shared/performance';

const GB = 1024 ** 3;

describe('performance profile', () => {
  it('detects modest PCs by RAM or thread count', () => {
    expect(isModestPc(8 * GB, 8)).toBe(true);
    expect(isModestPc(4 * GB, 12)).toBe(true);
    expect(isModestPc(16 * GB, 4)).toBe(true);
    expect(isModestPc(16 * GB, 8)).toBe(false);
  });
  it('lets the user override the detection', () => {
    expect(resolvePerformance('auto', 4 * GB, 2)).toBe('light');
    expect(resolvePerformance('standard', 4 * GB, 2)).toBe('standard');
    expect(resolvePerformance('light', 64 * GB, 32)).toBe('light');
  });
  it('samples less often in light mode', () => {
    expect(tuning('light').statsInterval).toBeGreaterThan(tuning('standard').statsInterval);
    expect(tuning('light').buildFileIndexAtStart).toBe(false);
    expect(tuning('light').trimHiddenAfter).toBeLessThan(tuning('standard').trimHiddenAfter);
  });
});
