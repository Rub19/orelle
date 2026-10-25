// Orelle Files: tabs, optional second pane, sidebar (favorites, places, volumes, colour tags),
// breadcrumb with sibling folders, grid/list/details views with adjustable icon size, sorting,
// grouping, filters, resizable details panel, batch rename, context menus, drag and drop, keyboard
// navigation and long-operation progress.
import type { FileEntry, FileOperation, FsError, Place } from '../../shared/appTypes';
import { batchRename, breadcrumbs, fileKind, filterEntries, groupEntries, isArchive, parentDir, sortEntries, TAG_COLORS, type FileKind, type GroupBy, type SortKey, type TagColor } from '../../shared/filesModel';
import type { StringKey } from '../../shared/i18n';
import type { Settings } from '../../shared/types';
import { formatBytes } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const api = orelle.files;
const $ = (id: string) => document.getElementById(id)!;
const sidebar = $('sidebar');
const tabsEl = $('tabs');
const toolbar = $('toolbar');
const filtersEl = $('filters');
let content = $('content');
const panesEl = $('panes');
const pvResize = $('pvResize');
const previewEl = $('preview');
const statusEl = $('status');
const menuEl = $('menu');
const modalEl = $('modal');
const toastsEl = $('toasts');

let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let places: Place[] = [];

const RECENT = '::recent';
const TAG = '::tag:';

interface Tab {
  id: string;
  location: string; // a folder path, RECENT, or a search pseudo-location
  back: string[];
  forward: string[];
  entries: FileEntry[];
  error: FsError | null;
  loading: boolean;
  selected: Set<string>;
  /** Range-selection origin. */
  anchor: string | null;
  /** Keyboard focus item. */
  cursor: string | null;
  search: { query: string; content: boolean; root: string } | null;
  kind: FileKind | 'all';
  filterText: string;
}

let tabs: Tab[] = [];
let active = 0;
let groupBy: GroupBy = 'none';
let showPreview = false;
let clipboard: { paths: string[]; mode: 'copy' | 'move' } | null = null;
let renaming: string | null = null;
const icons = new Map<string, string | null>();
const ops = new Map<string, FileOperation>();

const tab = () => tabs[active];

// ---------- Panes (one, or two side by side) ----------

interface Pane { tabs: Tab[]; active: number; root: HTMLElement; content: HTMLElement; head: HTMLElement }
const panes: Pane[] = [];
let cur = 0;

function syncPane() {
  if (panes[cur]) { panes[cur].tabs = tabs; panes[cur].active = active; }
}

function usePane(i: number) {
  syncPane();
  cur = i;
  tabs = panes[i].tabs;
  active = panes[i].active;
  content = panes[i].content;
}

/** Runs `fn` with pane `i` as the current one (rendering the other pane in place). */
function withPane<T>(i: number, fn: () => T): T {
  const prev = cur;
  usePane(i);
  try { return fn(); } finally { usePane(prev); }
}

function focusPane(i: number) {
  if (i === cur || !panes[i]) return;
  usePane(i);
  for (const [j, p] of panes.entries()) p.root.classList.toggle('active', j === cur);
  api.watch(isFolder(tab().location) ? tab().location : null);
  render();
}

function paneHeads() {
  const dual = panes.length > 1;
  for (const [j, p] of panes.entries()) {
    p.head.hidden = !dual;
    if (!dual) continue;
    const tb = p.tabs[p.active];
    p.head.replaceChildren(el('span', { html: glyph(tb.location === RECENT ? 'clock' : tb.location.startsWith(TAG) ? 'star' : 'folder') }), el('span', { class: 'ph-name', text: locationName(tb.location) }), el('small', { text: tb.location.startsWith('::') ? '' : tb.location }));
    p.root.classList.toggle('active', j === cur);
  }
}

function wireContent(c: HTMLElement, index: number) {
  // Any click inside a pane makes it the current one.
  c.parentElement!.addEventListener('mousedown', () => focusPane(index), true);
  // Click on empty space clears the selection; right-click there opens the folder menu.
  c.addEventListener('mousedown', (ev) => {
    if ((ev.target as HTMLElement).closest('.item')) return;
    tab().selected.clear();
    paintSelection();
    renderStatus();
  });
  c.addEventListener('contextmenu', (ev) => {
    if ((ev.target as HTMLElement).closest('.item')) return;
    ev.preventDefault();
    void backgroundMenu(ev);
  });
  // Drops from other apps (or the other pane) into the open folder.
  c.addEventListener('dragover', (ev) => { if (isFolder(tab().location)) ev.preventDefault(); });
  c.addEventListener('drop', (ev) => { if (isFolder(tab().location)) void handleDrop(ev, tab().location); });
  // Ctrl+wheel resizes icons in the grid.
  c.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey || view() !== 'grid') return;
    ev.preventDefault();
    setIconSize(settings.files.iconSize + (ev.deltaY < 0 ? 8 : -8));
  }, { passive: false });
}

function makePane(root: HTMLElement): Pane {
  const head = root.querySelector<HTMLElement>('.pane-head')!;
  const c = root.querySelector<HTMLElement>('.content')!;
  const pane: Pane = { tabs: [], active: 0, root, content: c, head };
  wireContent(c, panes.length);
  return pane;
}

function setDual(on: boolean) {
  if (on && panes.length === 1) {
    const root = el('section', { class: 'pane' }, el('div', { class: 'pane-head' }), el('div', { class: 'content', tabindex: '0' }));
    panesEl.append(root);
    const p = makePane(root);
    const start = isFolder(tab().location) ? tab().location : places[0]?.path ?? 'C:\\';
    p.tabs = [newTab(start)];
    panes.push(p);
    withPane(1, () => void load(tab()));
  } else if (!on && panes.length === 2) {
    if (cur === 1) focusPane(0);
    panes[1].root.remove();
    panes.pop();
  }
  panesEl.classList.toggle('dual', panes.length > 1);
  if (settings.files.dualPane !== on) saveFiles({ dualPane: on });
  render();
}

/** Copies (or moves) the selection of the current pane into the other pane's folder. */
async function toOtherPane(mode: 'copy' | 'move') {
  if (panes.length < 2) return;
  const other = panes[1 - cur];
  const dest = other.tabs[other.active].location;
  const paths = selectedEntries().map((e) => e.path);
  if (!paths.length || !isFolder(dest)) return;
  await api.transfer(paths, dest, mode);
}
const view = () => settings.files.view;
const isFolder = (loc: string) => !loc.startsWith('::');
const locationName = (loc: string) => (loc === RECENT ? t('files.recent') : loc.startsWith(TAG) ? t(`files.tag.${loc.slice(TAG.length)}` as StringKey) : loc.startsWith('::search') ? t('files.searchResults') : breadcrumbs(loc).pop()?.name ?? loc);
const locale = () => (lang === 'fr' ? 'fr-FR' : 'en-US');

// ---------- Settings persistence ----------

function saveFiles(patch: Partial<Settings['files']>) {
  settings = { ...settings, files: { ...settings.files, ...patch } };
  void orelle.updateSettings({ files: patch });
}

// ---------- Navigation ----------

function newTab(location: string): Tab {
  return { id: crypto.randomUUID(), location, back: [], forward: [], entries: [], error: null, loading: true, selected: new Set(), anchor: null, cursor: null, search: null, kind: 'all', filterText: '' };
}

async function load(tb: Tab) {
  tb.loading = true;
  tb.error = null;
  if (tb === tab()) render();
  if (tb.location === RECENT) {
    tb.entries = await api.recent();
  } else if (tb.location.startsWith(TAG)) {
    const color = tb.location.slice(TAG.length);
    tb.entries = await api.entries(Object.entries(settings.files.tags).filter(([, c]) => c === color).map(([p]) => p));
  } else if (tb.search) {
    tb.entries = await api.search(tb.search.root, tb.search.query, tb.search.content);
  } else {
    const res = await api.list(tb.location);
    if (res.ok) tb.entries = res.entries;
    else {
      tb.entries = [];
      tb.error = res.error;
    }
  }
  tb.loading = false;
  if (tb === tab()) {
    api.watch(isFolder(tb.location) && !tb.error ? tb.location : null);
    render();
    void loadIcons(tb);
    return;
  }
  // The other pane: redraw it in place.
  const pi = panes.findIndex((p, j) => j !== cur && p.tabs[p.active] === tb);
  if (pi >= 0) {
    withPane(pi, () => renderContent());
    paneHeads();
    void loadIcons(tb);
  }
}

