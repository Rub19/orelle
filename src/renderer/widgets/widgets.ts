// Desktop widgets renderer: one layer hosting every widget, with an edit mode (move, resize,
// opacity, options, add/remove). Content edits (notes, to-dos, shortcuts) persist in settings.
import { WIDGET_SIZES, WIDGET_TYPES } from '../../shared/settings';
import type { StringKey } from '../../shared/i18n';
import type { Settings, SystemStats, WidgetInstance, WidgetType } from '../../shared/types';
import { clampRect, formatBytes, formatClock, formatDuration, monthMatrix, snap, weatherGlyph } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const layer = document.getElementById('layer')!;
const toolbar = document.getElementById('toolbar')!;

let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let items: WidgetInstance[] = [];
let editing = false;
let interactive = false;
let localWrites = 0;
let stats: SystemStats | null = null;
const cpuHistory: number[] = [];
const netHistory: { down: number; up: number }[] = [];

interface Mounted {
  node: HTMLElement;
  sig: string;
  cleanup: () => void;
  onTick?: (now: Date) => void;
  onStats?: (s: SystemStats) => void;
}
const mounted = new Map<string, Mounted>();

const TYPE_GLYPH: Record<WidgetType, string> = {
  clock: 'clock', calendar: 'calendar', weather: 'partly', system: 'cpu', network: 'network', battery: 'battery', media: 'playPause',
  notes: 'note', todo: 'list', timer: 'timer', recentApps: 'grid', shortcuts: 'link', appUsage: 'chart',
};
const locale = () => (lang === 'fr' ? 'fr-FR' : 'en-US');
const typeLabel = (type: WidgetType) => t(`widgets.type.${type}` as StringKey);

// ---------- Persistence ----------

let saveTimer: number | null = null;
function save(delay = 0) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    localWrites++;
    await orelle.updateSettings({ widgets: { items } });
    setTimeout(() => localWrites--, 300);
  }, delay);
}

function patchItem(id: string, patch: Partial<WidgetInstance>, delay = 0) {
  items = items.map((w) => (w.id === id ? { ...w, ...patch } : w));
  save(delay);
}

function patchConfig(id: string, config: Record<string, unknown>, delay = 600) {
  const w = items.find((x) => x.id === id);
  if (w) patchItem(id, { config: { ...w.config, ...config } }, delay);
}

// ---------- Widget builders ----------

type Builder = (inst: WidgetInstance, body: HTMLElement) => Omit<Mounted, 'node' | 'sig'>;

const title = (type: WidgetType, extra?: Node | null) =>
  el('div', { class: 'w-title', html: glyph(TYPE_GLYPH[type]) }, typeLabel(type), el('span', { class: 'spacer' }), extra ?? null);

const clock: Builder = (inst, body) => {
  const style = (inst.config.style as string) ?? 'digital';
  body.addEventListener('dblclick', () => orelle.widgets.openSystem('clock'));
  if (style === 'analog') {
    const svg = `<svg viewBox="0 0 100 100"><circle class="face" cx="50" cy="50" r="46"/>${Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return `<line class="tick" x1="${50 + Math.sin(a) * 38}" y1="${50 - Math.cos(a) * 38}" x2="${50 + Math.sin(a) * 42}" y2="${50 - Math.cos(a) * 42}"/>`;
    }).join('')}<line class="hand h" x1="50" y1="50" x2="50" y2="28" stroke-width="4"/><line class="hand m" x1="50" y1="50" x2="50" y2="16" stroke-width="2.6"/><line class="hand sec" x1="50" y1="56" x2="50" y2="12"/><circle cx="50" cy="50" r="2.6" fill="var(--accent)"/></svg>`;
    const meta = el('div', { class: 'meta' }, el('strong'), el('span'));
    body.append(el('div', { class: 'clock-analog', html: svg }, meta));
    const [h, m, s] = ['.h', '.m', '.sec'].map((c) => body.querySelector<SVGLineElement>(c)!);
    return {
      cleanup() {},
      onTick(now) {
        const sec = now.getSeconds();
        const min = now.getMinutes() + sec / 60;
        const hr = (now.getHours() % 12) + min / 60;
        h.setAttribute('transform', `rotate(${hr * 30} 50 50)`);
        m.setAttribute('transform', `rotate(${min * 6} 50 50)`);
        s.setAttribute('transform', `rotate(${sec * 6} 50 50)`);
        meta.firstElementChild!.textContent = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
        meta.lastElementChild!.textContent = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
      },
    };
  }
  if (style === 'minimal') {
    const node = el('div', { class: 'clock-minimal' });
    body.append(node);
    return { cleanup() {}, onTick: (now) => (node.textContent = now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })) };
  }
  const time = el('div', { class: 'time' });
  const date = el('div', { class: 'date' });
  body.append(el('div', { class: 'clock-digital' }, time, date));
  return {
    cleanup() {},
    onTick(now) {
      time.replaceChildren(now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }), el('small', { text: String(now.getSeconds()).padStart(2, '0') }));
      date.textContent = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
    },
  };
};

