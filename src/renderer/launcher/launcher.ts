// Launcher renderer: instant search-as-you-type, full keyboard control, lazy previews.
import { normalize } from '../../shared/fuzzy';
import type { ResultPreview, SearchResult } from '../../shared/types';
import { el, nova, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const input = document.getElementById('input') as HTMLInputElement;
const list = document.getElementById('results')!;
const previewEl = document.getElementById('preview')!;
const footer = document.getElementById('footer')!;
const chip = document.getElementById('kindChip')!;
document.getElementById('queryIcon')!.innerHTML = glyph('search');

let results: SearchResult[] = [];
let selected = 0;
let seq = 0;
let previewTimer: number | null = null;
let busy = false;

// ---------- Search ----------

async function runSearch(q: string) {
  const mine = ++seq;
  const res = await nova.launcher.search(q);
  if (!res || mine !== seq) return; // a newer query superseded this one
  results = res.results;
  selected = 0;
  render(q);
}

input.addEventListener('input', () => void runSearch(input.value));

function highlight(title: string, q: string): DocumentFragment {
  // Bold the matching prefix / substring (visual cue only; ranking happens in main).
  const frag = document.createDocumentFragment();
  const nq = normalize(q.trim());
  const nt = normalize(title);
  const idx = nq ? nt.indexOf(nq) : -1;
  if (idx < 0 || !nq) {
    frag.append(title);
    return frag;
  }
  frag.append(title.slice(0, idx), el('mark', { text: title.slice(idx, idx + nq.length) }), title.slice(idx + nq.length));
  return frag;
}

function iconFor(r: SearchResult): HTMLElement {
  if (r.icon) {
    const img = el('img', { src: r.icon, alt: '', draggable: 'false' });
    img.addEventListener('error', () => img.replaceWith(el('div', { class: 'tile-glyph', html: glyph(r.glyph ?? 'sparkle') })), { once: true });
    return img;
  }
  const g = r.glyph ?? (r.kind === 'folder' ? 'folder' : r.kind === 'file' ? 'file' : r.kind === 'app' ? 'window' : 'sparkle');
  return el('div', { class: 'tile-glyph', html: glyph(g) });
}

function sectionTitle(q: string, r: SearchResult, prev: SearchResult | undefined): string | null {
  if (q.trim()) return null;
  if (r.favorite && !prev) return t('launcher.section.favorites');
  if (!r.favorite && (!prev || prev.favorite)) return t('launcher.section.recent');
  return null;
}

function render(q: string) {
  list.replaceChildren();
  if (!results.length) {
    list.append(
      el('li', { class: 'empty' }, el('div', {}, el('strong', { text: q.trim() ? t('launcher.empty') : t('launcher.placeholder') }), q.trim() ? t('launcher.emptyHint') : '')),
    );
  }
  results.forEach((r, i) => {
    const sec = sectionTitle(q, r, results[i - 1]);
    if (sec) list.append(el('li', { class: 'section', text: sec, role: 'presentation' }));
    const row = el(
      'li',
      { class: `row kind-${r.kind}${i === selected ? ' selected' : ''}`, role: 'option', 'data-index': i, 'aria-selected': i === selected ? 'true' : 'false' },
      el('div', { class: 'ico' }, iconFor(r)),
      el('div', { class: 'text' }, el('span', { class: 'title' }, r.kind === 'calc' || r.kind === 'unit' ? r.title : highlight(r.title, q)), r.subtitle ? el('span', { class: 'subtitle', text: r.subtitle }) : null),
      r.favorite ? el('span', { class: 'fav', html: glyph('star') }) : null,
      i < 9 && i !== selected ? el('span', { class: 'kbd-hint', text: `Ctrl ${i + 1}` }) : null,
      i === selected ? el('span', { class: 'kbd-hint', text: r.action }) : null,
    );
    row.addEventListener('mousemove', () => {
      if (selected !== i) select(i);
    });
    row.addEventListener('click', (e) => void run(i, e.ctrlKey ? 'alt' : 'primary'));
    list.append(row);
  });
  updateFooter();
  schedulePreview();
}

function select(i: number) {
  if (!results.length) return;
  selected = (i + results.length) % results.length;
  for (const row of list.querySelectorAll<HTMLElement>('.row')) {
    const on = Number(row.dataset.index) === selected;
    row.classList.toggle('selected', on);
    row.setAttribute('aria-selected', on ? 'true' : 'false');
    // Swap the trailing hint between "Ctrl n" and the action label.
    const hint = row.querySelector('.kbd-hint');
    const idx = Number(row.dataset.index);
    if (hint) hint.textContent = on ? results[idx].action : idx < 9 ? `Ctrl ${idx + 1}` : '';
    else if (on) row.append(el('span', { class: 'kbd-hint', text: results[idx].action }));
    if (on) row.scrollIntoView({ block: 'nearest' });
  }
  updateFooter();
  schedulePreview();
}

// ---------- Preview ----------

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  const r = results[selected];
  if (!r) {
    previewEl.hidden = true;
    return;
  }
  if (r.preview) {
    showPreview(r.preview, r);
    return;
  }
  if (!['file', 'folder', 'app'].includes(r.kind)) {
    previewEl.hidden = true;
    return;
  }
  previewTimer = window.setTimeout(async () => {
    const id = r.id;
    const p = await nova.launcher.preview(id);
    if (results[selected]?.id !== id) return;
    if (p) showPreview(p, r);
    else previewEl.hidden = true;
  }, 90);
}

