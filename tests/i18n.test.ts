import { describe, expect, it } from 'vitest';
import { createTranslator, resolveLanguage } from '../src/shared/i18n';

describe('i18n', () => {
  it('interpolates variables', () => {
    expect(createTranslator('fr')('dock.quitAll', { n: 3 })).toBe('Fermer 3 fenêtres');
    expect(createTranslator('en')('launcher.webSearch', { q: 'orelle' })).toBe('Search the web for “orelle”');
  });

  it('resolves the automatic language from the system locale', () => {
    expect(resolveLanguage('auto', 'fr-FR')).toBe('fr');
    expect(resolveLanguage('auto', 'de-DE')).toBe('en');
    expect(resolveLanguage('fr', 'en-US')).toBe('fr');
  });

  it('provides accessible labels for the Windows notification area button', () => {
    expect(createTranslator('fr')('trayArea.show')).toContain('zone de notification');
    expect(createTranslator('en')('trayArea.show')).toContain('notification area');
  });

  it('provides an accessible administrator-mode label', () => {
    expect(createTranslator('fr')('topbar.admin')).toContain('administrateur');
    expect(createTranslator('en')('topbar.admin').toLowerCase()).toContain('administrator');
  });

  it('provides a dedicated updates settings category in both languages', () => {
    expect(createTranslator('fr')('settings.section.updates')).toBe('Mises à jour');
    expect(createTranslator('en')('settings.section.updates')).toBe('Updates');
  });
});