const calendar: Builder = (_inst, body) => {
  let cursor = new Date();
  cursor.setDate(1);
  const head = el('div', { class: 'cal-head' });
  const grid = el('div', { class: 'cal-grid' });
  body.append(head, grid);
  let renderedDay = '';
  const render = () => {
    const today = new Date();
    renderedDay = today.toDateString();
    const label = el('strong', { text: cursor.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) });
    label.addEventListener('dblclick', () => orelle.widgets.openSystem('calendar'));
    const prev = el('button', { text: '‹', 'aria-label': 'previous' });
    const next = el('button', { text: '›', 'aria-label': 'next' });
    prev.addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); });
    next.addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); });
    head.replaceChildren(label, el('div', { class: 'nav' }, prev, next));
    const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: 'narrow' }));
    grid.replaceChildren(
      ...dows.map((d) => el('div', { class: 'dow', text: d })),
      ...monthMatrix(cursor.getFullYear(), cursor.getMonth()).map(({ date, inMonth }, i) => {
        const cls = ['day', inMonth ? '' : 'other', date.toDateString() === today.toDateString() ? 'today' : '', i % 7 >= 5 ? 'weekend' : ''].join(' ');
        return el('div', { class: cls, text: date.getDate() });
      }),
    );
  };
  render();
  return { cleanup() {}, onTick: (now) => { if (now.toDateString() !== renderedDay) render(); } };
};

const weather: Builder = (_inst, body) => {
  const content = el('div', { class: 'w-empty', text: '…' });
  body.append(title('weather'), content);
  let alive = true;
  const load = async (force = false) => {
    const w = settings.widgets.weather;
    if (w.latitude === null) {
      content.replaceWith(el('div', { class: 'w-empty', text: t('widgets.weather.setup') }));
      return;
    }
    const d = await orelle.widgets.weather(force);
    if (!alive) return;
    const holder = el('div', { class: 'col-fill' });
    if (!d) holder.append(el('div', { class: 'w-empty', text: t('widgets.weather.offline') }));
    else {
      holder.append(
        el('div', { class: 'weather-now', html: glyph(weatherGlyph(d.code), 'glyph big') },
          el('div', { class: 'temp', text: `${d.temperature}°` }),
          el('div', { class: 'meta' }, el('strong', { text: d.city }), `↑ ${d.high}°  ↓ ${d.low}°`)),
        el('div', { class: 'weather-days' }, ...d.daily.slice(1, 5).map((day) =>
          el('div', { html: glyph(weatherGlyph(day.code)) },
            new Date(day.date).toLocaleDateString(locale(), { weekday: 'short' }),
            el('b', { text: `${day.high}°` })))),
      );
    }
    body.querySelector('.weather-body')?.remove();
    holder.classList.add('weather-body');
    body.querySelector('.w-empty')?.remove();
    body.append(holder);
  };
  void load();
  const timer = window.setInterval(() => void load(), 30 * 60_000);
  return { cleanup() { alive = false; clearInterval(timer); } };
};

function bar(value: number, max: number): HTMLElement {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const i = el('i', { class: pct > 90 ? 'crit' : pct > 75 ? 'warn' : '' });
  i.style.width = `${pct}%`;
  return el('div', { class: 'bar' }, i);
}

