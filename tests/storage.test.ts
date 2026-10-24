import { describe, expect, it } from 'vitest';
import { isProtectedPath, pushLargest, sameSizeGroups } from '../src/shared/storageModel';

const env = {
  systemRoot: 'C:\\Windows',
  programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
  programData: 'C:\\ProgramData',
  userProfile: 'C:\\Users\\ana',
  appData: 'C:\\Users\\ana\\AppData\\Roaming',
  localAppData: 'C:\\Users\\ana\\AppData\\Local',
};

describe('storage safety', () => {
  it('protects system, program and profile roots', () => {
    for (const p of ['C:\\', 'D:', 'C:\\Windows\\System32\\x.dll', 'c:\\program files\\App\\a.exe', 'C:\\ProgramData\\x', 'C:\\Users\\ana', 'C:\\Users\\ana\\AppData\\Local', 'C:\\$Recycle.Bin\\x', 'relative\\path']) {
      expect(isProtectedPath(p, env), p).toBe(true);
    }
  });

  it('allows ordinary user files, including temp files under AppData', () => {
    for (const p of ['C:\\Users\\ana\\Downloads\\big.iso', 'C:\\Users\\ana\\AppData\\Local\\Temp\\x.tmp', 'D:\\Videos\\a.mp4', 'C:\\Windowsold\\x']) {
      expect(isProtectedPath(p, env), p).toBe(false);
    }
  });

  it('honours user exclusions', () => {
    expect(isProtectedPath('D:\\Photos\\2024\\a.jpg', env, ['D:\\Photos'])).toBe(true);
    expect(isProtectedPath('D:\\PhotosOld\\a.jpg', env, ['D:\\Photos'])).toBe(false);
  });
});

describe('duplicate candidates', () => {
  it('only groups files that share a size above the minimum', () => {
    const files = [{ size: 10 }, { size: 10 }, { size: 20 }, { size: 5 }, { size: 5 }, { size: 30 }, { size: 30 }, { size: 30 }];
    const groups = sameSizeGroups(files, 8);
    expect(groups.map((g) => g.length)).toEqual([3, 2]);
    expect(groups[0][0].size).toBe(30);
  });

  it('keeps the N largest items in order', () => {
    const list: { size: number }[] = [];
    for (const size of [5, 1, 9, 3, 7, 9, 2]) pushLargest(list, { size }, 3);
    expect(list.map((x) => x.size)).toEqual([9, 9, 7]);
  });
});
