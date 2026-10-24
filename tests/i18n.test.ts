import { describe, expect, it } from 'vitest';
import { createTranslator, resolveLanguage } from '../src/shared/i18n';

describe('i18n', () => {
  it('interpolates variables', () => {
    expect(createTranslator('fr')('dock.quitAll', { n: 3 })).toBe('Fermer 3 fenêtres');
    expect(createTranslator('en')('launcher.webSearch', { q: 'nova' })).toBe('Search the web for “nova”');
  });

  it('resolves the automatic language from the system locale', () => {
    expect(resolveLanguage('auto', 'fr-FR')).toBe('fr');
    expect(resolveLanguage('auto', 'de-DE')).toBe('en');
    expect(resolveLanguage('fr', 'en-US')).toBe('fr');
  });
});