function sparkline(values: number[], max: number, cls = ''): string {
  const n = 40;
  const pts = values.slice(-n);
  if (pts.length < 2) return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
  const step = 100 / (n - 1);
  const off = n - pts.length;
  const coords = pts.map((v, i) => `${((off + i) * step).toFixed(1)},${(29 - (Math.min(v, max) / (max || 1)) * 27).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path class="area" d="M${coords[0].split(',')[0]},30 L${coords.join(' L')} L100,30 Z"/><path class="line ${cls}" d="M${coords.join(' L')}"/></svg>`;
}

const system: Builder = (_inst, body) => {
  const rows = el('div', {});
  const spark = el('div', { class: 'spark-wrap' });
  body.append(title('system'), rows, spark);
  body.addEventListener('dblclick', () => orelle.widgets.openSystem('system'));
  const render = (s: SystemStats) => {
    const disk = s.disks[0];
    const meters = [
      el('div', { class: 'meter' }, el('span', { class: 'label', text: t('widgets.cpu') }), bar(s.cpu, 100), el('span', { class: 'value', text: `${Math.round(s.cpu)} %` })),
      el('div', { class: 'meter' }, el('span', { class: 'label', text: t('widgets.ram') }), bar(s.memUsed, s.memTotal), el('span', { class: 'value', text: `${Math.round((s.memUsed / s.memTotal) * 100)} %` })),
    ];
    if (disk) meters.push(el('div', { class: 'meter' }, el('span', { class: 'label', text: `${t('widgets.disk')} ${disk.mount}` }), bar(disk.used, disk.total), el('span', { class: 'value', text: `${Math.round((disk.used / disk.total) * 100)} %`, title: formatBytes(disk.total - disk.used, lang) })));
    rows.replaceChildren(...meters);
    spark.innerHTML = sparkline(cpuHistory, 100);
  };
  if (stats) render(stats);
  return { cleanup() {}, onStats: render };
};

const network: Builder = (_inst, body) => {
  const rates = el('div', { class: 'net-rates' });
  const spark = el('div', { class: 'spark-wrap' });
  body.append(title('network'), rates, spark);
  body.addEventListener('dblclick', () => orelle.widgets.openSystem('network'));
  const render = (s: SystemStats) => {
    rates.replaceChildren(
      el('div', {}, el('span', { text: `↓ ${t('widgets.down')}` }), el('strong', { text: formatBytes(s.netDown, lang, true) })),
      el('div', {}, el('span', { text: `↑ ${t('widgets.up')}` }), el('strong', { text: formatBytes(s.netUp, lang, true) })),
    );
    const max = Math.max(1024, ...netHistory.map((h) => Math.max(h.down, h.up)));
    spark.innerHTML = sparkline(netHistory.map((h) => h.down), max);
  };
  if (stats) render(stats);
  return { cleanup() {}, onStats: render };
};

const battery: Builder = (_inst, body) => {
  const wrap = el('div', { class: 'battery-wrap' });
  body.append(wrap);
  body.addEventListener('dblclick', () => orelle.widgets.openSystem('battery'));
  const C = 2 * Math.PI * 26;
  const render = (s: SystemStats) => {
    const b = s.battery;
    if (!b || !b.present) {
      wrap.replaceChildren(el('div', { class: 'w-empty', text: t('widgets.battery.none') }));
      return;
    }
    const ring = `<svg class="ring" viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg${b.percent <= 20 && !b.charging ? ' low' : ''}" cx="32" cy="32" r="26" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - b.percent / 100)}"/></svg>`;
    const sub = b.charging ? t('control.charging') : b.minutesLeft ? formatDuration(b.minutesLeft * 60000) : t('control.battery');
    wrap.replaceChildren(el('div', { html: ring }), el('div', {}, el('strong', { text: `${b.percent} %` }), el('span', { text: sub })));
  };
  if (stats) render(stats);
  return { cleanup() {}, onStats: render };
};

const media: Builder = (_inst, body) => {
  const btn = (g: string, key: 'previous' | 'playPause' | 'next', big = false) => {
    const b = el('button', { class: `w-btn round${big ? ' big primary' : ''}`, html: glyph(g), 'aria-label': key });
    b.addEventListener('click', () => orelle.widgets.media(key));
    return b;
  };
  body.append(title('media'), el('div', { class: 'media-row' }, btn('previous', 'previous'), btn('playPause', 'playPause', true), btn('next', 'next')), el('div', { class: 'w-muted center', text: t('control.media.hint') }));
  return { cleanup() {} };
};

const notes: Builder = (inst, body) => {
  const ta = el('textarea', { class: 'notes', placeholder: t('widgets.notes.placeholder'), spellcheck: 'true' });
  ta.value = String(inst.config.text ?? '');
  ta.addEventListener('input', () => patchConfig(inst.id, { text: ta.value.slice(0, 20000) }));
  body.append(title('notes'), ta);
  return { cleanup() {} };
};

interface Todo { id: string; text: string; done: boolean }
const todo: Builder = (inst, body) => {
  let list: Todo[] = Array.isArray(inst.config.items) ? (inst.config.items as Todo[]) : [];
  const ul = el('ul', { class: 'todo-list' });
  const input = el('input', { class: 'todo-add', placeholder: t('widgets.todo.placeholder') });
  const commit = () => { patchConfig(inst.id, { items: list }, 300); render(); };
  const render = () => {
    ul.replaceChildren(...(list.length ? list.map((it) => {
      const check = el('button', { class: `check${it.done ? ' on' : ''}`, 'aria-label': 'done' });
      check.addEventListener('click', () => { it.done = !it.done; commit(); });
      const del = el('button', { class: 'del', text: '×', 'aria-label': 'delete' });
      del.addEventListener('click', () => { list = list.filter((x) => x.id !== it.id); commit(); });
      return el('li', { class: it.done ? 'done' : '' }, check, el('span', { text: it.text }), del);
    }) : [el('li', { class: 'w-empty', text: t('widgets.todo.empty') })]));
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      list = [...list, { id: crypto.randomUUID().slice(0, 8), text: input.value.trim().slice(0, 300), done: false }].slice(-100);
      input.value = '';
      commit();
    }
  });
  render();
  body.append(title('todo', el('span', { text: `${list.filter((x) => !x.done).length || ''}` })), ul, input);
  return { cleanup() {} };
};