function go(location: string, opts: { push?: boolean } = {}) {
  const tb = tab();
  if (opts.push !== false && tb.location !== location) {
    tb.back.push(tb.location);
    tb.forward = [];
  }
  tb.location = location;
  tb.search = null;
  tb.selected.clear();
  tb.anchor = null;
  tb.filterText = '';
  void load(tb);
}

function goBack() {
  const tb = tab();
  const prev = tb.back.pop();
  if (!prev) return;
  tb.forward.push(tb.location);
  tb.location = prev;
  tb.search = null;
  tb.selected.clear();
  void load(tb);
}

function goForward() {
  const tb = tab();
  const next = tb.forward.pop();
  if (!next) return;
  tb.back.push(tb.location);
  tb.location = next;
  tb.search = null;
  tb.selected.clear();
  void load(tb);
}

function goUp() {
  const up = isFolder(tab().location) ? parentDir(tab().location) : null;
  if (up) go(up);
}

// ---------- Icons & thumbnails ----------

async function loadIcons(tb: Tab = tab()) {
  const missing = tb.entries.filter((e) => !icons.has(e.path)).slice(0, 400);
  if (!missing.length) return;
  const res = await api.icons(missing.map((e) => ({ path: e.path, dir: e.dir })));
  let changed = false;
  for (const [p, url] of Object.entries(res)) {
    if (url) { icons.set(p, url); changed = true; }
  }
  if (changed) updateIconsInPlace();
}

function updateIconsInPlace() {
  for (const img of panesEl.querySelectorAll<HTMLImageElement>('img.ico[data-path]')) {
    const url = icons.get(img.dataset.path!);
    if (url && img.getAttribute('src') !== url && !img.dataset.thumb) {
      img.src = url;
      img.classList.remove('pending');
    }
  }
}

const thumbObserver = new IntersectionObserver((list) => {
  for (const entry of list) {
    if (!entry.isIntersecting) continue;
    const img = entry.target as HTMLImageElement;
    thumbObserver.unobserve(img);
    void api.thumbnail(img.dataset.path!, 256).then((url) => {
      if (url) { img.src = url; img.dataset.thumb = '1'; img.classList.add('thumb'); }
    });
  }
}, { root: null, rootMargin: '200px' });

function iconFor(e: FileEntry, size: 'big' | 'small'): HTMLElement {
  const url = icons.get(e.path);
  const img = el('img', { class: 'ico', alt: '', draggable: 'false', 'data-path': e.path, src: url ?? '' });
  // Invisible until a real image (icon or thumbnail) has loaded: no broken-image flashes.
  if (!url) img.classList.add('pending');
  img.addEventListener('load', () => img.classList.remove('pending'));
  img.addEventListener('error', () => img.classList.add('pending'));
  if (size === 'big' && (['image', 'video'].includes(fileKind(e)) || e.ext === 'pdf')) thumbObserver.observe(img);
  return img;
}

// ---------- Selection ----------

function visibleEntries(): FileEntry[] {
  const tb = tab();
  const filtered = filterEntries(tb.entries, { showHidden: settings.files.showHidden, kind: tb.kind, text: tb.filterText });
  const sorted = tb.location === RECENT && !tb.search ? filtered : sortEntries(filtered, settings.files.sort.key as SortKey, settings.files.sort.desc);
  return groupEntries(sorted, groupBy).flatMap((g) => g.items);
}

function selectedEntries(): FileEntry[] {
  const sel = tab().selected;
  return tab().entries.filter((e) => sel.has(e.path));
}

function select(p: string, mode: 'only' | 'toggle' | 'range') {
  const tb = tab();
  tb.cursor = p;
  if (mode === 'only') {
    tb.selected = new Set([p]);
    tb.anchor = p;
  } else if (mode === 'toggle') {
    if (tb.selected.has(p)) tb.selected.delete(p);
    else tb.selected.add(p);
    tb.anchor = p;
  } else {
    const list = visibleEntries().map((e) => e.path);
    const a = list.indexOf(tb.anchor ?? p);
    const b = list.indexOf(p);
    tb.selected = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
  }
  paintSelection();
  renderStatus();
  if (showPreview) void renderPreview();
}

function paintSelection() {
  const sel = tab().selected;
  for (const node of content.querySelectorAll<HTMLElement>('[data-path].item')) node.classList.toggle('selected', sel.has(node.dataset.path!));
}

// ---------- Opening ----------

async function openEntry(e: FileEntry, newTabToo = false) {
  if (e.dir) {
    if (newTabToo) {
      tabs.push(newTab(e.path));
      active = tabs.length - 1;
      void load(tab());
    } else go(e.path);
    return;
  }
  const err = await api.open(e.path);
  if (err) toast(t('files.error.open', { error: err }), 'error');
}

// ---------- Rendering ----------

function render() {
  renderTabs();
  renderSidebar();
  renderToolbar();
  renderFilters();
  renderContent();
  renderStatus();
  if (showPreview) void renderPreview();
  previewEl.hidden = !showPreview;
  pvResize.hidden = !showPreview;
  previewEl.style.width = `${settings.files.previewWidth}px`;
  paneHeads();
  document.title = `${locationName(tab().location)} — ${t('files.title')}`;
}

function renderTabs() {
  tabsEl.replaceChildren(
    ...tabs.map((tb, i) => {
      const close = el('button', { class: 'tab-close', html: glyph('close'), 'aria-label': t('files.closeTab') });
      close.addEventListener('click', (ev) => { ev.stopPropagation(); closeTab(i); });
      const node = el('div', { class: `tab${i === active ? ' active' : ''}`, role: 'tab', title: tb.location }, el('span', { class: 'tab-ico', html: glyph(tb.location === RECENT ? 'clock' : tb.search ? 'search' : 'folder') }), el('span', { class: 'tab-name', text: tb.search ? `“${tb.search.query}”` : locationName(tb.location) }), tabs.length > 1 ? close : null);
      node.addEventListener('click', () => { active = i; api.watch(isFolder(tab().location) ? tab().location : null); render(); });
      node.addEventListener('auxclick', (ev) => { if (ev.button === 1) closeTab(i); });
      return node;
    }),
    (() => {
      const add = el('button', { class: 'tab-add', html: glyph('plus'), title: `${t('files.newTab')} (Ctrl+T)` });
      add.addEventListener('click', () => openTab(isFolder(tab().location) ? tab().location : places[0]?.path));
      return add;
    })(),
  );
}

function openTab(location?: string) {
  tabs.push(newTab(location ?? places[0]?.path ?? 'C:\\'));
  active = tabs.length - 1;
  void load(tab());
}

function closeTab(i: number) {
  if (tabs.length === 1) { window.close(); return; }
  tabs.splice(i, 1);
  if (active >= tabs.length) active = tabs.length - 1;
  else if (i < active) active--;
  void load(tab());
}

const PLACE_GLYPH: Record<Place['kind'], string> = { home: 'home', desktop: 'monitor', documents: 'file', downloads: 'download', pictures: 'image', music: 'music', videos: 'film', drive: 'drive', folder: 'folder', recycle: 'trash' };

