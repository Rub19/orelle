// Preferences pages for the shell features: top bar, windows, profiles, notifications,
// extensions, automations and the optional AI assistant.
import type { ExtensionInfoDto } from '../../preload/preload';
import type { StringKey } from '../../shared/i18n';
import { THEMES } from '../../shared/settings';
import type { ActivityProfile, AppInfo, Automation, AutomationAction, AutomationTrigger, DeepPartial, DisplayInfo, Settings } from '../../shared/types';
import { el, orelle, t } from '../common/env';
import { glyph } from '../common/glyphs';

export interface Kit {
  settings: () => Settings;
  displays: () => DisplayInfo[];
  apps: () => AppInfo[] | null;
  update: (patch: DeepPartial<Settings>) => Promise<void>;
  rerender: () => void;
  row: (labelKey: StringKey, control: HTMLElement | null, descKey?: StringKey, extra?: HTMLElement) => HTMLElement;
  group: (titleKey: StringKey | null, ...rows: (HTMLElement | null)[]) => HTMLElement[];
  toggle: (value: boolean, onChange: (v: boolean) => void) => HTMLElement;
  segmented: <T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void) => HTMLElement;
  selectBox: (options: { value: string; label: string }[], value: string, onChange: (v: string) => void) => HTMLElement;
  button: (label: string, onClick: () => void, cls?: string, glyphName?: string) => HTMLButtonElement;
}