const timer: Builder = (inst, body) => {
  let mode: 'timer' | 'stopwatch' = inst.config.mode === 'stopwatch' ? 'stopwatch' : 'timer';
  let duration = Number(inst.config.minutes ?? 25) * 60_000;
  let elapsed = 0;
  let startedAt: number | null = null;
  let notified = false;
  const display = el('div', { class: 'timer-display' });
  const startBtn = el('button', { class: 'w-btn primary' });
  const resetBtn = el('button', { class: 'w-btn', text: t('widgets.timer.reset') });
  const presets = el('div', { class: 'presets' }, ...[5, 10, 25, 50].map((m) => {
    const b = el('button', { text: `${m}′` });
    b.addEventListener('click', () => { duration = m * 60_000; elapsed = 0; startedAt = null; notified = false; patchConfig(inst.id, { minutes: m }, 0); update(); });
    return b;
  }));
  const head = el('div', { class: 'timer-head' });
  const current = () => elapsed + (startedAt ? Date.now() - startedAt : 0);
  const update = () => {
    head.replaceChildren(...(['timer', 'stopwatch'] as const).map((m) => {
      const b = el('button', { class: m === mode ? 'on' : '', text: t(`widgets.timer.${m}`) });
      b.addEventListener('click', () => { mode = m; elapsed = 0; startedAt = null; notified = false; patchConfig(inst.id, { mode: m }, 0); update(); });
      return b;
    }));
    const value = mode === 'timer' ? duration - current() : current();
    const done = mode === 'timer' && value <= 0;
    display.textContent = formatClock(done ? 0 : value);
    display.classList.toggle('done', done);
    startBtn.replaceChildren(startedAt ? t('widgets.timer.pause') : t('widgets.timer.start'));
    presets.hidden = mode !== 'timer';
    if (done && !notified) {
      notified = true;
      startedAt = null;
      elapsed = duration;
      new Notification('Orelle', { body: t('widgets.timer.done'), silent: false });
    }
  };
  startBtn.addEventListener('click', () => {
    if (startedAt) { elapsed += Date.now() - startedAt; startedAt = null; }
    else { if (mode === 'timer' && current() >= duration) { elapsed = 0; notified = false; } startedAt = Date.now(); }
    update();
  });
  resetBtn.addEventListener('click', () => { elapsed = 0; startedAt = null; notified = false; update(); });
  body.append(head, display, el('div', { class: 'timer-controls' }, startBtn, resetBtn, presets));
  update();
  return { cleanup() {}, onTick: () => { if (startedAt) update(); } };
};

