// Orelle Utilities: Audio Center, Storage Manager and Clipboard Manager. Every number comes from
// Windows (Core Audio, the file system, the clipboard); every action is real and destructive ones
// are confirmed by the main process.
import type { AudioDeviceDto, AudioSessionDto, ClipItemDto, FileItemDto, ScanResultDto } from '../../preload/preload';
import type { StringKey } from '../../shared/i18n';
import type { Settings } from '../../shared/types';
import { formatBytes } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const api = orelle.tools;
const sidebar = document.getElementById('sidebar')!;
const head = document.getElementById('head')!;
const page = document.getElementById('page')!;
const toastsEl = document.getElementById('toasts')!;

type Section = 'audio' | 'storage' | 'clipboard';
const SECTIONS: { id: Section; glyph: string }[] = [
  { id: 'audio', glyph: 'volume' },
  { id: 'storage', glyph: 'drive' },
  { id: 'clipboard', glyph: 'clipboard' },
];

let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let section: Section = 'audio';
let audioTimer: number | null = null;
let dragging = false;

const size = (n: number) => formatBytes(n, lang);

function toast(text: string, kind: 'info' | 'error' = 'info') {
  const node = el('div', { class: `toast ${kind}`, text });
  toastsEl.append(node);
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3000);
}

function button(label: string, onClick: () => void, cls = 'btn', g?: string) {
  const b = el('button', { class: cls, html: g ? glyph(g) : '' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function slider(value: number, label: string, onInput: (v: number) => void) {
  const input = el('input', { type: 'range', min: 0, max: 100, step: 1, value, 'aria-label': label, class: 'range' });
  const fill = () => input.style.setProperty('--fill', `${input.value}%`);
  fill();
  input.addEventListener('pointerdown', () => (dragging = true));
  input.addEventListener('pointerup', () => (dragging = false));
  input.addEventListener('input', () => { fill(); onInput(Number(input.value)); });
  return input;
}

function meter(peak: number) {
  const m = el('div', { class: 'meter' }, el('div', { class: 'meter-fill' }));
  (m.firstElementChild as HTMLElement).style.width = `${peak}%`;
  return m;
}

// ---------- Navigation ----------

function renderSidebar() {
  sidebar.replaceChildren(el('div', { class: 'side-head' }), ...SECTIONS.map((s) => {
    const b = el('button', { class: `side-item${s.id === section ? ' current' : ''}`, html: glyph(s.glyph) }, t(`tools.${s.id}` as StringKey));
    b.addEventListener('click', () => go(s.id));
    return b;
  }));
}

function go(s: Section) {
  section = s;
  if (audioTimer) clearInterval(audioTimer);
  audioTimer = null;
  renderSidebar();
  head.replaceChildren(el('h1', { text: t(`tools.${s}` as StringKey) }));
  page.replaceChildren();
  if (s === 'audio') void audioPage();
  else if (s === 'storage') void storagePage();
  else void clipboardPage();
}

// ---------- Audio ----------

let audioState: { devices: AudioDeviceDto[]; sessions: AudioSessionDto[] } | null = null;

function deviceRow(d: AudioDeviceDto) {
  const mute = el('button', { class: `icon-btn${d.muted ? ' on' : ''}`, html: glyph(d.flow === 'input' ? (d.muted ? 'micOff' : 'mic') : d.muted ? 'volumeMute' : 'volume'), title: t('tools.audio.mute') });
  mute.addEventListener('click', () => void api.audioSet({ kind: 'device', id: d.id, muted: !d.muted }).then(refreshAudio));
  return el('div', { class: `a-row${d.isDefault ? ' default' : ''}`, 'data-key': `d:${d.id}` },
    mute,
    el('div', { class: 'a-name' }, el('strong', { text: d.name }), el('small', { text: d.isDefault ? t('tools.audio.default') : t('tools.audio.available') })),
    el('div', { class: 'a-ctl' }, slider(d.level, d.name, (v) => void api.audioSet({ kind: 'device', id: d.id, level: v })), meter(d.peak)),
    el('span', { class: 'a-val', text: `${d.level} %` }),
  );
}

function sessionRow(s: AudioSessionDto) {
  const mute = el('button', { class: `icon-btn${s.muted ? ' on' : ''}`, html: glyph(s.muted ? 'volumeMute' : 'volume'), title: t('tools.audio.mute') });
  mute.addEventListener('click', () => void api.audioSet({ kind: 'session', pid: s.pid, system: s.system, muted: !s.muted }).then(refreshAudio));
  const ico = s.icon ? el('img', { src: s.icon, alt: '', class: 'a-ico' }) : el('span', { class: 'a-ico ph', html: glyph(s.system ? 'bellOn' : 'window') });
  return el('div', { class: 'a-row', 'data-key': `s:${s.pid}:${s.system}` },
    mute,
    el('div', { class: 'a-name with-ico' }, ico, el('span', {}, el('strong', { text: s.name }), el('small', { text: s.active ? t('tools.audio.playing') : t('tools.audio.idle') }))),
    el('div', { class: 'a-ctl' }, slider(s.level, s.name, (v) => void api.audioSet({ kind: 'session', pid: s.pid, system: s.system, level: v })), meter(s.peak)),
    el('span', { class: 'a-val', text: `${s.level} %` }),
  );
}

function renderAudio() {
  if (!audioState) return;
  const outs = audioState.devices.filter((d) => d.flow === 'output');
  const ins = audioState.devices.filter((d) => d.flow === 'input');
  const sessions = [...audioState.sessions].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const section = (title: StringKey, rows: HTMLElement[], empty: StringKey, link: HTMLElement) =>
    el('div', { class: 'card pad' }, el('div', { class: 'card-head' }, el('h2', { text: t(title) }), link), rows.length ? el('div', { class: 'a-list' }, ...rows) : el('p', { class: 'muted', text: t(empty) }));
  page.replaceChildren(
    el('p', { class: 'intro', text: t('tools.audio.intro') }),
    section('tools.audio.outputs', outs.map(deviceRow), 'tools.audio.noDevice', button(t('tools.audio.chooseOutput'), () => api.openSound('output'), 'btn small', 'external')),
    section('tools.audio.apps', sessions.map(sessionRow), 'tools.audio.noApps', button(t('tools.audio.appDevices'), () => api.openSound('apps'), 'btn small', 'external')),
    section('tools.audio.inputs', ins.map(deviceRow), 'tools.audio.noDevice', button(t('tools.audio.chooseInput'), () => api.openSound('input'), 'btn small', 'external')),
    el('p', { class: 'note', text: t('tools.audio.note') }),
  );
}

/** Live peaks update in place; the structure is rebuilt only when devices or apps change. */
async function refreshAudio() {
  const next = await api.audio();
  if (!next || section !== 'audio') return;
  const sig = (s: typeof next) => [...s.devices.map((d) => `${d.id}${d.isDefault}${d.muted}`), ...s.sessions.map((x) => `${x.pid}${x.system}${x.muted}${x.active}`)].join('|');
  const changed = !audioState || sig(audioState) !== sig(next);
  audioState = next;
  if (changed && !dragging) return renderAudio();
  for (const d of next.devices) updateRow(`d:${d.id}`, d.level, d.peak);
  for (const s of next.sessions) updateRow(`s:${s.pid}:${s.system}`, s.level, s.peak);
}

function updateRow(key: string, level: number, peak: number) {
  const row = [...page.querySelectorAll<HTMLElement>('.a-row')].find((r) => r.dataset.key === key);
  if (!row) return;
  (row.querySelector('.meter-fill') as HTMLElement).style.width = `${peak}%`;
  if (!dragging) {
    const input = row.querySelector('input') as HTMLInputElement;
    if (document.activeElement !== input && Number(input.value) !== level) {
      input.value = String(level);
      input.style.setProperty('--fill', `${level}%`);
    }
    row.querySelector('.a-val')!.textContent = `${level} %`;
  }
}

async function audioPage() {
  page.append(el('div', { class: 'center' }, el('div', { class: 'spinner' })));
  audioState = null;
  await refreshAudio();
  if (!audioState) page.replaceChildren(el('p', { class: 'muted', text: t('tools.audio.unavailable') }));
  audioTimer = window.setInterval(() => void refreshAudio(), 200);
}

// ---------- Storage ----------

let scan: ScanResultDto | null = null;
let scanRoot = '';
let busy = false;
const selected = new Set<string>();

function progressBox() {
  const box = el('div', { class: 'card pad progress' }, el('div', { class: 'spinner' }), el('div', { class: 'prog-text' }, el('strong', { text: t('tools.storage.scanning') }), el('small', { class: 'prog-cur', text: '' })), button(t('system.cancel'), () => api.cancel(), 'btn'));
  return box;
}

function fileRow(f: FileItemDto, check = true) {
  const box = el('input', { type: 'checkbox', 'aria-label': f.path });
  box.checked = selected.has(f.path);
  box.addEventListener('change', () => { if (box.checked) selected.add(f.path); else selected.delete(f.path); updateSelectionBar(); });
  const name = el('button', { class: 'linkish', text: f.path.split('\\').pop() ?? f.path, title: f.path });
  name.addEventListener('click', () => api.reveal(f.path));
  return el('div', { class: 'f-row' }, check ? box : el('span'), el('div', { class: 'f-name' }, name, el('small', { text: f.path })), el('span', { class: 'f-date', text: new Date(f.mtime).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US') }), el('span', { class: 'f-size', text: size(f.size) }));
}

const selectionBar = el('div', { class: 'selbar' });
function updateSelectionBar() {
  selectionBar.hidden = !selected.size;
  selectionBar.replaceChildren(
    el('span', { text: t('tools.storage.selected', { n: selected.size }) }),
    button(t('tools.storage.recycle'), async () => {
      const r = await api.recycle([...selected]);
      if (!r || r.canceled) return;
      toast(t('tools.storage.recycled', { n: r.removed }) + (r.refused ? ` · ${t('storage.refused', { n: r.refused })}` : ''));
      selected.clear();
      updateSelectionBar();
      if (scanRoot) void runScan(scanRoot);
    }, 'btn danger', 'trash'),
    button(t('tools.storage.clearSel'), () => { selected.clear(); page.querySelectorAll<HTMLInputElement>('.f-row input').forEach((b) => (b.checked = false)); updateSelectionBar(); }, 'btn'),
  );
}

async function runScan(root: string) {
  if (busy) return;
  busy = true;
  scanRoot = root;
  const holder = page.querySelector('.scan-out') as HTMLElement;
  holder.replaceChildren(progressBox());
  const res = await api.analyze(root);
  busy = false;
  if (!res || !res.ok) {
    holder.replaceChildren(el('p', { class: 'muted', text: res?.canceled ? t('tools.storage.canceled') : t('tools.storage.error') }));
    return;
  }
  scan = res;
  const max = res.children[0]?.size || 1;
  const bars = res.children.slice(0, 40).map((c) => {
    const b = el('button', { class: 'u-row', title: c.path },
      el('span', { class: 'u-name', html: glyph(c.dir ? 'folder' : 'file') }, c.name || c.path),
      el('span', { class: 'u-bar' }, el('span', { class: 'u-fill' })),
      el('span', { class: 'u-size', text: size(c.size) }),
      el('span', { class: 'u-pct', text: `${((c.size / (res.total || 1)) * 100).toFixed(1)} %` }));
    (b.querySelector('.u-fill') as HTMLElement).style.width = `${Math.max(1, (c.size / max) * 100)}%`;
    if (c.dir) b.addEventListener('click', () => void runScan(c.path));
    else b.addEventListener('click', () => api.reveal(c.path));
    return b;
  });
  const parent = root.replace(/\\[^\\]+\\?$/, '\\');
  const up = /^[a-z]:\\$/i.test(root) ? null : button(t('tools.storage.up'), () => void runScan(parent.length < 3 ? `${parent}\\` : parent), 'btn small', 'chevron');
  holder.replaceChildren(
    el('div', { class: 'card pad' },
      el('div', { class: 'card-head' }, el('h2', { text: root }), up, button(t('tools.storage.openFolder'), () => api.openFolder(root), 'btn small', 'folder')),
      el('p', { class: 'muted', text: t('tools.storage.summary', { size: size(res.total), files: res.files.toLocaleString(), ms: (res.ms / 1000).toFixed(1), skipped: res.skipped }) }),
      el('div', { class: 'u-list' }, ...bars)),
    el('div', { class: 'card pad' }, el('div', { class: 'card-head' }, el('h2', { text: t('tools.storage.largest') })), el('div', { class: 'f-list' }, ...res.largest.slice(0, 60).map((f) => fileRow(f)))),
  );
}

async function runDuplicates(root: string, minMB: number) {
  if (busy) return;
  busy = true;
  const holder = page.querySelector('.scan-out') as HTMLElement;
  holder.replaceChildren(progressBox());
  const res = await api.duplicates(root, minMB);
  busy = false;
  if (!res || !res.ok) {
    holder.replaceChildren(el('p', { class: 'muted', text: res?.canceled ? t('tools.storage.canceled') : t('tools.storage.error') }));
    return;
  }
  if (!res.groups.length) {
    holder.replaceChildren(el('div', { class: 'card pad' }, el('p', { class: 'muted', text: t('tools.storage.noDuplicates') })));
    return;
  }
  holder.replaceChildren(el('div', { class: 'card pad' },
    el('div', { class: 'card-head' }, el('h2', { text: t('tools.storage.duplicatesFound', { n: res.groups.length, size: size(res.wasted) }) })),
    el('p', { class: 'muted', text: t('tools.storage.duplicatesHint') }),
    ...res.groups.slice(0, 120).map((g) => el('div', { class: 'dup' },
      el('div', { class: 'dup-head', text: `${size(g.size)} × ${g.files.length} · SHA-256 ${g.hash === 'head' ? '' : g.hash.slice(0, 12)}` }),
      ...g.files.map((f, i) => fileRow(f, i > 0))))));
}

async function cleanupCard() {
  const card = el('div', { class: 'card pad' }, el('div', { class: 'card-head' }, el('h2', { text: t('tools.storage.cleanup') })), el('div', { class: 'center' }, el('div', { class: 'mini-spinner' })));
  void api.cleanup().then((list) => {
    const rows = list.map((c) => el('div', { class: 'c-row' },
      el('span', { class: 'c-ico', html: glyph(c.id === 'downloads' ? 'download' : c.id === 'temp' ? 'clock' : 'file') }),
      el('div', { class: 'c-name' }, el('strong', { text: t(`tools.storage.clean.${c.id}` as StringKey) }), el('small', { text: t(c.olderThanDays ? 'tools.storage.cleanOlder' : 'tools.storage.cleanAll', { files: c.files, size: size(c.size), days: c.olderThanDays }) })),
      button(t('tools.storage.view'), () => api.openFolder(c.path), 'btn small'),
      c.id === 'downloads' ? el('span', { class: 'c-hint', text: t('tools.storage.reviewOnly') }) : button(t('tools.storage.clean'), async () => {
        const r = await api.clean(c.id as 'temp' | 'crashdumps');
        if (r?.ok) { toast(t('tools.storage.cleaned', { n: r.removed, size: size(r.freed) })); void storagePage(); }
      }, 'btn', 'trash')));
    card.replaceChildren(card.firstElementChild!, ...rows, el('p', { class: 'note', text: t('tools.storage.cleanupNote') }));
  });
  return card;
}

async function storagePage() {
  const { drives, home } = await api.drives();
  const driveCards = drives.map((d) => {
    const used = d.total - d.free;
    const c = el('button', { class: 'drive' },
      el('span', { class: 'd-ico', html: glyph('drive') }),
      el('span', { class: 'd-txt' }, el('strong', { text: d.root }), el('small', { text: t('tools.storage.free', { free: size(d.free), total: size(d.total) }) })),
      el('span', { class: 'd-bar' }, el('span', { class: 'd-fill' })));
    const fill = c.querySelector('.d-fill') as HTMLElement;
    fill.style.width = `${(used / (d.total || 1)) * 100}%`;
    if (d.free / (d.total || 1) < 0.1) fill.classList.add('warn');
    c.addEventListener('click', () => void runScan(d.root));
    return c;
  });
  const minMB = el('input', { class: 'input small', type: 'number', min: 0.1, step: 0.5, value: 1, 'aria-label': t('tools.storage.minSize') });
  const tools = el('div', { class: 'card pad tools-row' },
    button(t('tools.storage.analyzeHome'), () => void runScan(home), 'btn primary', 'home'),
    button(t('tools.storage.analyzeFolder'), async () => { const p = await api.pickFolder(); if (p) void runScan(p); }, 'btn', 'folder'),
    el('span', { class: 'sep' }),
    button(t('tools.storage.findDuplicates'), async () => { const p = await api.pickFolder(); if (p) void runDuplicates(p, Number(minMB.value) || 1); }, 'btn', 'copy'),
    el('label', { class: 'inline' }, t('tools.storage.minSize'), minMB, 'Mo'));
  page.replaceChildren(
    el('p', { class: 'intro', text: t('tools.storage.intro') }),
    el('div', { class: 'drives' }, ...driveCards),
    tools,
    el('div', { class: 'scan-out' }),
    await cleanupCard(),
    selectionBar,
  );
  updateSelectionBar();
}

api.onProgress((p) => {
  const cur = page.querySelector('.prog-cur');
  if (cur) cur.textContent = p.phase === 'hash' ? t('tools.storage.hashing', { n: p.scanned }) : `${p.scanned.toLocaleString()} · ${p.current}`;
});

// ---------- Clipboard ----------

let clipQuery = '';

async function clipboardPage() {
  const data = await api.clipList();
  if (!data) return;
  if (!data.enabled) {
    page.replaceChildren(el('div', { class: 'card pad empty-card' },
      el('span', { class: 'big-ico', html: glyph('clipboard') }),
      el('h2', { text: t('tools.clip.off') }),
      el('p', { class: 'muted', text: t('tools.clip.offDesc') }),
      button(t('tools.clip.enable'), () => void orelle.updateSettings({ privacy: { clipboardHistory: true } }).then(() => setTimeout(() => void clipboardPage(), 200)), 'btn primary')));
    return;
  }
  const search = el('input', { class: 'input', type: 'search', placeholder: t('tools.clip.search'), value: clipQuery });
  search.addEventListener('input', () => { clipQuery = search.value; renderClipList(data.items, list); });
  const list = el('div', { class: 'clip-list' });
  renderClipList(data.items, list);
  page.replaceChildren(
    el('div', { class: 'tools-row' }, search,
      button(t('tools.clip.clear'), () => api.clipClear(false), 'btn', 'trash'),
      button(t('tools.clip.clearAll'), () => api.clipClear(true), 'btn danger')),
    list,
    el('p', { class: 'note', text: t('tools.clip.note', { max: settings.clipboard.maxItems }) }),
  );
  search.focus();
}

function renderClipList(items: ClipItemDto[], list: HTMLElement) {
  const q = clipQuery.trim().toLowerCase();
  const shown = items.filter((i) => !q || i.text.toLowerCase().includes(q) || (i.source ?? '').toLowerCase().includes(q));
  if (!shown.length) {
    list.replaceChildren(el('p', { class: 'muted center-text', text: items.length ? t('tools.clip.noMatch') : t('tools.clip.empty') }));
    return;
  }
  list.replaceChildren(...shown.map((i) => {
    const pin = el('button', { class: `icon-btn${i.pinned ? ' on' : ''}`, html: glyph('star'), title: i.pinned ? t('tools.clip.unpin') : t('tools.clip.pin') });
    pin.addEventListener('click', (e) => { e.stopPropagation(); api.clipPin(i.id, !i.pinned); });
    const del = el('button', { class: 'icon-btn', html: glyph('close'), title: t('tools.clip.remove') });
    del.addEventListener('click', (e) => { e.stopPropagation(); api.clipRemove(i.id); });
    const copy = el('button', { class: 'btn small', text: t('tools.clip.copy') });
    copy.addEventListener('click', async (e) => { e.stopPropagation(); if (await api.clipCopy(i.id)) toast(t('launcher.copied')); });
    const body = i.kind === 'image' && i.thumb ? el('img', { src: i.thumb, alt: i.text, class: 'clip-img' }) : el('div', { class: 'clip-text', text: i.text.length > 600 ? `${i.text.slice(0, 600)}…` : i.text });
    const card = el('div', { class: `clip${i.pinned ? ' pinned' : ''}`, role: 'button', tabindex: '0', title: t('tools.clip.pasteHint') },
      body,
      el('div', { class: 'clip-meta' },
        el('span', { text: `${new Date(i.at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}${i.source ? ` · ${i.source}` : ''}${i.kind === 'image' ? ` · ${i.text}` : ''}` }),
        el('span', { class: 'grow' }), copy, pin, del));
    const paste = () => void api.clipPaste(i.id);
    card.addEventListener('click', paste);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') paste(); });
    return card;
  }));
}

api.onClipChanged(() => { if (section === 'clipboard') void clipboardPage(); });

// ---------- Start ----------

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  document.title = t('tools.title');
  orelle.onSettings((p) => {
    const relabel = p.language !== lang;
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    if (relabel) go(section);
  });
  api.onSection((s) => go(SECTIONS.some((x) => x.id === s) ? (s as Section) : 'audio'));
  const start = api.startSection();
  go(SECTIONS.some((x) => x.id === start) ? (start as Section) : 'audio');
  // Live meters only while the window is visible.
  document.addEventListener('visibilitychange', () => {
    if (section !== 'audio') return;
    if (document.hidden && audioTimer) { clearInterval(audioTimer); audioTimer = null; }
    else if (!document.hidden && !audioTimer) audioTimer = window.setInterval(() => void refreshAudio(), 200);
  });
}

void init();
