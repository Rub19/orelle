import { describe, expect, it } from 'vitest';
import { breadcrumbs, dateBucket, fileKind, filterEntries, groupEntries, isArchive, parentDir, sortEntries } from '../src/shared/filesModel';

const f = (name: string, extra: Partial<{ dir: boolean; size: number; mtime: number; hidden: boolean }> = {}) => ({
  name, path: `C:\\x\\${name}`, dir: !!extra.dir, size: extra.size ?? 0, mtime: extra.mtime ?? 0, ext: extra.dir ? '' : (name.split('.').pop() ?? '').toLowerCase(), hidden: !!extra.hidden,
});

describe('files model', () => {
  it('classifies kinds and archives', () => {
    expect(fileKind(f('a.PNG'))).toBe('image');
    expect(fileKind(f('b.docx'))).toBe('document');
    expect(fileKind(f('c', { dir: true }))).toBe('folder');
    expect(fileKind(f('d.xyz'))).toBe('other');
    expect(isArchive(f('e.tar.gz'))).toBe(true);
    expect(isArchive(f('e.txt'))).toBe(false);
  });

  it('sorts folders first with natural name order', () => {
    const list = [f('file10.txt'), f('file2.txt'), f('zeta', { dir: true }), f('alpha', { dir: true })];
    expect(sortEntries(list, 'name', false).map((x) => x.name)).toEqual(['alpha', 'zeta', 'file2.txt', 'file10.txt']);
    expect(sortEntries(list, 'name', true).map((x) => x.name)).toEqual(['zeta', 'alpha', 'file10.txt', 'file2.txt']);
  });

  it('sorts by size and date', () => {
    const list = [f('a.txt', { size: 5, mtime: 3 }), f('b.txt', { size: 50, mtime: 1 })];
    expect(sortEntries(list, 'size', true)[0].name).toBe('b.txt');
    expect(sortEntries(list, 'mtime', false)[0].name).toBe('b.txt');
  });

  it('groups by date bucket in chronological order', () => {
    const now = new Date(2026, 9, 24, 12).getTime();
    expect(dateBucket(now - 3600_000, now)).toBe('today');
    expect(dateBucket(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(dateBucket(now - 400 * 86400_000, now)).toBe('older');
    const groups = groupEntries([f('old.txt', { mtime: now - 400 * 86400_000 }), f('new.txt', { mtime: now })], 'date', now);
    expect(groups.map((g) => g.key)).toEqual(['today', 'older']);
  });

  it('filters hidden files, kinds and text', () => {
    const list = [f('.git', { dir: true, hidden: true }), f('photo.jpg'), f('notes.md')];
    expect(filterEntries(list, { showHidden: false, kind: 'all', text: '' }).length).toBe(2);
    expect(filterEntries(list, { showHidden: true, kind: 'image', text: '' }).map((x) => x.name)).toEqual(['photo.jpg']);
    expect(filterEntries(list, { showHidden: true, kind: 'all', text: 'NOT' }).map((x) => x.name)).toEqual(['notes.md']);
  });

  it('builds breadcrumbs and parents for Windows paths', () => {
    expect(breadcrumbs('C:\\Users\\me\\Docs').map((c) => c.path)).toEqual(['C:\\', 'C:\\Users', 'C:\\Users\\me', 'C:\\Users\\me\\Docs']);
    expect(parentDir('C:\\Users\\me')).toBe('C:\\Users');
    expect(parentDir('C:\\Users')).toBe('C:\\');
    expect(parentDir('C:\\')).toBeNull();
  });
});