function appTile(name: string, icon: string | null, fallback: string, onClick: () => void) {
  const art = icon ? el('img', { src: icon, alt: '' }) : el('div', { class: 'ph', html: glyph(fallback) });
  const b = el('button', { title: name }, art, el('span', { text: name }));
  b.addEventListener('click', onClick);
  return b;
}

const recentApps: Builder = (_inst, body) => {
  const grid = el('div', { class: 'app-grid' });
  body.append(grid);
  let alive = true;
  const load = async () => {
    const apps = await orelle.widgets.recentApps();
    if (!alive) return;
    grid.replaceChildren(...(apps.length ? apps.map((a) => appTile(a.name, a.icon, 'window', () => void orelle.widgets.launchRecent(a.id))) : [el('div', { class: 'w-empty', text: t('widgets.recent.empty') })]));
  };
  void load();
  const timer = window.setInterval(() => void load(), 60_000);
  const offIcons = orelle.onIconsChanged(() => void load());
  return { cleanup() { alive = false; clearInterval(timer); offIcons(); } };
};

interface Shortcut { name: string; target: string }
const shortcuts: Builder = (inst, body) => {
  let list: Shortcut[] = Array.isArray(inst.config.items) ? (inst.config.items as Shortcut[]) : [];
  const grid = el('div', { class: 'app-grid' });
  body.append(grid);
  const render = async () => {
    if (!list.length) {
      grid.replaceChildren(el('div', { class: 'w-empty', text: t('widgets.shortcuts.empty') }));
      return;
    }
    const tiles = await Promise.all(list.map(async (s) => {
      const isUrl = /^https?:\/\//i.test(s.target);
      const icon = isUrl ? null : await orelle.widgets.shortcutIcon(s.target);
      const tile = appTile(s.name, icon, isUrl ? 'globe' : 'file', () => void orelle.widgets.open(s.target));
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!editing) return;
        list = list.filter((x) => x !== s);
        patchConfig(inst.id, { items: list }, 0);
        void render();
      });
      return tile;
    }));
    grid.replaceChildren(...tiles);
  };
  const widget = () => body.parentElement!;
  body.addEventListener('dragover', (e) => { e.preventDefault(); widget().classList.add('drop'); });
  body.addEventListener('dragleave', () => widget().classList.remove('drop'));
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    widget().classList.remove('drop');
    const files = [...(e.dataTransfer?.files ?? [])].map((f) => orelle.pathForFile(f)).filter(Boolean);
    const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    const added: Shortcut[] = files.map((p) => ({ name: p.split(/[\\/]/).pop()!.replace(/\.(lnk|url)$/i, ''), target: p }));
    if (!files.length && url && /^https?:\/\//i.test(url.trim())) added.push({ name: new URL(url.trim()).hostname.replace(/^www\./, ''), target: url.trim() });
    if (!added.length) return;
    list = [...list, ...added].slice(0, 24);
    patchConfig(inst.id, { items: list }, 0);
    void render();
  });
  void render();
  const offIcons = orelle.onIconsChanged(() => void render());
  return { cleanup() { offIcons(); } };
};

const appUsage: Builder = (_inst, body) => {
  const rows = el('div', { class: 'col-fill clip' });
  body.append(title('appUsage', el('span', { text: t('widgets.usage.today') })), rows);
  let alive = true;
  const load = async () => {
    const list = await orelle.widgets.screenTime();
    if (!alive) return;
    const max = Math.max(1, ...list.map((x) => x.ms));
    rows.replaceChildren(...(list.length ? list.map((x) => {
      const i = el('i');
      i.style.width = `${(x.ms / max) * 100}%`;
      return el('div', { class: 'usage-row' }, el('span', { class: 'name', text: x.name }), el('span', { class: 'dur', text: formatDuration(x.ms) }), el('div', { class: 'bar' }, i));
    }) : [el('div', { class: 'w-empty', text: t('widgets.usage.empty') })]));
  };
  void load();
  const timer = window.setInterval(() => void load(), 60_000);
  return { cleanup() { alive = false; clearInterval(timer); } };
};

const BUILDERS: Record<WidgetType, Builder> = { clock, calendar, weather, system, network, battery, media, notes, todo, timer, recentApps, shortcuts, appUsage };