const note = (key: StringKey) => el('p', { class: 'note', text: t(key) });
const uid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`;
const PROFILE_GLYPHS = ['gamepad', 'code', 'broadcast', 'check', 'sparkle', 'moon', 'music', 'film', 'bolt', 'home'];

function input(value: string, placeholder = '', type = 'text') {
  return el('input', { class: 'input', value, placeholder, type, spellcheck: 'false' });
}

// ---------- Top bar ----------

export function pageTopBar(k: Kit): HTMLElement[] {
  const s = k.settings();
  const tb = s.topBar;
  const items = tb.items;
  const move = (i: number, d: number) => {
    const next = [...items];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void k.update({ topBar: { items: next } }).then(k.rerender);
  };
  const list = el('ul', { class: 'items' }, ...items.map((it, i) => el('li', {},
    el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph({ media: 'music', cpu: 'cpu', network: 'network', volume: 'volume', battery: 'battery', notifications: 'bellOn', control: 'sliders', search: 'search', taskbar: 'taskbar', clock: 'clock' }[it.id]) })),
    el('div', { class: 'it-name' }, el('strong', { text: t(`settings.topbar.item.${it.id}` as StringKey) }), el('small', { text: t(`settings.topbar.item.${it.id}.desc` as StringKey) })),
    k.button('', () => move(i, -1), 'btn icon-only', 'chevronDown'),
    k.toggle(it.visible, (v) => void k.update({ topBar: { items: items.map((x) => (x.id === it.id ? { ...x, visible: v } : x)) } })),
  )));
  // The first arrow moves up: flip its glyph.
  list.querySelectorAll('li').forEach((li) => li.querySelector('.btn.icon-only')?.classList.add('up'));
  const displays = [{ value: 'primary', label: t('settings.dock.display.primary') }, ...k.displays().map((d) => ({ value: d.id, label: d.label }))];
  return [
    ...k.group(null,
      k.row('settings.topbar.enabled', k.toggle(tb.enabled, (v) => void k.update({ topBar: { enabled: v } })), 'settings.topbar.enabled.desc'),
      k.row('settings.dock.display', k.selectBox(displays, tb.display, (v) => void k.update({ topBar: { display: v } }))),
      k.row('settings.topbar.activeApp', k.toggle(tb.showActiveApp, (v) => void k.update({ topBar: { showActiveApp: v } })), 'settings.topbar.activeApp.desc'),
      k.row('settings.topbar.date', k.toggle(tb.showDate, (v) => void k.update({ topBar: { showDate: v } }))),
      k.row('settings.topbar.seconds', k.toggle(tb.showSeconds, (v) => void k.update({ topBar: { showSeconds: v } }))),
    ),
    el('div', { class: 'group-title', text: t('settings.topbar.items') }),
    el('div', { class: 'group', 'data-search': t('settings.topbar.items').toLowerCase() }, list),
    note('settings.topbar.note'),
  ];
}

// ---------- Windows ----------

export function pageWindows(k: Kit): HTMLElement[] {
  const s = k.settings();
  const shortcuts: [StringKey, string][] = [
    ['windows.snap.left', 'Ctrl+Alt+←'], ['windows.snap.right', 'Ctrl+Alt+→'], ['windows.snap.top', 'Ctrl+Alt+↑'], ['windows.snap.bottom', 'Ctrl+Alt+↓'],
    ['windows.snap.topLeft', 'Ctrl+Alt+U'], ['windows.snap.topRight', 'Ctrl+Alt+I'], ['windows.snap.bottomLeft', 'Ctrl+Alt+J'], ['windows.snap.bottomRight', 'Ctrl+Alt+K'],
    ['windows.snap.leftThird', 'Ctrl+Alt+D'], ['windows.snap.centerThird', 'Ctrl+Alt+F'], ['windows.snap.rightThird', 'Ctrl+Alt+G'],
    ['windows.snap.maximize', 'Ctrl+Alt+Entrée'], ['windows.snap.center', 'Ctrl+Alt+M'],
  ];
  const table = el('div', { class: 'shortcut-grid' }, ...shortcuts.flatMap(([key, accel]) => [el('span', { text: t(key) }), el('span', { class: 'kbd', text: accel })]));
  const layouts = s.windows.layouts;
  const list = el('ul', { class: 'items' }, ...layouts.map((l) => el('li', {},
    el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph('grid') })),
    el('div', { class: 'it-name' }, el('strong', { text: l.name }), el('small', { text: `${t('windows.count', { n: l.windows.length })} · ${new Date(l.createdAt).toLocaleString()}` })),
    k.button(t('settings.windows.restore'), () => orelle.settings.restoreLayout(l.id), 'btn'),
    k.button('', () => void k.update({ windows: { layouts: layouts.filter((x) => x.id !== l.id) } }).then(k.rerender), 'btn icon-only danger', 'close'),
  )));
  const name = input('', t('settings.windows.layoutName'));
  const save = k.button(t('windows.saveCurrent'), async () => {
    await orelle.settings.saveLayout(name.value.trim() || new Date().toLocaleString());
    setTimeout(k.rerender, 80);
  }, 'btn primary', 'plus');
  return [
    ...k.group(null, k.row('settings.windows.snapping', k.toggle(s.windows.snapping, (v) => void k.update({ windows: { snapping: v } })), 'settings.windows.snapping.desc')),
    el('div', { class: 'group-title', text: t('settings.windows.shortcuts') }),
    el('div', { class: 'group', 'data-search': t('settings.windows.shortcuts').toLowerCase() }, table),
    el('div', { class: 'group-title', text: t('windows.layouts') }),
    el('div', { class: 'group', 'data-search': t('windows.layouts').toLowerCase() }, list, el('div', { class: 'form-inline' }, name, save)),
    note('settings.windows.note'),
  ];
}

// ---------- Profiles ----------

function profileCard(k: Kit, p: ActivityProfile, all: ActivityProfile[]): HTMLElement {
  const s = k.settings();
  const on = s.profiles.active === p.id;
  const set = (patch: Partial<ActivityProfile>) => void k.update({ profiles: { list: all.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) } });
  const name = input(p.name);
  name.addEventListener('change', () => name.value.trim() && set({ name: name.value.trim() }));
  const glyphSel = k.selectBox(PROFILE_GLYPHS.map((g) => ({ value: g, label: t(`settings.profiles.glyph.${g}` as StringKey) })), p.glyph, (v) => set({ glyph: v }));
  const unchanged = t('settings.profiles.unchanged');
  const theme = k.selectBox([{ value: '', label: unchanged }, ...THEMES.map((th) => ({ value: th, label: t(`settings.theme.${th}` as StringKey) }))], p.theme ?? '', (v) => set({ theme: (v || null) as ActivityProfile['theme'] }));
  const taskbar = k.selectBox([{ value: '', label: unchanged }, ...(['normal', 'autohide', 'hidden'] as const).map((m) => ({ value: m, label: t(`settings.taskbar.${m}`) }))], p.taskbarMode ?? '', (v) => set({ taskbarMode: (v || null) as ActivityProfile['taskbarMode'] }));
  const layout = k.selectBox([{ value: '', label: t('settings.profiles.noLayout') }, ...s.windows.layouts.map((l) => ({ value: l.id, label: l.name }))], p.layoutId ?? '', (v) => set({ layoutId: v || null }));
  const apps = k.apps() ?? [];
  const launch = el('div', { class: 'chips' }, ...p.launch.map((a, i) => {
    const chip = el('span', { class: 'chip' }, a.name);
    const x = el('button', { class: 'chip-x', html: glyph('close'), 'aria-label': t('settings.profiles.removeApp') });
    x.addEventListener('click', () => set({ launch: p.launch.filter((_, j) => j !== i) }));
    chip.append(x);
    return chip;
  }));
  const addApp = k.selectBox([{ value: '', label: t('settings.profiles.addApp') }, ...apps.map((a) => ({ value: a.appId, label: a.name }))], '', (v) => {
    const a = apps.find((x) => x.appId === v);
    if (a && p.launch.length < 20) set({ launch: [...p.launch, { appId: a.appId, name: a.name }] });
  });
  const head = el('div', { class: 'profile-head' },
    el('span', { class: `profile-ico${on ? ' on' : ''}`, html: glyph(p.glyph) }),
    name,
    k.button(on ? t('settings.profiles.deactivate') : t('settings.profiles.activate'), () => { orelle.settings.toggleProfile(p.id); setTimeout(k.rerender, 400); }, on ? 'btn' : 'btn primary'),
    k.button('', () => void k.update({ profiles: { list: all.filter((x) => x.id !== p.id) } }).then(k.rerender), 'btn icon-only danger', 'close'),
  );
  return el('div', { class: 'group profile', 'data-search': `${p.name} ${t('settings.section.profiles')}`.toLowerCase() },
    head,
    k.row('settings.profiles.glyph', glyphSel),
    k.row('settings.profiles.focus', k.toggle(p.focus, (v) => set({ focus: v })), 'settings.profiles.focus.desc'),
    k.row('settings.profiles.mute', k.toggle(p.muteAlerts, (v) => set({ muteAlerts: v })), 'settings.profiles.mute.desc'),
    k.row('settings.profiles.widgets', k.toggle(p.hideWidgets, (v) => set({ hideWidgets: v }))),
    k.row('settings.profiles.theme', theme),
    k.row('settings.general.taskbarMode', taskbar),
    k.row('settings.profiles.layout', layout),
    k.row('settings.profiles.launch', addApp, undefined, launch),
  );
}

export function pageProfiles(k: Kit): HTMLElement[] {
  const all = k.settings().profiles.list;
  const add = k.button(t('settings.profiles.new'), () => {
    const p: ActivityProfile = { id: uid('profile'), name: t('settings.profiles.newName'), glyph: 'sparkle', launch: [], layoutId: null, theme: null, taskbarMode: null, hideWidgets: false, focus: false, muteAlerts: false };
    void k.update({ profiles: { list: [...all, p] } }).then(k.rerender);
  }, 'btn', 'plus');
  return [
    note('settings.profiles.intro'),
    ...all.map((p) => profileCard(k, p, all)),
    el('div', { class: 'toolbar' }, add),
  ];
}

// ---------- Notifications ----------

export function pageNotifications(k: Kit): HTMLElement[] {
  const n = k.settings().notifications;
  return [
    ...k.group(null,
      k.row('settings.notifications.enabled', k.toggle(n.enabled, (v) => void k.update({ notifications: { enabled: v } })), 'settings.notifications.enabled.desc'),
      k.row('settings.notifications.history', k.toggle(n.history, (v) => void k.update({ notifications: { history: v } })), 'settings.notifications.history.desc'),
      k.row('notifications.focus', k.toggle(n.focus, (v) => void k.update({ notifications: { focus: v } })), 'settings.notifications.focus.desc'),
      k.row('settings.notifications.windows', k.button(t('control.open'), () => orelle.settings.openWinSettings('ms-settings:notifications'), 'btn', 'external'), 'settings.notifications.windows.desc'),
    ),
    note('settings.notifications.note'),
  ];
}

// ---------- Extensions ----------

let extCache: ExtensionInfoDto[] | null = null;

function permissionText(p: ExtensionInfoDto['permissions'][number]) {
  if (p.kind === 'web') return t('settings.extensions.perm.web', { hosts: p.hosts.join(', ') });
  if (p.kind === 'files') return t('settings.extensions.perm.files', { paths: p.paths.join(', ') });
  return t('settings.extensions.perm.clipboard');
}

export function pageExtensions(k: Kit): HTMLElement[] {
  if (!extCache) {
    void orelle.settings.extensions().then((l) => { extCache = l; k.rerender(); });
  }
  const enabled = k.settings().extensions.enabled;
  const cards = (extCache ?? []).map((x) => {
    const sw = x.error ? null : k.toggle(x.enabled, (v) => {
      extCache = null;
      void k.update({ extensions: { enabled: { ...enabled, [x.id]: v } } });
    });
    return el('div', { class: 'group ext', 'data-search': `${x.name} ${x.description} ${t('settings.section.extensions')}`.toLowerCase() },
      el('div', { class: 'ext-head' },
        el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph('sparkle') })),
        el('div', { class: 'it-name' }, el('strong', { text: x.name }), el('small', { text: [x.version && `v${x.version}`, x.author, x.builtin ? t('settings.extensions.builtin') : t('settings.extensions.user')].filter(Boolean).join(' · ') })),
        sw,
      ),
      x.description ? el('p', { class: 'ext-desc', text: x.description }) : null,
      x.error ? el('div', { class: 'error-text', text: t('settings.extensions.invalid', { error: x.error }) }) : null,
      x.permissions.length ? el('div', { class: 'ext-perms' }, el('strong', { text: t('settings.extensions.permissions') }), el('ul', {}, ...x.permissions.map((p) => el('li', { text: permissionText(p) })))) : null,
      x.commands.length ? el('div', { class: 'chips' }, ...x.commands.map((c) => el('span', { class: 'chip' }, c.keyword ? `${c.keyword} · ${c.title}` : c.title))) : null,
    );
  });
  return [
    note('settings.extensions.intro'),
    ...(extCache && !extCache.length ? [el('div', { class: 'group' }, el('p', { class: 'empty-text', text: t('settings.extensions.none') }))] : cards),
    el('div', { class: 'toolbar' },
      k.button(t('settings.extensions.folder'), () => orelle.settings.openExtensionsFolder(), 'btn', 'folder'),
      k.button(t('settings.extensions.reload'), () => void orelle.settings.extensions(true).then((l) => { extCache = l; k.rerender(); }), 'btn', 'refresh'),
    ),
    note('settings.extensions.format'),
  ];
}

// ---------- Automations ----------

const DAY_KEYS: StringKey[] = ['settings.auto.day.0', 'settings.auto.day.1', 'settings.auto.day.2', 'settings.auto.day.3', 'settings.auto.day.4', 'settings.auto.day.5', 'settings.auto.day.6'];

function describeTrigger(tr: AutomationTrigger) {
  switch (tr.kind) {
    case 'time': return t('settings.auto.trigger.timeAt', { at: tr.at, days: tr.days.length === 7 ? t('settings.auto.everyday') : tr.days.map((d) => t(DAY_KEYS[d])).join(' ') });
    case 'appLaunched': return t('settings.auto.trigger.appAt', { app: tr.app });
    case 'startup': return t('settings.auto.trigger.startup');
    case 'hotkey': return t('settings.auto.trigger.hotkeyAt', { accel: tr.accel });
  }
}

function describeAction(s: Settings, a: AutomationAction) {
  switch (a.kind) {
    case 'profile': return t('settings.auto.action.profileX', { name: s.profiles.list.find((p) => p.id === a.id)?.name ?? '?' });
    case 'layout': return t('settings.auto.action.layoutX', { name: s.windows.layouts.find((l) => l.id === a.id)?.name ?? '?' });
    case 'theme': return t('settings.auto.action.themeX', { theme: t(`settings.theme.${a.theme}` as StringKey) });
    case 'focus': return a.on ? t('settings.auto.action.focusOn') : t('settings.auto.action.focusOff');
    case 'notify': return t('settings.auto.action.notifyX', { text: a.text });
    case 'open': return t('settings.auto.action.openX', { target: a.target });
  }
}

export function pageAutomations(k: Kit): HTMLElement[] {
  const s = k.settings();
  const rules = s.automations;
  const list = el('ul', { class: 'items' }, ...rules.map((a) => el('li', {},
    el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph('bolt') })),
    el('div', { class: 'it-name' }, el('strong', { text: a.name }), el('small', { text: `${describeTrigger(a.trigger)} → ${a.actions.map((x) => describeAction(s, x)).join(', ')}` })),
    k.button(t('settings.auto.runNow'), () => orelle.settings.runAutomation(a.id), 'btn'),
    k.toggle(a.enabled, (v) => void k.update({ automations: rules.map((x) => (x.id === a.id ? { ...x, enabled: v } : x)) })),
    k.button('', () => void k.update({ automations: rules.filter((x) => x.id !== a.id) }).then(k.rerender), 'btn icon-only danger', 'close'),
  )));
  if (!rules.length) list.append(el('li', { class: 'empty-text', text: t('settings.auto.none') }));

  // ----- New rule form -----
  const name = input('', t('settings.auto.name'));
  let trigger: AutomationTrigger['kind'] = 'time';
  let action: AutomationAction['kind'] = 'profile';
  const triggerField = el('div', { class: 'form-inline' });
  const actionField = el('div', { class: 'form-inline' });
  const err = el('div', { class: 'error-text' });
  const time = input('09:00', 'HH:MM', 'time');
  const days = new Set([1, 2, 3, 4, 5]);
  const app = input('', 'steam.exe');
  const accel = input('', 'Ctrl+Alt+P');
  const daysEl = el('div', { class: 'chips' }, ...[1, 2, 3, 4, 5, 6, 0].map((d) => {
    const b = el('button', { class: `chip toggle${days.has(d) ? ' on' : ''}`, text: t(DAY_KEYS[d]) });
    b.addEventListener('click', () => { if (days.has(d)) days.delete(d); else days.add(d); b.classList.toggle('on', days.has(d)); });
    return b;
  }));
  const renderTrigger = () => triggerField.replaceChildren(...(trigger === 'time' ? [time, daysEl] : trigger === 'appLaunched' ? [app] : trigger === 'hotkey' ? [accel] : []));
  const profileSel = k.selectBox(s.profiles.list.map((p) => ({ value: p.id, label: p.name })), s.profiles.list[0]?.id ?? '', () => {});
  const layoutSel = k.selectBox(s.windows.layouts.map((l) => ({ value: l.id, label: l.name })), s.windows.layouts[0]?.id ?? '', () => {});
  const themeSel = k.selectBox(THEMES.map((th) => ({ value: th, label: t(`settings.theme.${th}` as StringKey) })), 'dark', () => {});
  const focusSel = k.selectBox([{ value: 'on', label: t('settings.auto.action.focusOn') }, { value: 'off', label: t('settings.auto.action.focusOff') }], 'on', () => {});
  const text = input('', t('settings.auto.notifyText'));
  const target = input('', 'https://… ou C:\\…');
  const renderAction = () => actionField.replaceChildren(({ profile: profileSel, layout: layoutSel, theme: themeSel, focus: focusSel, notify: text, open: target } as Record<string, HTMLElement>)[action]);
  renderTrigger();
  renderAction();
  const triggerSel = k.selectBox((['time', 'appLaunched', 'startup', 'hotkey'] as const).map((v) => ({ value: v, label: t(`settings.auto.trigger.${v}`) })), trigger, (v) => { trigger = v as typeof trigger; renderTrigger(); });
  const actionSel = k.selectBox((['profile', 'layout', 'theme', 'focus', 'notify', 'open'] as const).map((v) => ({ value: v, label: t(`settings.auto.action.${v}`) })), action, (v) => { action = v as typeof action; renderAction(); });
  const value = (node: HTMLElement) => (node.querySelector('select') ?? node as HTMLSelectElement).value;
  const add = k.button(t('settings.auto.add'), async () => {
    err.textContent = '';
    let tr: AutomationTrigger;
    if (trigger === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value) || !days.size) { err.textContent = t('settings.auto.error.time'); return; }
      tr = { kind: 'time', at: time.value, days: [...days] };
    } else if (trigger === 'appLaunched') {
      if (!app.value.trim()) { err.textContent = t('settings.auto.error.app'); return; }
      tr = { kind: 'appLaunched', app: app.value.trim().toLowerCase() };
    } else if (trigger === 'hotkey') {
      if (!accel.value.includes('+')) { err.textContent = t('settings.auto.error.hotkey'); return; }
      tr = { kind: 'hotkey', accel: accel.value.trim() };
    } else tr = { kind: 'startup' };
    let ac: AutomationAction;
    if (action === 'profile') ac = { kind: 'profile', id: value(profileSel) };
    else if (action === 'layout') ac = { kind: 'layout', id: value(layoutSel) };
    else if (action === 'theme') ac = { kind: 'theme', theme: value(themeSel) as Settings['appearance']['theme'] };
    else if (action === 'focus') ac = { kind: 'focus', on: value(focusSel) === 'on' };
    else if (action === 'notify') ac = { kind: 'notify', text: text.value.trim() };
    else ac = { kind: 'open', target: target.value.trim() };
    if ((ac.kind === 'profile' || ac.kind === 'layout') && !ac.id) { err.textContent = t('settings.auto.error.missing'); return; }
    if (ac.kind === 'notify' && !ac.text) { err.textContent = t('settings.auto.error.missing'); return; }
    if (ac.kind === 'open' && !/^https?:\/\//i.test(ac.target) && !/^[a-z]:\\/i.test(ac.target)) { err.textContent = t('settings.auto.error.open'); return; }
    const rule: Automation = { id: uid('auto'), name: name.value.trim() || t('settings.auto.untitled'), enabled: true, trigger: tr, actions: [ac] };
    await k.update({ automations: [...rules, rule] });
    k.rerender();
  }, 'btn primary', 'plus');

  return [
    el('div', { class: 'group', 'data-search': t('settings.section.automations').toLowerCase() }, list),
    el('div', { class: 'group-title', text: t('settings.auto.new') }),
    el('div', { class: 'group auto-form', 'data-search': t('settings.auto.new').toLowerCase() },
      el('div', { class: 'form-inline' }, name),
      el('div', { class: 'form-inline' }, el('span', { class: 'lbl', text: t('settings.auto.when') }), triggerSel), triggerField,
      el('div', { class: 'form-inline' }, el('span', { class: 'lbl', text: t('settings.auto.then') }), actionSel), actionField,
      el('div', { class: 'toolbar' }, add), err),
    note('settings.auto.note'),
  ];
}

// ---------- AI ----------

let aiStatus: { hasKey: boolean; encryption: boolean } | null = null;

export function pageAi(k: Kit): HTMLElement[] {
  const ai = k.settings().ai;
  if (!aiStatus) void orelle.settings.aiStatus().then((st) => { aiStatus = st; k.rerender(); });
  const provider = k.segmented([
    { value: 'none', label: t('settings.ai.none') },
    { value: 'anthropic', label: 'Claude' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'ollama', label: t('settings.ai.ollama') },
  ], ai.provider, (v) => void k.update({ ai: { provider: v, consent: false, model: '', endpoint: '' } }).then(k.rerender));
  const rows: (HTMLElement | null)[] = [k.row('settings.ai.provider', provider, 'settings.ai.provider.desc')];
  const status = el('div', { class: 'ai-status' });
  if (ai.provider !== 'none') {
    const model = input(ai.model, ai.provider === 'anthropic' ? 'claude-opus-5-5' : ai.provider === 'ollama' ? 'llama3.2' : t('settings.ai.modelRequired'));
    model.addEventListener('change', () => void k.update({ ai: { model: model.value.trim() } }));
    rows.push(k.row('settings.ai.model', model, ai.provider === 'anthropic' ? 'settings.ai.model.claude' : 'settings.ai.model.desc'));
    if (ai.provider !== 'anthropic') {
      const ep = input(ai.endpoint, ai.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1', 'url');
      ep.addEventListener('change', () => void k.update({ ai: { endpoint: ep.value.trim() } }));
      rows.push(k.row('settings.ai.endpoint', ep, 'settings.ai.endpoint.desc'));
    }
    if (ai.provider !== 'ollama') {
      const key = input('', aiStatus?.hasKey ? t('settings.ai.keySaved') : t('settings.ai.keyPlaceholder'), 'password');
      const save = k.button(t('settings.ai.saveKey'), async () => {
        const ok = await orelle.settings.aiSetKey(key.value);
        aiStatus = null;
        status.textContent = ok ? t('settings.ai.keyStored') : t('settings.ai.keyError');
        key.value = '';
        setTimeout(k.rerender, 600);
      }, 'btn');
      const del = aiStatus?.hasKey ? k.button(t('settings.ai.deleteKey'), async () => { await orelle.settings.aiSetKey(''); aiStatus = null; k.rerender(); }, 'btn danger') : null;
      rows.push(k.row('settings.ai.key', el('div', { class: 'form-inline' }, key, save, del), aiStatus && !aiStatus.encryption ? 'settings.ai.noEncryption' : 'settings.ai.key.desc'));
    }
    const consent = k.toggle(ai.consent, async (v) => {
      await orelle.settings.aiConsent(v);
      k.rerender();
    });
    rows.push(k.row('settings.ai.consent', consent, 'settings.ai.consent.desc'));
    const test = k.button(t('settings.ai.test'), async () => {
      status.textContent = t('ai.thinking');
      const r = await orelle.settings.aiTest();
      status.textContent = r.state === 'answer' ? t('settings.ai.testOk', { model: r.model ?? '', text: (r.text ?? '').slice(0, 80) }) : r.text ?? t('ai.error.network');
    }, 'btn');
    if (!ai.consent) test.disabled = true;
    rows.push(k.row('settings.ai.testRow', test, undefined, status));
  }
  return [
    ...k.group(null, ...rows),
    note('settings.ai.how'),
    note('settings.ai.privacy'),
    ...(ai.provider === 'anthropic' ? [note('settings.ai.fallbacks')] : []),
  ];
}

