import { describe, expect, it } from 'vitest';
import { fuzzyScore } from '../src/shared/fuzzy';

const rank = (q: string, items: string[]) => [...items].sort((a, b) => fuzzyScore(q, b) - fuzzyScore(q, a));

describe('fuzzy matching', () => {
  it('prefers exact > prefix > word start > substring > subsequence', () => {
    const exact = fuzzyScore('chrome', 'Chrome');
    const prefix = fuzzyScore('chr', 'Chrome');
    const word = fuzzyScore('code', 'Visual Studio Code');
    const inner = fuzzyScore('rom', 'Chrome');
    const subseq = fuzzyScore('crm', 'Chrome');
    expect(exact).toBe(1);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it('matches acronyms', () => {
    expect(rank('vsc', ['Vivaldi', 'Visual Studio Code', 'VLC media player'])[0]).toBe('Visual Studio Code');
  });

  it('ignores accents and case', () => {
    expect(fuzzyScore('parametres', 'Paramètres')).toBe(1);
    expect(fuzzyScore('TÉLÉ', 'Téléchargements')).toBeGreaterThan(0.9);
  });

  it('requires every token of a multi-word query', () => {
    expect(fuzzyScore('studio code', 'Visual Studio Code')).toBeGreaterThan(0.5);
    expect(fuzzyScore('studio xyz', 'Visual Studio Code')).toBe(0);
  });

  it('returns 0 when characters are missing', () => {
    expect(fuzzyScore('zzz', 'Chrome')).toBe(0);
    expect(fuzzyScore('', 'Chrome')).toBe(0);
  });
});