// ---------- Mounting & reconciliation ----------

/** Content signature: options that require rebuilding the widget's body. Position/size/opacity don't. */
function signature(w: WidgetInstance) {
  const opts = w.type === 'clock' ? w.config.style : w.type === 'weather' ? JSON.stringify(settings.widgets.weather) : '';
  return `${w.type}|${opts}|${lang}`;
}

function place(node: HTMLElement, w: WidgetInstance) {
  const r = clampRect(w, { w: window.innerWidth, h: window.innerHeight });
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
  node.style.opacity = String(w.opacity);
  node.classList.toggle('hidden-widget', w.hidden);
}

function editChrome(w: WidgetInstance): HTMLElement {
  const bar = el('div', { class: 'edit-chrome' }, el('strong', { text: typeLabel(w.type) }));
  if (w.type === 'clock') {
    const sel = el('select', { 'aria-label': t('widgets.clock.style') });
    for (const s of ['digital', 'analog', 'minimal']) {
      const o = el('option', { value: s, text: t(`widgets.clock.${s}` as StringKey) });
      if ((w.config.style ?? 'digital') === s) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => { patchConfig(w.id, { style: sel.value }, 0); render(); });
    bar.append(sel);
  }
  const op = el('input', { type: 'range', min: 0.3, max: 1, step: 0.05, value: w.opacity, title: t('widgets.opacity') });
  op.addEventListener('input', () => {
    patchItem(w.id, { opacity: Number(op.value) }, 400);
    mounted.get(w.id)!.node.style.opacity = op.value;
  });
  const hide = el('button', { html: glyph('eyeOff'), title: t('widgets.hide') });
  hide.addEventListener('click', () => { patchItem(w.id, { hidden: !items.find((x) => x.id === w.id)!.hidden }); render(); });
  const del = el('button', { class: 'danger', html: glyph('close'), title: t('widgets.remove') });
  del.addEventListener('click', () => { items = items.filter((x) => x.id !== w.id); save(); render(); });
  bar.append(op, hide, del);
  for (const c of bar.querySelectorAll('select,input,button')) c.addEventListener('pointerdown', (e) => e.stopPropagation());
  return bar;
}

function mount(w: WidgetInstance): Mounted {
  const node = el('div', { class: `widget w-${w.type}`, 'data-id': w.id });
  const body = el('div', { class: 'body' });
  const handle = el('div', { class: 'resize-handle' });
  node.append(body, editChrome(w), handle);
  const built = BUILDERS[w.type](w, body);
  enableDrag(node, w.id);
  enableResize(handle, node, w.id);
  return { node, sig: signature(w), ...built };
}

function render() {
  const seen = new Set<string>();
  for (const w of items) {
    seen.add(w.id);
    let m = mounted.get(w.id);
    if (m && m.sig !== signature(w)) {
      m.cleanup();
      m.node.remove();
      mounted.delete(w.id);
      m = undefined;
    }
    if (!m) {
      m = mount(w);
      mounted.set(w.id, m);
      layer.append(m.node);
    } else {
      // Rebuild only the chrome (reflects opacity / hidden / options).
      m.node.querySelector('.edit-chrome')!.replaceWith(editChrome(w));
    }
    place(m.node, w);
  }
  for (const [id, m] of mounted) {
    if (seen.has(id)) continue;
    m.cleanup();
    m.node.remove();
    mounted.delete(id);
  }
  syncStatsSubscription();
  renderToolbar();
}

let statsOn = false;
function syncStatsSubscription() {
  const want = items.some((w) => !w.hidden && (w.type === 'system' || w.type === 'network' || w.type === 'battery'));
  if (want !== statsOn) {
    statsOn = want;
    orelle.widgets.subscribeStats(want);
  }
}

// ---------- Edit mode: move / resize ----------