function sideItem(label: string, g: string, location: string, extra?: HTMLElement | null, onContext?: (ev: MouseEvent) => void) {
  const cur = tab().location.toLowerCase() === location.toLowerCase();
  const b = el('button', { class: `side-item${cur ? ' current' : ''}`, title: location }, el('span', { class: 'side-ico', html: glyph(g) }), el('span', { class: 'side-label', text: label }), extra ?? null);
  b.addEventListener('click', () => go(location));
  b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); onContext?.(ev); });
  // Drop files on a sidebar folder to move them there (Ctrl = copy).
  if (isFolder(location)) {
    b.addEventListener('dragover', (ev) => { ev.preventDefault(); b.classList.add('drop'); });
    b.addEventListener('dragleave', () => b.classList.remove('drop'));
    b.addEventListener('drop', (ev) => { b.classList.remove('drop'); void handleDrop(ev, location); });
  }
  return b;
}

function renderSidebar() {
  const favs = settings.files.favorites;
  const parts: HTMLElement[] = [el('div', { class: 'side-brand' })];
  parts.push(el('div', { class: 'side-title' }, t('files.favorites'), (() => {
    const add = el('button', { class: 'side-add', html: glyph('plus'), title: t('files.addFavorite') });
    add.addEventListener('click', () => addFavorite(tab().location));
    add.disabled = !isFolder(tab().location) || favs.some((f) => f.path.toLowerCase() === tab().location.toLowerCase());
    return add;
  })()));
  parts.push(sideItem(t('files.recent'), 'clock', RECENT));
  for (const f of favs) {
    parts.push(sideItem(f.name, 'star', f.path, null, (ev) => showMenu(ev, [{ label: t('files.removeFavorite'), glyph: 'close', run: () => saveFiles({ favorites: settings.files.favorites.filter((x) => x.path !== f.path) }) }].map(asItem)).then(renderSidebar)));
  }
  parts.push(el('div', { class: 'side-title', text: t('files.places') }));
  for (const p of places.filter((x) => x.kind !== 'drive')) parts.push(sideItem(p.name, PLACE_GLYPH[p.kind], p.path, null, (ev) => void showMenu(ev, [asItem({ label: t('files.addFavorite'), glyph: 'star', run: () => addFavorite(p.path) })])));
  // Colour tags in use.
  const counts = new Map<string, number>();
  for (const c of Object.values(settings.files.tags)) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size) {
    parts.push(el('div', { class: 'side-title', text: t('files.tags') }));
    for (const c of TAG_COLORS) {
      if (!counts.has(c)) continue;
      const dot = el('span', { class: `tag-dot tag-${c}` });
      const b = sideItem(t(`files.tag.${c}` as StringKey), 'star', `${TAG}${c}`, el('small', { class: 'side-count', text: String(counts.get(c)) }));
      b.querySelector('.side-ico')!.replaceChildren(dot);
      parts.push(b);
    }
  }
  parts.push(el('div', { class: 'side-title', text: t('files.volumes') }));
  for (const d of places.filter((x) => x.kind === 'drive')) {
    const used = d.total ? 1 - (d.free ?? 0) / d.total : 0;
    const bar = el('span', { class: `side-usage${used > 0.9 ? ' crit' : ''}` }, el('i'));
    (bar.firstElementChild as HTMLElement).style.width = `${Math.round(used * 100)}%`;
    const label = `${d.name} · ${formatBytes(d.free ?? 0, lang)} ${t('files.free')}`;
    parts.push(sideItem(label, 'drive', d.path, bar));
  }
  const monitor = el('button', { class: 'side-item muted', html: glyph('chart') }, el('span', { class: 'side-label', text: t('monitor.title') }));
  monitor.addEventListener('click', () => api.openMonitor());
  parts.push(el('div', { class: 'side-spacer' }), monitor);
  sidebar.replaceChildren(...parts);
}

function addFavorite(p: string) {
  if (!isFolder(p) || settings.files.favorites.some((f) => f.path.toLowerCase() === p.toLowerCase())) return;
  saveFiles({ favorites: [...settings.files.favorites, { name: breadcrumbs(p).pop()?.name ?? p, path: p }] });
  renderSidebar();
  toast(t('files.favoriteAdded'));
}

function toolBtn(g: string, label: string, onClick: () => void, disabled = false, cls = '') {
  const b = el('button', { class: `tool ${cls}`, html: glyph(g), title: label, 'aria-label': label });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderToolbar() {
  const tb = tab();
  const crumbs = el('div', { class: 'crumbs' });
  if (isFolder(tb.location)) {
    const list = breadcrumbs(tb.location);
    list.forEach((c, i) => {
      const b = el('button', { class: `crumb${i === list.length - 1 ? ' last' : ''}`, text: c.name });
      b.addEventListener('click', () => go(c.path));
      b.addEventListener('dragover', (ev) => ev.preventDefault());
      b.addEventListener('drop', (ev) => void handleDrop(ev, c.path));
      crumbs.append(b);
      if (i < list.length - 1) {
        // The separator lists the sibling folders of the next crumb.
        const sep = el('button', { class: 'sep', html: glyph('chevron'), title: t('files.subfolders'), 'aria-label': t('files.subfolders') });
        sep.addEventListener('click', (ev) => { ev.stopPropagation(); void foldersMenu(ev, c.path); });
        crumbs.append(sep);
      }
    });
    // Click the empty part of the bar to type a path.
    crumbs.addEventListener('click', (ev) => { if (ev.target === crumbs) editPath(crumbs); });
  } else {
    crumbs.append(el('span', { class: 'crumb last', text: locationName(tb.location) }));
  }

  const viewSeg = el('div', { class: 'seg' }, ...(['grid', 'list', 'details'] as const).map((v, i) => {
    const b = el('button', { class: view() === v ? 'on' : '', html: glyph(v === 'grid' ? 'grid' : v === 'list' ? 'rows' : 'columns'), title: `${t(`files.view.${v}` as StringKey)} (Ctrl+${i + 1})` });
    b.addEventListener('click', () => { saveFiles({ view: v }); renderToolbar(); renderContent(); });
    return b;
  }));

  const search = el('input', { class: 'search', type: 'search', placeholder: t('files.searchHere'), value: tb.search?.query ?? tb.filterText, spellcheck: 'false' });
  search.addEventListener('input', () => {
    // Typing filters the current folder instantly; Enter searches recursively.
    tb.filterText = search.value;
    renderContent();
    renderStatus();
  });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && search.value.trim() && isFolder(tb.location)) {
      ev.preventDefault();
      startSearch(search.value.trim(), ev.altKey);
    } else if (ev.key === 'Escape') {
      search.value = '';
      tb.filterText = '';
      renderContent();
      content.focus();
    }
  });

  const sortBtn = el('button', { class: 'tool', html: glyph('sort'), title: t('files.sortGroup'), 'aria-label': t('files.sortGroup') });
  sortBtn.addEventListener('click', (ev) => void sortMenu(ev));

  toolbar.replaceChildren(
    toolBtn('chevronLeft', `${t('files.back')} (Alt+←)`, goBack, !tb.back.length),
    toolBtn('chevronRight', `${t('files.forward')} (Alt+→)`, goForward, !tb.forward.length),
    toolBtn('arrowUp', `${t('files.up')} (Alt+↑)`, goUp, !isFolder(tb.location) || !parentDir(tb.location)),
    crumbs,
    toolBtn('folderPlus', `${t('files.newFolder')} (Ctrl+Shift+N)`, () => void createFolder(), !isFolder(tb.location)),
    sortBtn,
    viewSeg,
    ...(panes.length > 1 ? [
      toolBtn('copy', `${t('files.copyToOther')} (Maj+F5)`, () => void toOtherPane('copy'), !tb.selected.size),
      toolBtn('chevronRight', `${t('files.moveToOther')} (Maj+F6)`, () => void toOtherPane('move'), !tb.selected.size),
    ] : []),
    toolBtn('columns', `${t('files.dualPane')} (F3)`, () => setDual(panes.length === 1), false, panes.length > 1 ? 'on' : ''),
    toolBtn('sidebarRight', `${t('files.preview')} (Espace)`, () => { showPreview = !showPreview; render(); }, false, showPreview ? 'on' : ''),
    el('label', { class: 'search-wrap', html: glyph('search') }, search),
  );
}

