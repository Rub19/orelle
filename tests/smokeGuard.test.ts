import { describe, expect, it } from 'vitest';
import { hasOtherOrelleSurface, isOrelleSurfaceTitle } from '../src/main/smokeGuard';

describe('smoke instance guard', () => {
  it('recognizes Orelle surfaces only', () => {
    expect(isOrelleSurfaceTitle('Orelle Dock')).toBe(true);
    expect(isOrelleSurfaceTitle('Orelle Top Bar')).toBe(true);
    expect(isOrelleSurfaceTitle('Orelle Preferences')).toBe(false);
    expect(isOrelleSurfaceTitle('Windows Taskbar')).toBe(false);
  });

  it('ignores the current process and detects another Orelle surface', () => {
    const windows = [
      { pid: 42, title: 'Orelle Dock' },
      { pid: 99, title: 'Orelle Top Bar' },
      { pid: 101, title: 'Orelle Preferences' },
    ];
    expect(hasOtherOrelleSurface(windows, 42)).toBe(true);
    expect(hasOtherOrelleSurface(windows, 99)).toBe(true);
    expect(hasOtherOrelleSurface(windows, 7)).toBe(true);
    expect(hasOtherOrelleSurface([{ pid: 42, title: 'Orelle Dock' }], 42)).toBe(false);
  });
});