function enableDrag(node: HTMLElement, id: string) {
  node.addEventListener('pointerdown', (e) => {
    if (!editing || e.button !== 0 || (e.target as HTMLElement).closest('.resize-handle,.edit-chrome')) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    node.classList.add('dragging');
    const start = { x: e.clientX, y: e.clientY, left: node.offsetLeft, top: node.offsetTop };
    const move = (ev: PointerEvent) => {
      const x = start.left + ev.clientX - start.x;
      const y = start.top + ev.clientY - start.y;
      const r = clampRect({ x: ev.altKey ? x : snap(x), y: ev.altKey ? y : snap(y), w: node.offsetWidth, h: node.offsetHeight }, { w: innerWidth, h: innerHeight });
      node.style.left = `${r.x}px`;
      node.style.top = `${r.y}px`;
    };
    const up = () => {
      node.classList.remove('dragging');
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      patchItem(id, { x: node.offsetLeft, y: node.offsetTop });
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  });
}

function enableResize(handle: HTMLElement, node: HTMLElement, id: string) {
  handle.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, w: node.offsetWidth, h: node.offsetHeight };
    const move = (ev: PointerEvent) => {
      node.style.width = `${Math.max(140, snap(start.w + ev.clientX - start.x))}px`;
      node.style.height = `${Math.max(80, snap(start.h + ev.clientY - start.y))}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      patchItem(id, { w: node.offsetWidth, h: node.offsetHeight });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function renderToolbar() {
  toolbar.hidden = !editing;
  if (!editing) return;
  const chips = WIDGET_TYPES.map((type) => {
    const b = el('button', { class: 'chip', html: glyph(TYPE_GLYPH[type]) }, typeLabel(type));
    b.addEventListener('click', () => addWidget(type));
    return b;
  });
  const done = el('button', { class: 'w-btn primary done', text: t('widgets.done') });
  done.addEventListener('click', () => orelle.widgets.setEditing(false));
  toolbar.replaceChildren(el('span', { class: 'tb-title', text: t('widgets.add') }), ...chips, done, el('div', { class: 'hint', text: t('widgets.hint') }));
}

function addWidget(type: WidgetType) {
  const size = WIDGET_SIZES[type];
  // Cascade new widgets from the centre so they never stack exactly.
  const n = items.length % 6;
  const r = clampRect({ x: innerWidth / 2 - size.w / 2 + n * 24, y: 120 + n * 24, ...size }, { w: innerWidth, h: innerHeight });
  items = [...items, { id: crypto.randomUUID(), type, ...r, opacity: 1, hidden: false, config: type === 'clock' ? { style: 'digital' } : {} }];
  save();
  render();
}

function setEditing(on: boolean) {
  editing = on;
  document.body.classList.toggle('editing', on);
  if (on) setInteractive(true);
  renderToolbar();
}

// ---------- Click-through ----------

function setInteractive(on: boolean) {
  if (on === interactive) return;
  interactive = on;
  orelle.widgets.setInteractive(on);
}

document.addEventListener('mousemove', (e) => {
  if (e.buttons) return;
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const over = !!hit && (hit.closest('.widget:not(.hidden-widget)') !== null || hit.closest('.toolbar') !== null || (editing && hit.closest('.widget') !== null));
  setInteractive(over);
});
document.addEventListener('mouseleave', () => { if (!editing) setInteractive(false); });
window.addEventListener('resize', () => render());

// ---------- Ticking: one shared 1 s timer, only while a time-based widget is shown ----------

setInterval(() => {
  if (document.hidden) return;
  const now = new Date();
  for (const m of mounted.values()) m.onTick?.(now);
}, 1000);

// ---------- Wiring ----------

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  items = settings.widgets.items;
  render();
  const now = new Date();
  for (const m of mounted.values()) m.onTick?.(now);

  orelle.onSettings((p) => {
    const langChanged = p.language !== lang;
    const weatherChanged = JSON.stringify(p.settings.widgets.weather) !== JSON.stringify(settings.widgets.weather);
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    // Ignore echoes of our own writes; apply changes made elsewhere (Preferences, profile import).
    if (localWrites === 0 || langChanged || weatherChanged) {
      if (JSON.stringify(items) !== JSON.stringify(settings.widgets.items) || langChanged || weatherChanged) {
        items = settings.widgets.items;
        render();
      }
    }
  });
  orelle.widgets.onEdit((on) => setEditing(on));
  orelle.widgets.onStats((s) => {
    stats = s;
    cpuHistory.push(s.cpu);
    netHistory.push({ down: s.netDown, up: s.netUp });
    if (cpuHistory.length > 60) cpuHistory.shift();
    if (netHistory.length > 60) netHistory.shift();
    for (const m of mounted.values()) m.onStats?.(s);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editing) orelle.widgets.setEditing(false);
  });
}

void init();
