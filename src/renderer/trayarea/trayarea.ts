import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

async function init() {
  const boot = await orelle.bootstrap();
  if (!boot) return;
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  const button = el('button', { title: t('trayArea.show'), 'aria-label': t('trayArea.show') }, el('span', { html: glyph('chevronDown') }));
  button.addEventListener('click', () => orelle.trayArea.peek());
  document.getElementById('root')!.replaceChildren(button);
  orelle.onSettings((p) => {
    setLanguage(p.language);
    applyTheme(p.settings, p.darkSystem);
    button.title = t('trayArea.show');
    button.setAttribute('aria-label', t('trayArea.show'));
  });
}

void init();