function editPath(crumbs: HTMLElement) {
  const input = el('input', { class: 'path-input', value: tab().location, spellcheck: 'false' });
  crumbs.replaceChildren(input);
  input.focus();
  input.select();
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') go(input.value.trim().replace(/^"|"$/g, ''));
    if (ev.key === 'Escape') renderToolbar();
  });
  input.addEventListener('blur', () => renderToolbar());
}

function startSearch(query: string, contentToo: boolean) {
  const tb = tab();
  const root = isFolder(tb.location) ? tb.location : places[0]?.path;
  tb.back.push(tb.location);
  tb.forward = [];
  tb.location = `::search:${Date.now()}`;
  tb.search = { query, content: contentToo, root };
  tb.selected.clear();
  void load(tb);
}

const FILTERS: (FileKind | 'all')[] = ['all', 'folder', 'document', 'image', 'video', 'audio', 'archive', 'code'];

function renderFilters() {
  const tb = tab();
  filtersEl.replaceChildren(
    ...FILTERS.map((k) => {
      const b = el('button', { class: `chip${tb.kind === k ? ' on' : ''}`, text: t(`files.kind.${k}` as StringKey) });
      b.addEventListener('click', () => { tb.kind = k; renderFilters(); renderContent(); renderStatus(); });
      return b;
    }),
    el('span', { class: 'grow' }),
    el('span', { class: 'search-info', text: tb.search ? t(tb.search.content ? 'files.searchingContent' : 'files.searchingNames', { q: tb.search.query, root: breadcrumbs(tb.search.root).pop()?.name ?? tb.search.root }) : '' }),
  );
}

