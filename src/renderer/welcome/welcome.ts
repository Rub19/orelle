// First-run guided setup. Each step writes its choice immediately (through the normal settings
// path); the taskbar and Windows-key changes only take effect when the user finishes.
import type { Settings } from '../../shared/types';
import type { StringKey } from '../../shared/i18n';
import { THEME_PRESETS, lookPatch } from '../../shared/themeModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { brandMark, glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
let settings: Settings;
let darkSystem = true;
let step = 0;
let dockApps: { name: string; icon: string | null }[] = [];
const STEPS = 5;

async function update(patch: unknown) {
  const next = await orelle.updateSettings(patch);
  if (next) settings = next;
  applyTheme(settings, darkSystem);
}

function choice<T extends string>(options: { value: T; title: StringKey; desc: StringKey; glyph: string; badge?: StringKey }[], value: T, onPick: (v: T) => void) {
  const wrap = el('div', { class: 'choices', role: 'radiogroup' });
  for (const o of options) {
    const b = el('button', { class: `choice${o.value === value ? ' on' : ''}`, role: 'radio', 'aria-checked': String(o.value === value) },
      el('span', { class: 'c-ico', html: glyph(o.glyph) }),
      el('span', { class: 'c-txt' }, el('strong', {}, t(o.title), o.badge ? el('em', { text: t(o.badge) }) : null), el('small', { text: t(o.desc) })));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.choice').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-checked', 'false'); });
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      onPick(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

function stepContent(): HTMLElement[] {
  const g = settings.general;
  switch (step) {
    case 0:
      return [
        el('div', { class: 'hero', html: brandMark('hero-mark') }),
        el('h1', { text: t('welcome.title') }),
        el('p', { class: 'lead', text: t('welcome.lead') }),
        choice([
          { value: 'fr', title: 'welcome.lang.fr', desc: 'welcome.lang.frDesc', glyph: 'globe' },
          { value: 'en', title: 'welcome.lang.en', desc: 'welcome.lang.enDesc', glyph: 'globe' },
        ], document.documentElement.lang === 'en' ? 'en' : 'fr', (v) => void update({ general: { language: v } })),
      ];
    case 1:
      return [
        el('h1', { text: t('welcome.taskbar.title') }),
        el('p', { class: 'lead', text: t('welcome.taskbar.lead') }),
        choice([
          { value: 'hidden', title: 'welcome.taskbar.hidden', desc: 'welcome.taskbar.hiddenDesc', glyph: 'eyeOff', badge: 'welcome.recommended' },
          { value: 'autohide', title: 'welcome.taskbar.autohide', desc: 'welcome.taskbar.autohideDesc', glyph: 'taskbar' },
          { value: 'normal', title: 'welcome.taskbar.normal', desc: 'welcome.taskbar.normalDesc', glyph: 'window' },
        ], g.taskbarMode, (v) => void update({ general: { taskbarMode: v } })),
      ];
    case 2:
      return [
        el('h1', { text: t('welcome.winkey.title') }),
        el('p', { class: 'lead', text: t('welcome.winkey.lead') }),
        choice([
          { value: 'menu', title: 'welcome.winkey.menu', desc: 'welcome.winkey.menuDesc', glyph: 'grid', badge: 'welcome.recommended' },
          { value: 'launcher', title: 'welcome.winkey.launcher', desc: 'welcome.winkey.launcherDesc', glyph: 'search' },
          { value: 'windows', title: 'welcome.winkey.windows', desc: 'welcome.winkey.windowsDesc', glyph: 'window' },
        ], g.winKey, (v) => void update({ general: { winKey: v } })),
      ];
    case 3: {
      const presets = ['orelle', 'macos', 'minimal', 'gaming'];
      const grid = el('div', { class: 'looks' }, ...presets.map((id) => {
        const p = THEME_PRESETS.find((x) => x.id === id)!;
        const card = el('button', { class: 'look' }, el('span', { class: 'swatch' }), el('strong', { text: t(`settings.studio.preset.${id}` as StringKey) }));
        (card.querySelector('.swatch') as HTMLElement).style.background = `linear-gradient(135deg, ${p.look.accent}, ${p.look.theme === 'light' ? '#f4f4f6' : '#1c1c22'})`;
        card.addEventListener('click', () => {
          grid.querySelectorAll('.look').forEach((c) => c.classList.remove('on'));
          card.classList.add('on');
          void update(lookPatch(p.look));
        });
        return card;
      }));
      const perf = el('p', { class: 'note', text: t('welcome.look.perf') });
      return [el('h1', { text: t('welcome.look.title') }), el('p', { class: 'lead', text: t('welcome.look.lead') }), grid, perf];
    }
    default: {
      const login = el('label', { class: 'check' }, el('input', { type: 'checkbox' }), el('span', { text: t('welcome.login') }));
      const box = login.querySelector('input') as HTMLInputElement;
      box.checked = g.launchAtLogin;
      box.addEventListener('change', () => void update({ general: { launchAtLogin: box.checked } }));
      return [
        el('h1', { text: t('welcome.dock.title') }),
        el('p', { class: 'lead', text: dockApps.length ? t('welcome.dock.lead', { n: dockApps.length }) : t('welcome.dock.none') }),
        el('div', { class: 'dock-preview' }, ...dockApps.map((a) => (a.icon ? el('img', { src: a.icon, alt: a.name, title: a.name }) : el('span', { class: 'ph', html: glyph('window'), title: a.name })))),
        login,
        el('p', { class: 'note', text: t('welcome.later') }),
      ];
    }
  }
}

function render() {
  const back = el('button', { class: 'btn', text: t('welcome.back') });
  back.disabled = step === 0;
  back.addEventListener('click', () => { step--; render(); });
  const next = el('button', { class: 'btn primary', text: step === STEPS - 1 ? t('welcome.finish') : t('welcome.next') });
  next.addEventListener('click', () => {
    if (step === STEPS - 1) orelle.welcome.finish();
    else { step++; render(); }
  });
  const dots = el('div', { class: 'dots' }, ...Array.from({ length: STEPS }, (_, i) => el('i', { class: i === step ? 'on' : '' })));
  root.replaceChildren(el('div', { class: 'wrap' },
    el('section', { class: 'step', 'aria-live': 'polite' }, ...stepContent()),
    el('footer', { class: 'foot' }, dots, el('span', { class: 'grow' }), back, next)));
  (root.querySelector('.choice.on, .btn.primary') as HTMLElement | null)?.focus();
}

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  darkSystem = boot.darkSystem;
  setLanguage(boot.language);
  applyTheme(settings, darkSystem);
  dockApps = await orelle.welcome.dock();
  orelle.onSettings((p) => {
    settings = p.settings;
    darkSystem = p.darkSystem;
    const relabel = p.language !== document.documentElement.lang;
    setLanguage(p.language);
    applyTheme(settings, darkSystem);
    if (relabel) render();
  });
  render();
}

void init();
