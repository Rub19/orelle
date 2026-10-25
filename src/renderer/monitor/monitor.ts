// Orelle Monitor: real-time system overview with history, processes (CPU, memory, disk, GPU),
// startup apps (reversible), services and hardware. Data comes from the main process only while
// this window is visible; nothing here is simulated.
import type { MonitorSampleDto, ProcRow, StartupItemDto } from '../../shared/appTypes';
import type { StringKey } from '../../shared/i18n';
import type { Settings } from '../../shared/types';
import { formatBytes, formatDuration } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const api = orelle.monitor;
const sidebar = document.getElementById('sidebar')!;
const head = document.getElementById('head')!;
const page = document.getElementById('page')!;
const toastsEl = document.getElementById('toasts')!;

type Tab = 'overview' | 'processes' | 'startup' | 'services' | 'system';
const TABS: { id: Tab; glyph: string }[] = [
  { id: 'overview', glyph: 'chart' },
  { id: 'processes', glyph: 'rows' },
  { id: 'startup', glyph: 'power' },
  { id: 'services', glyph: 'settings' },
  { id: 'system', glyph: 'cpu' },
];

let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let tab: Tab = 'overview';
let latest: MonitorSampleDto | null = null;
let history: Omit<MonitorSampleDto, 'processes'>[] = [];
let query = '';
let sort: { key: 'display' | 'cpu' | 'memory' | 'disk' | 'gpu' | 'pid'; desc: boolean } = { key: 'cpu', desc: true };
let selectedPid: number | null = null;
let startup: StartupItemDto[] | null = null;
let journalCount = 0;
let services: { name: string; display: string; state: string; start: string; pid: number }[] | null = null;
let info: Record<string, unknown> | null = null;

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n < 10 ? n.toFixed(1) : Math.round(n)} %`);
const rate = (n: number | null | undefined) => (n == null ? '—' : formatBytes(n, lang, true));

function toast(text: string, kind: 'info' | 'error' = 'info') {
  const node = el('div', { class: `toast ${kind}`, text });
  toastsEl.append(node);
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3000);
}

// ---------- Charts ----------

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Line + area chart on a canvas, crisp on any DPI. `max` null = auto-scale. */
function drawChart(canvas: HTMLCanvasElement, series: (number | null)[][], max: number | null, colors: string[]) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const top = max ?? Math.max(1, ...series.flat().map((v) => v ?? 0)) * 1.15;
  g.strokeStyle = cssVar('--separator');
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  const n = 120;
  series.forEach((values, si) => {
    const pts = values.slice(-n);
    if (pts.length < 2) return;
    const step = w / (n - 1);
    const x0 = (n - pts.length) * step;
    const y = (v: number | null) => h - Math.min(1, (v ?? 0) / top) * (h - 4) - 2;
    g.beginPath();
    pts.forEach((v, i) => (i ? g.lineTo(x0 + i * step, y(v)) : g.moveTo(x0, y(v))));
    g.strokeStyle = colors[si];
    g.lineWidth = 1.8;
    g.lineJoin = 'round';
    g.stroke();
    g.lineTo(x0 + (pts.length - 1) * step, h);
    g.lineTo(x0, h);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colors[si] + '55');
    grad.addColorStop(1, colors[si] + '05');
    g.fillStyle = grad;
    g.fill();
  });
}

// ---------- Sidebar & header ----------

function renderSidebar() {
  sidebar.replaceChildren(
    el('div', { class: 'side-head' }),
    ...TABS.map((x) => {
      const b = el('button', { class: `side-item${x.id === tab ? ' current' : ''}`, html: glyph(x.glyph) }, el('span', { text: t(`monitor.tab.${x.id}` as StringKey) }));
      b.addEventListener('click', () => setTab(x.id));
      return b;
    }),
    el('div', { class: 'side-spacer' }),
    !latest ? el('div', {}) : el('div', { class: 'side-stats' },
      el('div', {}, el('span', { text: t('monitor.processes') }), el('strong', { text: String(latest.counts.processes) })),
      el('div', {}, el('span', { text: t('monitor.threads') }), el('strong', { text: latest.counts.threads.toLocaleString() })),
      latest.counts.hung ? el('div', { class: 'warn' }, el('span', { text: t('monitor.hung') }), el('strong', { text: String(latest.counts.hung) })) : null,
    ),
  );
}

function setTab(next: Tab) {
  tab = next;
  renderSidebar();
  renderHead();
  renderPage(true);
  if (tab === 'startup' && !startup) void loadStartup();
  if (tab === 'services' && !services) void loadServices();
  if ((tab === 'system' || tab === 'overview') && !info) void loadInfo();
}

function renderHead() {
  const title = el('h1', { text: t(`monitor.tab.${tab}` as StringKey) });
  const parts: HTMLElement[] = [title];
  if (tab === 'processes' || tab === 'services') {
    const input = el('input', { class: 'search', type: 'search', placeholder: t('monitor.search'), value: query, spellcheck: 'false' });
    input.addEventListener('input', () => { query = input.value; renderPage(true); });
    parts.push(el('label', { class: 'search-wrap', html: glyph('search') }, input));
  }
  const exp = el('button', { class: 'btn', html: glyph('archive') }, t('monitor.export'));
  exp.addEventListener('click', async () => {
    const res = await api.exportReport();
    if (res.ok) toast(t('monitor.exported'));
  });
  parts.push(exp);
  head.replaceChildren(...parts);
}

// ---------- Pages ----------

function renderPage(force = false) {
  if (tab === 'overview') renderOverview(force);
  else if (tab === 'processes') renderProcesses();
  else if (tab === 'startup' && force) renderStartup();
  else if (tab === 'services' && force) renderServices();
  else if (tab === 'system' && force) renderSystem();
}

interface MetricCard { id: string; title: string; value: () => string; sub: () => string; series: () => (number | null)[][]; max: number | null; colors: () => string[] }

const METRICS: MetricCard[] = [
  { id: 'cpu', title: 'monitor.cpu', value: () => pct(latest?.cpu), sub: () => (info?.cpu ? String(info.cpu) : ''), series: () => [history.map((h) => h.cpu)], max: 100, colors: () => [cssVar('--accent')] },
  { id: 'mem', title: 'monitor.memory', value: () => (latest ? `${Math.round((latest.memUsed / latest.memTotal) * 100)} %` : '—'), sub: () => (latest ? `${formatBytes(latest.memUsed, lang)} / ${formatBytes(latest.memTotal, lang)}` : ''), series: () => [history.map((h) => (h.memUsed / h.memTotal) * 100)], max: 100, colors: () => ['#bf5af2'] },
  { id: 'gpu', title: 'monitor.gpu', value: () => pct(latest?.gpu), sub: () => (Array.isArray(info?.gpus) ? (info!.gpus as string[]).join(' · ') : ''), series: () => [history.map((h) => h.gpu)], max: 100, colors: () => ['#30d158'] },
  { id: 'disk', title: 'monitor.disk', value: () => pct(latest?.diskBusy), sub: () => rate(latest?.diskBytes), series: () => [history.map((h) => h.diskBusy)], max: 100, colors: () => ['#ff9f0a'] },
  { id: 'net', title: 'monitor.network', value: () => `↓ ${rate(latest?.netDown)}`, sub: () => `↑ ${rate(latest?.netUp)}`, series: () => [history.map((h) => h.netDown), history.map((h) => h.netUp)], max: null, colors: () => ['#64d2ff', '#ff375f'] },
];

function renderOverview(force: boolean) {
  if (force || !page.querySelector('.metrics')) {
    const cards = METRICS.map((m) =>
      el('section', { class: `metric m-${m.id}`, 'data-id': m.id },
        el('div', { class: 'metric-head' }, el('span', { class: 'metric-title', text: t(m.title as StringKey) }), el('strong', { class: 'metric-value' })),
        el('div', { class: 'metric-sub' }),
        el('canvas', { class: 'chart' })),
    );
    const top = el('section', { class: 'card top' }, el('h2', { text: t('monitor.topCpu') }), el('div', { class: 'top-list' }));
    page.replaceChildren(el('div', { class: 'metrics' }, ...cards), top);
  }
  for (const m of METRICS) {
    const card = page.querySelector<HTMLElement>(`.metric[data-id="${m.id}"]`);
    if (!card) continue;
    card.querySelector('.metric-value')!.textContent = m.value();
    card.querySelector('.metric-sub')!.textContent = m.sub();
    drawChart(card.querySelector('canvas')!, m.series(), m.max, m.colors());
  }
  const list = page.querySelector('.top-list');
  if (list && latest) {
    const top = latest.processes.filter((p) => p.pid > 4).sort((a, b) => b.cpu - a.cpu).slice(0, 6);
    list.replaceChildren(...top.map((p) => {
      const row = el('button', { class: 'top-row' }, procIcon(p), el('span', { class: 'name', text: p.display }), el('span', { class: 'v', text: pct(p.cpu) }), el('span', { class: 'v dim', text: formatBytes(p.memory, lang) }));
      row.addEventListener('click', () => { selectedPid = p.pid; setTab('processes'); });
      return row;
    }));
  }
}

function procIcon(p: ProcRow) {
  return p.icon ? el('img', { class: 'p-ico', src: p.icon, alt: '' }) : el('span', { class: 'p-ico ph', html: glyph(p.kind === 'system' ? 'settings' : 'window') });
}

function sortRows(rows: ProcRow[]) {
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = a[sort.key];
    const vb = b[sort.key];
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return c * dir || a.pid - b.pid;
  });
}

function renderProcesses() {
  if (!latest) {
    page.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'spinner' })));
    return;
  }
  const q = query.trim().toLowerCase();
  const rows = latest.processes.filter((p) => !q || p.display.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || String(p.pid) === q);
  const scroll = page.querySelector('.table-wrap')?.scrollTop ?? 0;
  const col = (key: typeof sort.key, label: string, cls: string, total = '') => {
    const b = el('button', { class: `th ${cls}${sort.key === key ? ' sorted' : ''}` }, el('span', {}, label, sort.key === key ? el('span', { class: 'arrow', text: sort.desc ? ' ↓' : ' ↑' }) : ''), el('small', { text: total }));
    b.addEventListener('click', () => { sort = { key, desc: sort.key === key ? !sort.desc : key !== 'display' }; renderProcesses(); });
    return b;
  };
  const totals = { cpu: latest.cpu, mem: latest.memUsed, disk: latest.processes.reduce((a, p) => a + p.disk, 0), gpu: latest.gpu ?? 0 };
  const header = el('div', { class: 'thead' },
    col('display', t('monitor.col.name'), 'c-name'),
    col('cpu', 'CPU', 'c-num', pct(totals.cpu)),
    col('memory', t('monitor.memory'), 'c-num', formatBytes(totals.mem, lang)),
    col('disk', t('monitor.disk'), 'c-num', rate(totals.disk)),
    col('gpu', 'GPU', 'c-num', pct(totals.gpu)),
    col('pid', 'PID', 'c-pid'));
  const sections: HTMLElement[] = [];
  for (const kind of ['app', 'background', 'system'] as const) {
    const list = sortRows(rows.filter((p) => p.kind === kind));
    if (!list.length) continue;
    sections.push(el('div', { class: 'section-head', text: `${t(`monitor.kind.${kind}` as StringKey)} (${list.length})` }));
    for (const p of list) {
      const heat = (v: number) => (v >= 50 ? 'hot' : v >= 15 ? 'warm' : '');
      const row = el('div', { class: `tr${selectedPid === p.pid ? ' selected' : ''}${p.hung ? ' hung' : ''}`, 'data-pid': p.pid },
        el('span', { class: 'c-name' }, procIcon(p), el('span', { class: 'name', text: p.display, title: p.path ?? p.name }), p.hung ? el('span', { class: 'badge danger', text: t('monitor.notResponding') }) : null),
        el('span', { class: `c-num ${heat(p.cpu)}`, text: pct(p.cpu) }),
        el('span', { class: `c-num ${p.memory > 1e9 ? 'warm' : ''}`, text: formatBytes(p.memory, lang) }),
        el('span', { class: 'c-num', text: p.disk > 1024 ? rate(p.disk) : '—' }),
        el('span', { class: `c-num ${heat(p.gpu)}`, text: p.gpu >= 0.1 ? pct(p.gpu) : '—' }),
        el('span', { class: 'c-pid', text: String(p.pid) }));
      row.addEventListener('click', () => { selectedPid = p.pid; renderProcesses(); });
      row.addEventListener('dblclick', () => { if (p.path) api.openFolder(p.path); });
      sections.push(row);
    }
  }
  const wrap = el('div', { class: 'table-wrap' }, header, ...sections);
  const selected = latest.processes.find((p) => p.pid === selectedPid) ?? null;
  page.replaceChildren(el('div', { class: 'proc-layout' }, wrap, selected ? detailPanel(selected) : el('aside', { class: 'detail empty', text: t('monitor.selectProcess') })));
  page.querySelector('.table-wrap')!.scrollTop = scroll;
}

function detailPanel(p: ProcRow) {
  const parent = latest?.processes.find((x) => x.pid === p.ppid);
  const rows: [string, string][] = [
    [t('monitor.col.status'), p.hung ? t('monitor.notResponding') : t('monitor.running')],
    ['PID', String(p.pid)],
    [t('monitor.parent'), parent ? `${parent.display} (${p.ppid})` : String(p.ppid)],
    [t('monitor.threads'), String(p.threads)],
    [t('monitor.cpu'), pct(p.cpu)],
    [t('monitor.memory'), formatBytes(p.memory, lang)],
    [t('monitor.disk'), rate(p.disk)],
    ['GPU', pct(p.gpu)],
    [t('monitor.executable'), p.name],
    [t('files.col.location'), p.path ?? t('monitor.protected')],
  ];
  const actions = el('div', { class: 'detail-actions' });
  if (p.kind === 'app') {
    const close = el('button', { class: 'btn', html: glyph('close') }, t('monitor.closeApp'));
    close.addEventListener('click', async () => {
      const n = await api.close(p.pid);
      toast(n ? t('monitor.closeRequested') : t('monitor.noWindow'));
    });
    actions.append(close);
  }
  const end = el('button', { class: 'btn danger', html: glyph('power') }, t('monitor.end'));
  end.disabled = p.critical;
  end.title = p.critical ? t('monitor.criticalHint') : t('monitor.endHint');
  end.addEventListener('click', async () => {
    const res = await api.end(p.pid);
    if (res.canceled) return;
    if (res.ok) toast(t('monitor.ended', { name: p.display }));
    else toast(t(`monitor.error.${res.error ?? 'failed'}` as StringKey), 'error');
  });
  actions.append(end);
  if (p.path) {
    const reveal = el('button', { class: 'btn', html: glyph('folder') }, t('monitor.openLocation'));
    reveal.addEventListener('click', () => api.openFolder(p.path!));
    actions.append(reveal);
  }
  return el('aside', { class: 'detail' },
    el('div', { class: 'detail-head' }, p.icon ? el('img', { src: p.icon, alt: '' }) : el('span', { class: 'ph big', html: glyph('window') }), el('div', {}, el('h2', { text: p.display }), el('span', { class: `badge ${p.kind}`, text: t(`monitor.kind.${p.kind}` as StringKey) }))),
    el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    actions,
    p.critical ? el('p', { class: 'note', text: t('monitor.criticalHint') }) : null);
}

async function loadStartup() {
  startup = await api.startup();
  journalCount = (await api.journal()).length;
  if (tab === 'startup') renderStartup();
}

function renderStartup() {
  if (!startup) {
    page.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'spinner' }), el('span', { text: t('monitor.loading') })));
    return;
  }
  const items = startup.map((s) => {
    const sw = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(s.enabled), title: s.canToggle ? '' : t('monitor.startup.admin') });
    sw.disabled = !s.canToggle;
    sw.addEventListener('click', async () => {
      sw.disabled = true;
      const ok = await api.setStartup(s.id, !s.enabled);
      if (ok) { s.enabled = !s.enabled; journalCount = Math.max(journalCount, 1); toast(t(s.enabled ? 'monitor.startup.enabled' : 'monitor.startup.disabled', { name: s.name })); }
      else toast(t('monitor.error.failed'), 'error');
      renderStartup();
    });
    return el('div', { class: 'list-row' },
      s.icon ? el('img', { class: 'p-ico', src: s.icon, alt: '' }) : el('span', { class: 'p-ico ph', html: glyph('power') }),
      el('div', { class: 'grow' }, el('strong', { text: s.name }), el('small', { text: s.command })),
      el('span', { class: 'badge', text: t(`monitor.startup.src.${s.source}` as StringKey) }),
      s.canToggle ? null : el('span', { class: 'lock', html: glyph('lock'), title: t('monitor.startup.admin') }),
      sw);
  });
  const restore = el('button', { class: 'btn', html: glyph('refresh') }, t('monitor.startup.restore'));
  restore.disabled = journalCount === 0;
  restore.addEventListener('click', async () => {
    const n = await api.restoreStartup();
    toast(t('monitor.startup.restored', { n }));
    startup = null;
    void loadStartup();
  });
  const win = el('button', { class: 'btn', html: glyph('external') }, t('monitor.startup.windows'));
  win.addEventListener('click', () => api.system('startup'));
  page.replaceChildren(
    el('p', { class: 'intro', text: t('monitor.startup.intro') }),
    el('div', { class: 'card list' }, ...(items.length ? items : [el('div', { class: 'state inline', text: t('monitor.startup.none') })])),
    el('div', { class: 'row-actions' }, restore, win),
  );
}

async function loadServices() {
  services = await api.services();
  if (tab === 'services') renderServices();
}

function renderServices() {
  if (!services) {
    page.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'spinner' }), el('span', { text: t('monitor.loading') })));
    return;
  }
  const q = query.trim().toLowerCase();
  const list = services.filter((s) => !q || s.display.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 400);
  const open = el('button', { class: 'btn', html: glyph('external') }, t('monitor.services.open'));
  open.addEventListener('click', () => api.system('services'));
  page.replaceChildren(
    el('div', { class: 'row-actions top' }, el('p', { class: 'intro', text: t('monitor.services.intro', { n: services.length, running: services.filter((s) => s.state === 'Running').length }) }), open),
    el('div', { class: 'card list' }, ...list.map((s) =>
      el('div', { class: 'list-row compact' },
        el('span', { class: `dot ${s.state === 'Running' ? 'on' : ''}` }),
        el('div', { class: 'grow' }, el('strong', { text: s.display }), el('small', { text: `${s.name}${s.pid ? ` · PID ${s.pid}` : ''}` })),
        el('span', { class: 'badge', text: t(`monitor.services.state.${s.state === 'Running' ? 'running' : 'stopped'}` as StringKey) }),
        el('span', { class: 'badge muted', text: s.start })))),
  );
}

async function loadInfo() {
  info = await api.info();
  if (tab === 'system') renderSystem();
}

// Sensors: only what Windows lets a standard user read; the rest is labelled unavailable.
let sensors: Awaited<ReturnType<typeof api.sensors>> = null;
let sensorsTimer: number | null = null;

function sensorsCard(): HTMLElement {
  const card = el('section', { class: 'card' });
  const fill = () => {
    const s = sensors;
    if (!s) { card.replaceChildren(el('div', { class: 'state small' }, el('div', { class: 'mini-spinner' }), el('span', { text: t('monitor.loading') }))); return; }
    const na = t('monitor.sensor.na');
    const rows: [string, string][] = [];
    for (const g of s.gpus) {
      rows.push([`${g.name} — ${t('monitor.sensor.temp')}`, g.tempC !== null ? `${g.tempC} °C` : na]);
      rows.push([`${g.name} — ${t('monitor.sensor.load')}`, g.load !== null ? `${g.load} %` : na]);
      if (g.memTotalMB) rows.push([`${g.name} — VRAM`, `${g.memUsedMB ?? 0} / ${g.memTotalMB} Mo`]);
      rows.push([`${g.name} — ${t('monitor.sensor.power')}`, g.powerW !== null ? `${g.powerW.toFixed(1)} W` : na]);
      rows.push([`${g.name} — ${t('monitor.sensor.fan')}`, g.fan !== null ? `${g.fan} %` : t('monitor.sensor.fanNa')]);
    }
    if (!s.gpus.length) rows.push([t('monitor.sensor.gpuTemp'), t('monitor.sensor.gpuNa')]);
    rows.push([t('monitor.sensor.cpuTemp'), t('monitor.sensor.cpuNa')]);
    if (s.battery) {
      rows.push([t('monitor.sensor.batteryHealth'), `${s.battery.healthPercent} % (${Math.round(s.battery.fullMWh / 1000)} / ${Math.round(s.battery.designMWh / 1000)} Wh)`]);
      rows.push([t('monitor.sensor.cycles'), s.battery.cycles !== null ? String(s.battery.cycles) : na]);
    }
    card.replaceChildren(el('dl', { class: 'sys' }, ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { class: v === na || v.startsWith('—') ? 'na' : '', text: v })])), el('p', { class: 'note', text: t('monitor.sensor.note') }));
  };
  fill();
  const refresh = async () => {
    sensors = await api.sensors();
    if (tab === 'system' && card.isConnected) fill();
    else if (sensorsTimer) { clearInterval(sensorsTimer); sensorsTimer = null; }
  };
  if (!sensors) void refresh();
  if (!sensorsTimer) sensorsTimer = window.setInterval(() => void refresh(), 5000);
  return card;
}

function renderSystem() {
  if (!info) {
    page.replaceChildren(el('div', { class: 'state' }, el('div', { class: 'spinner' }), el('span', { text: t('monitor.loading') })));
    void loadInfo();
    return;
  }
  const i = info;
  const rows: [string, string][] = [
    [t('monitor.sys.os'), `${i.os ?? ''} (build ${i.build ?? ''})`],
    [t('monitor.sys.model'), String(i.model ?? '—')],
    [t('monitor.sys.host'), String(i.host ?? '')],
    [t('monitor.cpu'), String(i.cpu ?? '')],
    [t('monitor.sys.cores'), `${i.cores ?? '—'} / ${i.threads ?? '—'}`],
    [t('monitor.memory'), formatBytes(Number(i.memory ?? 0), lang)],
    [t('monitor.gpu'), Array.isArray(i.gpus) ? (i.gpus as string[]).join(', ') : '—'],
    [t('monitor.sys.uptime'), formatDuration(Number(i.uptime ?? 0) * 1000)],
  ];
  const drives = (i.drives as { mount: string; total: number; free: number }[]) ?? [];
  page.replaceChildren(
    el('section', { class: 'card' }, el('dl', { class: 'sys' }, ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]))),
    el('h2', { class: 'sub', text: t('monitor.sys.storage') }),
    el('section', { class: 'card list' }, ...drives.map((d) => {
      const used = 1 - d.free / d.total;
      const bar = el('div', { class: `usage${used > 0.9 ? ' crit' : ''}` }, el('i'));
      (bar.firstElementChild as HTMLElement).style.width = `${Math.round(used * 100)}%`;
      return el('div', { class: 'list-row' }, el('span', { class: 'p-ico ph', html: glyph('drive') }), el('div', { class: 'grow' }, el('strong', { text: d.mount }), bar, el('small', { text: t('monitor.sys.free', { free: formatBytes(d.free, lang), total: formatBytes(d.total, lang) }) })));
    })),
    el('h2', { class: 'sub', text: t('monitor.sensors') }),
    sensorsCard(),
    el('div', { class: 'row-actions' }, (() => {
      const b = el('button', { class: 'btn', html: glyph('external') }, t('monitor.openTaskmgr'));
      b.addEventListener('click', () => api.system('taskmgr'));
      return b;
    })()),
  );
}

// ---------- Wiring ----------

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && ev.key.toLowerCase() === 'f') {
    ev.preventDefault();
    if (tab !== 'processes' && tab !== 'services') setTab('processes');
    head.querySelector<HTMLInputElement>('.search')?.focus();
  }
  if (ev.key === 'Delete' && tab === 'processes' && selectedPid !== null) {
    const p = latest?.processes.find((x) => x.pid === selectedPid);
    if (p && !p.critical) void api.end(p.pid).then((res) => { if (res.ok) toast(t('monitor.ended', { name: p.display })); });
  }
});
window.addEventListener('resize', () => { if (tab === 'overview') renderOverview(false); });

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  const start = api.startTab();
  if (start && TABS.some((x) => x.id === start)) tab = start as Tab;
  history = await api.history();
  latest = await api.latest();
  renderSidebar();
  renderHead();
  renderPage(true);
  void loadInfo();
  api.onSample((s) => {
    latest = s;
    const { processes: _p, ...point } = s;
    void _p;
    history.push(point);
    if (history.length > 240) history.shift();
    if (tab === 'overview' || tab === 'processes') renderPage(false);
    renderSidebar();
  });
  api.onTab((x) => { if (TABS.some((y) => y.id === x)) setTab(x as Tab); });
  orelle.onSettings((p) => {
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    renderSidebar();
    renderHead();
    renderPage(true);
  });
  orelle.onIconsChanged(() => { if (tab === 'processes') renderProcesses(); });
}

void init();