function showPreview(p: ResultPreview, r: SearchResult) {
  const parts: (HTMLElement | null)[] = [];
  if (p.thumbnail) parts.push(el('div', { class: 'thumb' }, el('img', { src: p.thumbnail, alt: '', class: r.kind === 'app' ? 'icon' : '' })));
  if (p.large !== undefined) parts.push(el('div', { class: `large${r.kind === 'clipboard' ? ' text' : ''}`, text: p.large }));
  parts.push(el('h2', { text: p.title }));
  if (p.lines.length) parts.push(el('dl', {}, ...p.lines.flatMap((l) => [el('dt', { text: l.label }), el('dd', { text: l.value })])));
  previewEl.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  previewEl.hidden = false;
}

// ---------- Footer ----------

function hint(label: string, keys: string[], primary = false) {
  return el('span', { class: `hint${primary ? ' primary' : ''}` }, label, ...keys.map((k) => el('span', { class: 'kbd', text: k })));
}

function updateFooter() {
  const r = results[selected];
  const brand = el('span', { class: 'brand', html: glyph('sparkle') });
  brand.append('NOVA');
  const parts: HTMLElement[] = [brand];
  if (r) {
    parts.push(hint(r.action, ['↵'], true));
    if (r.altAction) parts.push(hint(r.altAction, ['Ctrl', '↵']));
    if (/^(app|file|set|sys|nova|url|cmd):/.test(r.id)) parts.push(hint(t('launcher.hint.favorite'), ['Ctrl', 'D']));
  }
  parts.push(hint(t('launcher.hint.close'), [document.documentElement.lang === 'fr' ? 'Échap' : 'Esc']));
  footer.replaceChildren(...parts);
  chip.hidden = !r || !input.value.trim();
  if (r) chip.textContent = t(`launcher.kind.${r.kind}` as Parameters<typeof t>[0]);
}

// ---------- Actions ----------

function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: 'toast', text });
  document.body.append(node);
  setTimeout(() => node.remove(), 1400);
}

async function run(i: number, mode: 'primary' | 'alt') {
  const r = results[i];
  if (!r || busy) return;
  busy = true;
  try {
    if (r.kind === 'calc' || r.kind === 'unit' || r.kind === 'clipboard') toast(t('launcher.copied'));
    await nova.launcher.execute(r.id, mode);
  } finally {
    busy = false;
  }
}

input.addEventListener('keydown', async (e) => {
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault();
    select(selected + 1);
  } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault();
    select(selected - 1);
  } else if (e.key === 'PageDown') {
    e.preventDefault();
    select(Math.min(results.length - 1, selected + 5));
  } else if (e.key === 'PageUp') {
    e.preventDefault();
    select(Math.max(0, selected - 5));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    await run(selected, e.ctrlKey ? 'alt' : 'primary');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (input.value) {
      input.value = '';
      void runSearch('');
    } else nova.launcher.hide();
  } else if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    await run(Number(e.key) - 1, 'primary');
  } else if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const r = results[selected];
    if (r) {
      r.favorite = await nova.launcher.toggleFavorite(r.id);
      toast(r.favorite ? t('launcher.addFavorite') : t('launcher.removeFavorite'));
      render(input.value);
      select(selected);
    }
  } else if (e.ctrlKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    const r = results[selected];
    if (r?.kind === 'app' && (await nova.launcher.pin(r.id))) toast(t('launcher.pinToDock'));
  }
});

// ---------- Lifecycle ----------

nova.launcher.onShow(() => {
  // Re-animate and start fresh on every summon.
  const root = document.getElementById('launcher')!;
  root.style.animation = 'none';
  void root.offsetHeight;
  root.style.animation = '';
  input.value = '';
  input.focus();
  void runSearch('');
});
nova.launcher.onHide(() => {
  if (previewTimer) clearTimeout(previewTimer);
});
window.addEventListener('focus', () => input.focus());

// Refresh icons that were still being extracted when results were first shown.
let iconTimer: number | null = null;
nova.onIconsChanged(() => {
  if (iconTimer) return;
  iconTimer = window.setTimeout(() => {
    iconTimer = null;
    const keep = selected;
    void runSearch(input.value).then(() => select(keep));
  }, 120);
});

// Test hook used by the smoke test to capture a screenshot with a query typed.
window.__novaTestQuery = (q: string) => {
  input.value = q;
  void runSearch(q);
};

async function init() {
  const boot = await nova.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  input.placeholder = t('launcher.placeholder');
  nova.onSettings(({ settings, language, darkSystem }) => {
    setLanguage(language);
    applyTheme(settings, darkSystem);
    input.placeholder = t('launcher.placeholder');
  });
  void runSearch('');
}

void init();