function formatDate(ms: number) {
  if (!ms) return '—';
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `${t('files.today')} ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ' ' + d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

function kindLabel(e: FileEntry) {
  const k = fileKind(e);
  if (k === 'folder') return t('files.one.folder');
  return e.ext ? `${e.ext.toUpperCase()} · ${t(`files.one.${k}` as StringKey)}` : t('files.one.other');
}

function renderContent() {
  const tb = tab();
  const scroll = content.scrollTop;
  content.className = `content view-${view()}`;
  content.style.setProperty('--tile', `${settings.files.iconSize}px`);
  if (tb.loading && !tb.entries.length) {
    content.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'spinner' }), el('span', { text: tb.search ? t('files.searching') : t('files.loading') })));
    return;
  }
  if (tb.error) {
    const actions = el('div', { class: 'state-actions' });
    if (tb.error === 'denied' && isFolder(tb.location)) {
      const b = el('button', { class: 'btn', text: t('files.openInExplorer') });
      b.addEventListener('click', () => api.showInExplorer(tb.location));
      actions.append(b);
    }
    const back = el('button', { class: 'btn', text: t('files.back') });
    back.addEventListener('click', goBack);
    if (tb.back.length) actions.append(back);
    content.replaceChildren(el('div', { class: 'state' }, el('span', { class: 'state-ico', html: glyph(tb.error === 'denied' ? 'lock' : 'info') }), el('strong', { text: t(`files.error.${tb.error}` as StringKey) }), el('span', { text: t(`files.error.${tb.error}.hint` as StringKey) }), actions));
    return;
  }
  const list = visibleEntries();
  if (!list.length) {
    content.replaceChildren(el('div', { class: 'state' }, el('span', { class: 'state-ico', html: glyph(tb.search || tb.filterText ? 'search' : 'folder') }), el('strong', { text: tb.search || tb.filterText || tb.kind !== 'all' ? t('files.noResults') : t('files.empty') }), el('span', { text: tb.search ? t('files.noResults.hint') : t('files.empty.hint') })));
    return;
  }

  const groups = groupEntries(list, groupBy);
  const nodes: HTMLElement[] = [];
  if (view() === 'details') nodes.push(detailsHeader());
  for (const g of groups) {
    if (g.key) nodes.push(el('div', { class: 'group-head', text: `${t(`files.group.${g.key}` as StringKey)} · ${g.items.length}` }));
    const wrap = el('div', { class: 'items' });
    for (const e of g.items) wrap.append(itemNode(e));
    nodes.push(wrap);
  }
  content.replaceChildren(...nodes);
  content.scrollTop = scroll;
  paintSelection();
}

function detailsHeader() {
  const s = settings.files.sort;
  const col = (key: SortKey, label: string, cls: string) => {
    const b = el('button', { class: `col ${cls}${s.key === key ? ' sorted' : ''}` }, label, s.key === key ? el('span', { class: 'arrow', text: s.desc ? '↓' : '↑' }) : null);
    b.addEventListener('click', () => { saveFiles({ sort: { key, desc: s.key === key ? !s.desc : false } }); renderContent(); });
    return b;
  };
  return el('div', { class: 'details-head' }, col('name', t('files.col.name'), 'c-name'), col('mtime', t('files.col.modified'), 'c-date'), col('kind', t('files.col.kind'), 'c-kind'), col('size', t('files.col.size'), 'c-size'));
}

function itemNode(e: FileEntry): HTMLElement {
  const v = view();
  const tagColor = settings.files.tags[e.path];
  const nameNode = renaming === e.path ? renameInput(e) : el('span', { class: 'name', title: e.name }, tagColor ? el('i', { class: `tag-dot tag-${tagColor}` }) : null, e.name);
  let node: HTMLElement;
  if (v === 'grid') {
    node = el('div', { class: `item tile${e.hidden ? ' hidden-file' : ''}`, 'data-path': e.path, draggable: 'true' }, el('div', { class: 'art' }, iconFor(e, 'big')), nameNode);
  } else if (v === 'list') {
    node = el('div', { class: `item row${e.hidden ? ' hidden-file' : ''}`, 'data-path': e.path, draggable: 'true' }, iconFor(e, 'small'), nameNode, el('span', { class: 'meta', text: e.dir ? '' : formatBytes(e.size, lang) }));
  } else {
    node = el('div', { class: `item row details${e.hidden ? ' hidden-file' : ''}`, 'data-path': e.path, draggable: 'true' },
      el('span', { class: 'c-name' }, iconFor(e, 'small'), nameNode),
      el('span', { class: 'c-date', text: formatDate(e.mtime) }),
      el('span', { class: 'c-kind', text: kindLabel(e) }),
      el('span', { class: 'c-size', text: e.dir ? '—' : formatBytes(e.size, lang) }));
  }
  node.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 && tab().selected.has(e.path)) return;
    if (ev.shiftKey) select(e.path, 'range');
    else if (ev.ctrlKey) select(e.path, 'toggle');
    else if (!tab().selected.has(e.path) || ev.button !== 0) select(e.path, 'only');
  });
  node.addEventListener('click', (ev) => {
    if (!ev.shiftKey && !ev.ctrlKey && tab().selected.size > 1) select(e.path, 'only');
  });
  node.addEventListener('dblclick', () => void openEntry(e, false));
  node.addEventListener('auxclick', (ev) => { if (ev.button === 1 && e.dir) void openEntry(e, true); });
  node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); void itemMenu(ev); });
  node.addEventListener('dragstart', (ev) => {
    ev.preventDefault();
    if (!tab().selected.has(e.path)) select(e.path, 'only');
    api.startDrag(selectedEntries().map((x) => x.path));
  });
  if (e.dir) {
    node.addEventListener('dragover', (ev) => { ev.preventDefault(); node.classList.add('drop'); });
    node.addEventListener('dragleave', () => node.classList.remove('drop'));
    node.addEventListener('drop', (ev) => { node.classList.remove('drop'); ev.stopPropagation(); void handleDrop(ev, e.path); });
  }
  return node;
}

function renameInput(e: FileEntry) {
  const input = el('input', { class: 'rename', value: e.name, spellcheck: 'false' });
  setTimeout(() => {
    input.focus();
    // Select the name without its extension, like Finder/Explorer.
    const dot = e.dir ? -1 : e.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : e.name.length);
  }, 0);
  let done = false;
  const finish = async (commit: boolean) => {
    if (done) return;
    done = true;
    renaming = null;
    const name = input.value.trim();
    if (commit && name && name !== e.name) {
      const res = await api.rename(e.path, name);
      if (!res.ok) toast(t(`files.error.${res.error}` as StringKey), 'error');
      else {
        moveTag(e.path, res.path!);
        tab().selected = new Set([res.path!]);
        await load(tab());
        return;
      }
    }
    renderContent();
    content.focus();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') void finish(true);
    if (ev.key === 'Escape') void finish(false);
  });
  input.addEventListener('blur', () => void finish(true));
  input.addEventListener('mousedown', (ev) => ev.stopPropagation());
  input.addEventListener('dblclick', (ev) => ev.stopPropagation());
  return input;
}

function renderStatus() {
  const tb = tab();
  const list = visibleEntries();
  const sel = selectedEntries();
  const selSize = sel.filter((e) => !e.dir).reduce((a, e) => a + e.size, 0);
  const parts: HTMLElement[] = [el('span', { text: t('files.status.items', { n: list.length }) })];
  if (sel.length) parts.push(el('span', { text: t('files.status.selected', { n: sel.length, size: formatBytes(selSize, lang) }) }));
  if (clipboard) parts.push(el('span', { class: 'clip', text: t(clipboard.mode === 'move' ? 'files.status.cut' : 'files.status.copied', { n: clipboard.paths.length }) }));
  const running = [...ops.values()].filter((o) => !o.finished);
  for (const op of running) {
    const bar = el('span', { class: 'op-bar' }, el('i'));
    (bar.firstElementChild as HTMLElement).style.width = `${op.total ? Math.round((op.done / op.total) * 100) : 0}%`;
    parts.push(el('span', { class: 'op' }, el('span', { text: `${t(`files.op.${op.kind}` as StringKey)} ${op.done}/${op.total} · ${op.current}` }), bar));
  }
  if (tb.loading && tb.entries.length) parts.push(el('span', { class: 'mini-spinner' }));
  if (view() === 'grid') {
    const zoom = el('input', { class: 'zoom', type: 'range', min: 40, max: 192, step: 8, value: settings.files.iconSize, 'aria-label': t('files.iconSize'), title: `${t('files.iconSize')} (Ctrl+molette)` });
    zoom.addEventListener('input', () => setIconSize(Number(zoom.value)));
    parts.push(el('span', { class: 'grow' }), el('span', { class: 'zoom-wrap', html: glyph('image') }, zoom));
  }
  statusEl.replaceChildren(...parts);
}

async function renderPreview() {
  const sel = selectedEntries();
  const e = sel.length === 1 ? sel[0] : null;
  if (!e) {
    previewEl.replaceChildren(el('div', { class: 'pv-empty', text: sel.length > 1 ? t('files.status.selected', { n: sel.length, size: formatBytes(sel.reduce((a, x) => a + x.size, 0), lang) }) : t('files.preview.none') }));
    return;
  }
  const head = el('div', { class: 'pv-art' }, iconFor(e, 'big'));
  const info = el('dl', { class: 'pv-info' },
    el('dt', { text: t('files.col.kind') }), el('dd', { text: kindLabel(e) }),
    el('dt', { text: t('files.col.size') }), el('dd', { text: e.dir ? '—' : `${formatBytes(e.size, lang)}` }),
    el('dt', { text: t('files.col.modified') }), el('dd', { text: formatDate(e.mtime) }),
    el('dt', { text: t('files.col.created') }), el('dd', { text: formatDate(e.ctime) }),
    el('dt', { text: t('files.col.location') }), el('dd', { text: parentDir(e.path) ?? e.path }));
  const open = el('button', { class: 'btn primary', text: t('files.open') });
  open.addEventListener('click', () => void openEntry(e));
  previewEl.replaceChildren(head, el('h3', { text: e.name }), info, el('div', { class: 'pv-actions' }, open));
  const tagRow = el('div', { class: 'pv-tags' }, ...TAG_COLORS.map((c) => {
    const b = el('button', { class: `tag-pick tag-${c}${settings.files.tags[e.path] === c ? ' on' : ''}`, title: t(`files.tag.${c}` as StringKey), 'aria-label': t(`files.tag.${c}` as StringKey) });
    b.addEventListener('click', () => setTag([e.path], settings.files.tags[e.path] === c ? null : c));
    return b;
  }));
  previewEl.insertBefore(tagRow, info);
  if (!e.dir) {
    const pv = await api.preview(e.path);
    if (selectedEntries()[0]?.path !== e.path) return;
    if (pv.kind === 'image' && pv.data) {
      const img = el('img', { class: 'pv-image', src: pv.data, alt: '' });
      img.addEventListener('load', () => info.append(el('dt', { text: t('files.dimensions') }), el('dd', { text: `${img.naturalWidth} × ${img.naturalHeight}` })));
      head.replaceChildren(img);
    } else if (pv.kind === 'text' && pv.data !== undefined) previewEl.insertBefore(el('pre', { class: 'pv-text', text: pv.data + (pv.truncated ? '\n…' : '') }), info);
    else {
      // Videos, PDFs, Office files…: the large Windows thumbnail, when a handler provides one.
      const big = await api.thumbnail(e.path, 512);
      if (big && selectedEntries()[0]?.path === e.path) head.replaceChildren(el('img', { class: 'pv-image', src: big, alt: '' }));
    }
  }
}

// ---------- Menus ----------

interface MenuItem { label: string; glyph?: string; key?: string; run?: () => void; danger?: boolean; disabled?: boolean; separator?: boolean; /** Colour-tag picker for these paths. */ tags?: string[] }
const asItem = (m: MenuItem) => m;
const SEP: MenuItem = { label: '', separator: true };

function showMenu(ev: MouseEvent, items: MenuItem[]): Promise<void> {
  return new Promise((resolve) => {
    menuEl.replaceChildren(...items.map((m) => {
      if (m.separator) return el('div', { class: 'menu-sep' });
      if (m.tags) {
        const paths = m.tags;
        const current = paths.every((p) => settings.files.tags[p] === settings.files.tags[paths[0]]) ? settings.files.tags[paths[0]] : undefined;
        return el('div', { class: 'menu-tags', title: m.label }, ...TAG_COLORS.map((c) => {
          const b = el('button', { class: `tag-pick tag-${c}${current === c ? ' on' : ''}`, title: t(`files.tag.${c}` as StringKey), 'aria-label': t(`files.tag.${c}` as StringKey) });
          b.addEventListener('click', () => { hideMenu(); setTag(paths, current === c ? null : c); resolve(); });
          return b;
        }));
      }
      const b = el('button', { class: `menu-item${m.danger ? ' danger' : ''}`, html: m.glyph ? glyph(m.glyph) : '' }, el('span', { text: m.label }), m.key ? el('kbd', { text: m.key }) : null);
      b.disabled = !!m.disabled;
      b.addEventListener('click', () => { hideMenu(); m.run?.(); resolve(); });
      return b;
    }));
    menuEl.hidden = false;
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = `${Math.min(ev.clientX, innerWidth - r.width - 8)}px`;
    menuEl.style.top = `${Math.min(ev.clientY, innerHeight - r.height - 8)}px`;
    const close = (e2: Event) => {
      if (menuEl.contains(e2.target as Node)) return;
      hideMenu();
      resolve();
      window.removeEventListener('mousedown', close, true);
    };
    setTimeout(() => window.addEventListener('mousedown', close, true), 0);
  });
}

function hideMenu() {
  menuEl.hidden = true;
}

async function itemMenu(ev: MouseEvent) {
  const sel = selectedEntries();
  if (!sel.length) return backgroundMenu(ev);
  const one = sel.length === 1 ? sel[0] : null;
  const here = tab().location;
  const items: MenuItem[] = [
    { label: t('files.open'), glyph: 'external', key: '↵', run: () => sel.forEach((e) => void openEntry(e)) },
    ...(one && one.dir ? [{ label: t('files.openInNewTab'), glyph: 'plus', run: () => void openEntry(one, true) }, { label: t('files.openInNewWindow'), glyph: 'window', run: () => api.newWindow(one.path) }] : []),
    ...(one && !one.dir ? [{ label: t('files.openWith'), glyph: 'grid', run: () => api.openWith(one.path) }] : []),
    { label: t('files.showInExplorer'), glyph: 'folder', run: () => api.showInExplorer(sel[0].path) },
    SEP,
    { label: t('files.copy'), glyph: 'copy', key: 'Ctrl+C', run: () => setClipboard('copy') },
    { label: t('files.cut'), glyph: 'scissors', key: 'Ctrl+X', run: () => setClipboard('move') },
    { label: t('files.paste'), glyph: 'clipboard', key: 'Ctrl+V', disabled: !clipboard || !(one?.dir || isFolder(here)), run: () => void paste(one?.dir ? one.path : here) },
    { label: t('files.copyPath'), glyph: 'link', run: () => { api.copyPath(sel.map((e) => e.path)); toast(t('launcher.copied')); } },
    SEP,
    ...(one ? [{ label: t('files.rename'), glyph: 'pencil', key: 'F2', run: () => startRename(one) }] : [{ label: t('files.batchRename'), glyph: 'pencil', key: 'F2', run: () => void batchRenameModal(sel) }]),
    { label: t('files.tags'), tags: sel.map((e) => e.path) },
    ...(panes.length > 1 ? [{ label: t('files.copyToOther'), glyph: 'copy', key: 'Maj+F5', run: () => void toOtherPane('copy') }, { label: t('files.moveToOther'), glyph: 'chevronRight', key: 'Maj+F6', run: () => void toOtherPane('move') }] : []),
    { label: t('files.compress'), glyph: 'archive', run: () => void runArchive('compress', sel.map((e) => e.path)) },
    ...(one && isArchive(one) ? [{ label: t('files.extract'), glyph: 'archive', run: () => void runArchive('extract', [one.path]) }] : []),
    ...(one?.dir ? [{ label: t('files.addFavorite'), glyph: 'star', run: () => addFavorite(one.path) }, { label: t('files.terminal'), glyph: 'command', run: () => api.terminal(one.path) }] : []),
    { label: t('files.properties'), glyph: 'info', key: 'Alt+↵', run: () => void showProperties(sel[0]) },
    SEP,
    { label: t('files.trash'), glyph: 'trash', key: 'Suppr', danger: true, run: () => void trash(false) },
  ];
  await showMenu(ev, items);
}

async function backgroundMenu(ev: MouseEvent) {
  const here = tab().location;
  const folder = isFolder(here);
  await showMenu(ev, [
    { label: t('files.newFolder'), glyph: 'folderPlus', key: 'Ctrl+Shift+N', disabled: !folder, run: () => void createFolder() },
    { label: t('files.newTextFile'), glyph: 'file', disabled: !folder, run: () => void createTextFile() },
    { label: t('files.paste'), glyph: 'clipboard', key: 'Ctrl+V', disabled: !clipboard || !folder, run: () => void paste(here) },
    SEP,
    { label: t('files.showHidden'), glyph: settings.files.showHidden ? 'check' : 'eyeOff', key: 'Ctrl+H', run: () => toggleHidden() },
    { label: t('files.refresh'), glyph: 'refresh', key: 'F5', run: () => void load(tab()) },
    ...(folder ? [SEP, { label: t('files.terminal'), glyph: 'command', run: () => api.terminal(here) }, { label: t('files.showInExplorer'), glyph: 'folder', run: () => api.showInExplorer(here) }, { label: t('files.addFavorite'), glyph: 'star', run: () => addFavorite(here) }] : []),
  ]);
}

async function sortMenu(ev: MouseEvent) {
  const s = settings.files.sort;
  const item = (key: SortKey) => ({ label: t(`files.col.${key === 'mtime' ? 'modified' : key}` as StringKey), glyph: s.key === key ? 'check' : undefined, run: () => { saveFiles({ sort: { key, desc: s.key === key ? !s.desc : false } }); renderContent(); } });
  const grp = (g: GroupBy) => ({ label: t(`files.groupBy.${g}` as StringKey), glyph: groupBy === g ? 'check' : undefined, run: () => { groupBy = g; renderContent(); } });
  await showMenu(ev, [item('name'), item('mtime'), item('kind'), item('size'), { label: s.desc ? t('files.sort.desc') : t('files.sort.asc'), glyph: 'sort', run: () => { saveFiles({ sort: { ...s, desc: !s.desc } }); renderContent(); } }, SEP, grp('none'), grp('kind'), grp('date')]);
}

// ---------- Tags, icon size, sibling folders, batch rename ----------

function setTag(paths: string[], color: TagColor | null) {
  const tags = { ...settings.files.tags };
  for (const p of paths) {
    if (color) tags[p] = color;
    else delete tags[p];
  }
  // The whole map is replaced (a merge could not delete keys).
  settings = { ...settings, files: { ...settings.files, tags } };
  void orelle.updateSettings({ files: { tags: null } }).then(() => orelle.updateSettings({ files: { tags } }));
  renderContent();
  renderSidebar();
  if (showPreview) void renderPreview();
}

function moveTag(from: string, to: string) {
  const c = settings.files.tags[from];
  if (!c) return;
  const tags = { ...settings.files.tags, [to]: c };
  delete tags[from];
  settings = { ...settings, files: { ...settings.files, tags } };
  void orelle.updateSettings({ files: { tags: null } }).then(() => orelle.updateSettings({ files: { tags } }));
}

let zoomTimer: number | null = null;
function setIconSize(px: number) {
  const size = Math.max(40, Math.min(192, Math.round(px)));
  settings = { ...settings, files: { ...settings.files, iconSize: size } };
  for (const p of panes) p.content.style.setProperty('--tile', `${size}px`);
  if (zoomTimer) clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => void orelle.updateSettings({ files: { iconSize: size } }), 300);
}

async function foldersMenu(ev: MouseEvent, dir: string) {
  const res = await api.list(dir);
  if (!res.ok) return;
  const dirs = sortEntries(res.entries.filter((e) => e.dir && (settings.files.showHidden || !e.hidden)), 'name', false).slice(0, 40);
  await showMenu(ev, dirs.length ? dirs.map((d) => ({ label: d.name, glyph: 'folder', run: () => go(d.path) })) : [{ label: t('files.noSubfolders'), disabled: true }]);
}

async function batchRenameModal(sel: FileEntry[]) {
  const others = tab().entries.filter((e) => !sel.some((s) => s.path === e.path)).map((e) => e.name);
  const field = (label: string, value = '', type = 'text') => {
    const input = el('input', { class: 'input', type, value, spellcheck: 'false' });
    return { input, row: el('label', { class: 'br-field' }, el('span', { text: label }), input) };
  };
  const find = field(t('files.br.find'));
  const replace = field(t('files.br.replace'));
  const prefix = field(t('files.br.prefix'));
  const suffix = field(t('files.br.suffix'));
  const base = field(t('files.br.base'));
  const start = field(t('files.br.start'), '1', 'number');
  const preview = el('div', { class: 'br-preview' });
  const apply = el('button', { class: 'btn primary', text: t('files.br.apply') });
  const opts = () => ({ find: find.input.value, replace: replace.input.value, prefix: prefix.input.value, suffix: suffix.input.value, base: base.input.value, start: Math.max(0, Number(start.input.value) || 0), digits: String(sel.length + (Number(start.input.value) || 0)).length, keepExtension: true });
  const update = () => {
    const res = batchRename(sel, opts(), others);
    preview.replaceChildren(...res.slice(0, 200).map((r) => el('div', { class: `br-row${r.error ? ' bad' : r.from !== r.to ? ' changed' : ''}` }, el('span', { text: r.from }), el('span', { class: 'arrow', html: glyph('chevron') }), el('span', { text: r.error ? t(`files.br.${r.error}` as StringKey) : r.to }))));
    apply.disabled = res.some((r) => r.error) || res.every((r) => r.from === r.to);
  };
  for (const f of [find, replace, prefix, suffix, base, start]) f.input.addEventListener('input', update);
  const cancel = el('button', { class: 'btn', text: t('common.cancel') });
  cancel.addEventListener('click', closeModal);
  apply.addEventListener('click', async () => {
    const res = batchRename(sel, opts(), others);
    closeModal();
    let done = 0;
    // Two passes through temporary names, so swaps (a→b, b→a) never collide.
    const temp: { entry: FileEntry; tmp: string; to: string }[] = [];
    for (const [i, r] of res.entries()) {
      if (r.from === r.to) continue;
      const tmpName = `~orelle-${Date.now()}-${i}${r.to.slice(r.to.lastIndexOf('.')) || ''}`;
      const a = await api.rename(sel[i].path, tmpName);
      if (a.ok) temp.push({ entry: sel[i], tmp: a.path!, to: r.to });
    }
    for (const x of temp) {
      const b = await api.rename(x.tmp, x.to);
      if (b.ok) { done++; moveTag(x.entry.path, b.path!); } else await api.rename(x.tmp, x.entry.name);
    }
    toast(t('files.br.done', { n: done }), done === temp.length ? 'info' : 'error');
    await load(tab());
  });
  openModal(el('div', { class: 'modal wide' }, el('h2', { text: t('files.batchRenameTitle', { n: sel.length }) }),
    el('div', { class: 'br-grid' }, find.row, replace.row, prefix.row, suffix.row, base.row, start.row),
    el('p', { class: 'br-hint', text: t('files.br.hint') }), preview, el('div', { class: 'modal-actions' }, cancel, apply)));
  update();
  setTimeout(() => find.input.focus(), 0);
}

// ---------- Actions ----------

function setClipboard(mode: 'copy' | 'move') {
  const paths = selectedEntries().map((e) => e.path);
  if (!paths.length) return;
  clipboard = { paths, mode };
  renderStatus();
  toast(t(mode === 'move' ? 'files.status.cut' : 'files.status.copied', { n: paths.length }));
}

async function paste(dest: string) {
  if (!clipboard) return;
  await api.transfer(clipboard.paths, dest, clipboard.mode);
  if (clipboard.mode === 'move') clipboard = null;
  renderStatus();
}

async function handleDrop(ev: DragEvent, dest: string) {
  ev.preventDefault();
  const paths = [...(ev.dataTransfer?.files ?? [])].map((f) => orelle.pathForFile(f)).filter(Boolean);
  if (!paths.length || paths.some((p) => p.toLowerCase() === dest.toLowerCase())) return;
  // Same drive: move (like Explorer); other drive or Ctrl: copy.
  const sameDrive = paths.every((p) => p.slice(0, 2).toLowerCase() === dest.slice(0, 2).toLowerCase());
  await api.transfer(paths, dest, ev.ctrlKey || !sameDrive ? 'copy' : 'move');
}

function startRename(e: FileEntry) {
  renaming = e.path;
  renderContent();
}

async function createFolder() {
  const here = tab().location;
  if (!isFolder(here)) return;
  const res = await api.mkdir(here, t('files.newFolderName'));
  if (!res.ok) return toast(t(`files.error.${res.error}` as StringKey), 'error');
  await load(tab());
  const e = tab().entries.find((x) => x.path === res.path);
  if (e) { select(e.path, 'only'); startRename(e); }
}

async function createTextFile() {
  const here = tab().location;
  const res = await api.newFile(here, `${t('files.newTextFileName')}.txt`);
  if (!res.ok) return toast(t(`files.error.${res.error}` as StringKey), 'error');
  await load(tab());
  const e = tab().entries.find((x) => x.path === res.path);
  if (e) { select(e.path, 'only'); startRename(e); }
}

async function trash(permanent: boolean) {
  const sel = selectedEntries();
  if (!sel.length) return;
  if (permanent) {
    const ok = await confirmModal(t('files.deleteForever.title'), t('files.deleteForever.message', { n: sel.length, name: sel[0].name }), t('files.deleteForever.confirm'), true);
    if (!ok) return;
  }
  await api.remove(sel.map((e) => e.path), permanent);
  if (!permanent) toast(t('files.trashed', { n: sel.length }));
}

async function runArchive(kind: 'compress' | 'extract', paths: string[]) {
  const here = isFolder(tab().location) ? tab().location : parentDir(paths[0]) ?? '';
  await api.archive(kind, paths, here);
}

function toggleHidden() {
  saveFiles({ showHidden: !settings.files.showHidden });
  renderContent();
  renderStatus();
}

async function showProperties(e: FileEntry) {
  const body = el('div', { class: 'props' }, el('div', { class: 'spinner' }));
  openModal(el('div', { class: 'modal' }, el('div', { class: 'modal-head' }, iconFor(e, 'big'), el('h2', { text: e.name })), body, closeRow()));
  const p = await api.properties(e.path);
  if (!p) { body.replaceChildren(el('p', { text: t('files.error.unknown') })); return; }
  const row = (k: string, v: string) => [el('dt', { text: k }), el('dd', { text: v })];
  body.replaceChildren(el('dl', {},
    ...row(t('files.col.kind'), kindLabel(e)),
    ...row(t('files.col.location'), parentDir(p.path) ?? p.path),
    ...row(t('files.col.size'), `${formatBytes(p.size, lang)} (${p.size.toLocaleString(locale())} ${lang === 'fr' ? 'octets' : 'bytes'})${p.partial ? ' ≥' : ''}`),
    ...(p.dir ? row(t('files.contents'), t('files.contents.value', { files: p.files, folders: p.folders })) : []),
    ...row(t('files.col.created'), new Date(p.created).toLocaleString(locale())),
    ...row(t('files.col.modified'), new Date(p.modified).toLocaleString(locale())),
    ...row(t('files.accessed'), new Date(p.accessed).toLocaleString(locale())),
    ...row(t('files.attributes'), p.readonly ? t('files.readonly') : '—'),
  ));
}

function closeRow() {
  const b = el('button', { class: 'btn', text: t('common.close') });
  b.addEventListener('click', closeModal);
  return el('div', { class: 'modal-actions' }, b);
}

function openModal(node: HTMLElement) {
  modalEl.replaceChildren(node);
  modalEl.hidden = false;
  modalEl.onclick = (ev) => { if (ev.target === modalEl) closeModal(); };
}

function closeModal() {
  modalEl.hidden = true;
  modalEl.replaceChildren();
  content.focus();
}

function confirmModal(title: string, message: string, confirm: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const yes = el('button', { class: `btn ${danger ? 'danger-fill' : 'primary'}`, text: confirm });
    const no = el('button', { class: 'btn', text: t('common.cancel') });
    yes.addEventListener('click', () => { closeModal(); resolve(true); });
    no.addEventListener('click', () => { closeModal(); resolve(false); });
    openModal(el('div', { class: 'modal small' }, el('h2', { text: title }), el('p', { text: message }), el('div', { class: 'modal-actions' }, no, yes)));
    setTimeout(() => no.focus(), 0);
  });
}

function toast(text: string, kind: 'info' | 'error' = 'info') {
  const node = el('div', { class: `toast ${kind}`, text });
  toastsEl.append(node);
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3000);
}

// ---------- Keyboard ----------

function columnsInGrid(): number {
  const items = content.querySelector('.items');
  const first = items?.querySelector<HTMLElement>('.item');
  if (!items || !first || view() !== 'grid') return 1;
  return Math.max(1, Math.floor(items.clientWidth / first.offsetWidth));
}

function moveSelection(delta: number, extend: boolean) {
  const list = visibleEntries();
  if (!list.length) return;
  const current = tab().cursor ? list.findIndex((e) => e.path === tab().cursor) : -1;
  const next = Math.max(0, Math.min(list.length - 1, current === -1 ? 0 : current + delta));
  const p = list[next].path;
  select(p, extend ? 'range' : 'only');
  content.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
}

let typeBuffer = '';
let typeTimer: number | null = null;

document.addEventListener('keydown', (ev) => {
  if (!modalEl.hidden) {
    if (ev.key === 'Escape') closeModal();
    return;
  }
  const target = ev.target as HTMLElement;
  const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
  const ctrl = ev.ctrlKey;
  const k = ev.key;
  if (ctrl && k.toLowerCase() === 't') { ev.preventDefault(); openTab(isFolder(tab().location) ? tab().location : undefined); return; }
  if (ctrl && k.toLowerCase() === 'w') { ev.preventDefault(); closeTab(active); return; }
  if (ctrl && k.toLowerCase() === 'n' && !ev.shiftKey) { ev.preventDefault(); api.newWindow(isFolder(tab().location) ? tab().location : undefined); return; }
  if (ctrl && ev.shiftKey && k.toLowerCase() === 'n') { ev.preventDefault(); void createFolder(); return; }
  if (ctrl && k.toLowerCase() === 'f') { ev.preventDefault(); toolbar.querySelector<HTMLInputElement>('.search')?.focus(); return; }
  if (ctrl && k.toLowerCase() === 'l') { ev.preventDefault(); const c = toolbar.querySelector<HTMLElement>('.crumbs'); if (c && isFolder(tab().location)) editPath(c); return; }
  if (ctrl && k === 'Tab') { ev.preventDefault(); active = (active + (ev.shiftKey ? tabs.length - 1 : 1)) % tabs.length; void load(tab()); return; }
  if (ev.altKey && k === 'ArrowLeft') { ev.preventDefault(); goBack(); return; }
  if (ev.altKey && k === 'ArrowRight') { ev.preventDefault(); goForward(); return; }
  if (ev.altKey && k === 'ArrowUp') { ev.preventDefault(); goUp(); return; }
  if (k === 'F5' && ev.shiftKey) { ev.preventDefault(); void toOtherPane('copy'); return; }
  if (k === 'F6' && ev.shiftKey) { ev.preventDefault(); void toOtherPane('move'); return; }
  if (k === 'F3') { ev.preventDefault(); setDual(panes.length === 1); return; }
  if (k === 'F5') { ev.preventDefault(); void load(tab()); return; }
  if (typing) return;
  if (ctrl && ['1', '2', '3'].includes(k)) { ev.preventDefault(); saveFiles({ view: (['grid', 'list', 'details'] as const)[Number(k) - 1] }); renderToolbar(); renderContent(); return; }
  if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); tab().selected = new Set(visibleEntries().map((e) => e.path)); paintSelection(); renderStatus(); return; }
  if (ctrl && k.toLowerCase() === 'c') { ev.preventDefault(); setClipboard('copy'); return; }
  if (ctrl && k.toLowerCase() === 'x') { ev.preventDefault(); setClipboard('move'); return; }
  if (ctrl && k.toLowerCase() === 'v') { ev.preventDefault(); if (isFolder(tab().location)) void paste(tab().location); return; }
  if (ctrl && k.toLowerCase() === 'h') { ev.preventDefault(); toggleHidden(); return; }
  if (k === 'Backspace') { ev.preventDefault(); goBack(); return; }
  if (k === 'F2') { const s = selectedEntries(); if (s.length === 1) startRename(s[0]); else if (s.length > 1) void batchRenameModal(s); return; }
  if (k === 'Tab' && panes.length > 1 && !ctrl) { ev.preventDefault(); focusPane(1 - cur); panes[cur].content.focus(); return; }
  if (ctrl && (k === '+' || k === '=')) { ev.preventDefault(); setIconSize(settings.files.iconSize + 8); return; }
  if (ctrl && k === '-') { ev.preventDefault(); setIconSize(settings.files.iconSize - 8); return; }
  if (k === 'Delete') { ev.preventDefault(); void trash(ev.shiftKey); return; }
  if (k === 'Enter' && ev.altKey) { const s = selectedEntries(); if (s[0]) void showProperties(s[0]); return; }
  if (k === 'Enter') { ev.preventDefault(); selectedEntries().forEach((e) => void openEntry(e, ctrl)); return; }
  if (k === ' ') { ev.preventDefault(); showPreview = !showPreview; render(); return; }
  if (k === 'Escape') { tab().selected.clear(); paintSelection(); renderStatus(); return; }
  const cols = columnsInGrid();
  if (k === 'ArrowDown') { ev.preventDefault(); moveSelection(view() === 'grid' ? cols : 1, ev.shiftKey); return; }
  if (k === 'ArrowUp') { ev.preventDefault(); moveSelection(view() === 'grid' ? -cols : -1, ev.shiftKey); return; }
  if (k === 'ArrowRight' && view() === 'grid') { ev.preventDefault(); moveSelection(1, ev.shiftKey); return; }
  if (k === 'ArrowLeft' && view() === 'grid') { ev.preventDefault(); moveSelection(-1, ev.shiftKey); return; }
  if (k === 'Home') { ev.preventDefault(); moveSelection(-1e6, ev.shiftKey); return; }
  if (k === 'End') { ev.preventDefault(); moveSelection(1e6, ev.shiftKey); return; }
  // Type-to-select: jump to the first item starting with the typed letters.
  if (k.length === 1 && !ctrl && !ev.altKey) {
    typeBuffer += k.toLowerCase();
    if (typeTimer) clearTimeout(typeTimer);
    typeTimer = window.setTimeout(() => (typeBuffer = ''), 700);
    const hit = visibleEntries().find((e) => e.name.toLowerCase().startsWith(typeBuffer));
    if (hit) { select(hit.path, 'only'); content.querySelector<HTMLElement>(`[data-path="${CSS.escape(hit.path)}"]`)?.scrollIntoView({ block: 'nearest' }); }
  }
});

// Resizable details panel.
pvResize.addEventListener('pointerdown', (ev) => {
  pvResize.setPointerCapture(ev.pointerId);
  const startX = ev.clientX;
  const startW = previewEl.getBoundingClientRect().width;
  const move = (e: PointerEvent) => { previewEl.style.width = `${Math.max(240, Math.min(640, startW + (startX - e.clientX)))}px`; };
  const up = () => {
    pvResize.removeEventListener('pointermove', move);
    saveFiles({ previewWidth: Math.round(previewEl.getBoundingClientRect().width) });
  };
  pvResize.addEventListener('pointermove', move);
  pvResize.addEventListener('pointerup', up, { once: true });
});
// Mouse back/forward buttons.
window.addEventListener('mouseup', (ev) => {
  if (ev.button === 3) goBack();
  if (ev.button === 4) goForward();
});

// ---------- Wiring ----------

api.onChanged((dir) => {
  if (tab().location.toLowerCase() === dir.toLowerCase()) void load(tab());
});

function reloadAll() {
  syncPane();
  for (const p of panes) void load(p.tabs[p.active]);
}
api.onProgress((op) => {
  ops.set(op.id, op);
  renderStatus();
  if (op.finished) {
    ops.delete(op.id);
    if (op.error) toast(t(`files.error.${op.error}` as StringKey), 'error');
    else if (op.kind === 'compress' || op.kind === 'extract') toast(t(`files.op.${op.kind}.done` as StringKey));
    reloadAll();
  }
});
orelle.onIconsChanged(() => void loadIconsAgain());

async function loadIconsAgain() {
  syncPane();
  const all = panes.flatMap((p) => p.tabs[p.active]?.entries ?? []).slice(0, 600);
  const res = await api.icons(all.map((e) => ({ path: e.path, dir: e.dir })));
  for (const [p, url] of Object.entries(res)) if (url) icons.set(p, url);
  updateIconsInPlace();
}

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  places = await api.places();
  const start = api.startPath() ?? places.find((p) => p.kind === 'home')?.path ?? places[0]?.path ?? 'C:\\';
  const first = makePane($('pane0'));
  first.tabs = [newTab(start)];
  panes.push(first);
  tabs = first.tabs;
  active = 0;
  render();
  void load(tab());
  if (settings.files.dualPane) setDual(true);
  content.focus();
  orelle.onSettings((p) => {
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    renderSidebar();
  });
}

void init();
