// Dock renderer: keyed rendering, macOS-style magnification, reordering, file drops, auto-hide,
// and click-through management (the window only captures the mouse over the dock itself).
import { magnifiedSize } from '../../shared/dockModel';
import type { DockEntry, DockLayout, DockState } from '../../shared/types';
import { el, nova, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const stage = document.getElementById('stage')!;
const dock = document.getElementById('dock')!;
const tiles = document.getElementById('tiles')!;
const tooltip = document.getElementById('tooltip')!;

let layout: DockLayout = { position: 'bottom', iconSize: 52, magnifiedSize: 84, magnification: true, spacing: 6, autoHide: false, showLabels: true, hidden: false };
let state: DockState = { entries: [], launching: [] };
const nodes = new Map<string, HTMLElement>();

let interactive = false;
let pointer: { x: number; y: number } | null = null;
let restCenters = new Map<HTMLElement, number>();
let rafPending = false;
let hideTimer: number | null = null;
let hovered: HTMLElement | null = null;

const vertical = () => layout.position !== 'bottom';
const axis = (p: { x: number; y: number }) => (vertical() ? p.y : p.x);

// ---------- Rendering ----------

function artFor(e: DockEntry): HTMLElement {
  if (e.icon) {
    const img = el('img', { src: e.icon, alt: '', draggable: 'false', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(fallbackArt(e)), { once: true });
    return img;
  }
  return fallbackArt(e);
}

function fallbackArt(e: DockEntry): HTMLElement {
  if (e.kind === 'nova' && e.action === 'control') return el('div', { class: 'art control', html: glyph('sliders') });
  if (e.kind === 'nova' && e.action === 'settings') return el('div', { class: 'art control', html: glyph('settings') });
  if (e.kind === 'nova') return el('div', { class: 'art nova', html: glyph('sparkle') });
  if (e.kind === 'url') return el('div', { class: 'art url', html: glyph('globe') });
  if (e.kind === 'folder') return el('div', { class: 'art folder', html: glyph('folder') });
  if (e.kind === 'file') return el('div', { class: 'art file', html: glyph('file') });
  return el('div', { class: 'art letter', text: (e.label.trim()[0] ?? '?').toUpperCase() });
}

function render() {
  const seen = new Set<string>();
  const launching = new Set(state.launching);
  let prevSection: DockEntry['section'] | null = null;
  const ordered: HTMLElement[] = [];

  for (const e of state.entries) {
    // Visual separator between sections (pinned | running | recents | minimized).
    if (prevSection && prevSection !== e.section && e.kind !== 'separator') {
      const sepKey = `sep:${prevSection}>${e.section}`;
      seen.add(sepKey);
      ordered.push(ensureSeparator(sepKey));
    }
    prevSection = e.section;
    seen.add(e.key);
    if (e.kind === 'separator') {
      ordered.push(ensureSeparator(e.key, true));
      continue;
    }
    let node = nodes.get(e.key);
    const iconSig = `${e.icon ?? ''}|${e.kind}|${e.label}`;
    if (!node) {
      node = el('div', { class: 'tile enter', 'data-key': e.key, role: 'button' });
      node.append(el('div', { class: 'icon' }), el('div', { class: 'dot' }));
      node.addEventListener('animationend', () => node!.classList.remove('enter'), { once: true });
      bindTile(node);
      nodes.set(e.key, node);
    }
    if (node.dataset.sig !== iconSig) {
      node.dataset.sig = iconSig;
      node.querySelector('.icon')!.replaceChildren(artFor(e));
    }
    node.dataset.label = e.label;
    node.dataset.section = e.section;
    node.setAttribute('aria-label', e.label);
    node.classList.toggle('running', e.running);
    node.classList.toggle('active', e.active);
    node.classList.toggle('launching', launching.has(e.key));
    ordered.push(node);
  }

  // Leave animation for removed nodes.
  for (const [key, node] of nodes) {
    if (seen.has(key)) continue;
    nodes.delete(key);
    if (node === hovered) hideTooltip();
    node.classList.add('leave');
    setTimeout(() => node.remove(), 260);
  }

  // Reconcile DOM order without recreating nodes.
  let cursor: ChildNode | null = tiles.firstChild;
  for (const node of ordered) {
    while (cursor && (cursor as HTMLElement).classList?.contains('leave')) cursor = cursor.nextSibling;
    if (cursor !== node) tiles.insertBefore(node, cursor);
    else cursor = cursor.nextSibling;
  }
  restCenters.clear();
  if (pointer && interactive) scheduleMagnify();
}

function ensureSeparator(key: string, userSeparator = false): HTMLElement {
  let node = nodes.get(key);
  if (!node) {
    node = el('div', { class: 'sep', 'data-key': key });
    if (userSeparator) node.dataset.user = '1';
    nodes.set(key, node);
  }
  return node;
}

// ---------- Layout & magnification ----------

function applyLayout() {
  stage.className = `pos-${layout.position}`;
  stage.style.setProperty('--icon', `${layout.iconSize}px`);
  stage.style.setProperty('--gap', `${layout.spacing}px`);
  dock.classList.toggle('hidden', layout.autoHide && !interactive);
  restCenters.clear();
  resetSizes();
}

function resetSizes() {
  dock.classList.add('settling');
  for (const node of tiles.querySelectorAll<HTMLElement>('.tile')) {
    node.style.width = '';
    node.style.height = '';
  }
}

const PAD = 8; // keep in sync with --pad in dock.css

/** Resting centres computed from the layout rules (the dock is centred on its axis), so they stay
 *  correct even while icons are magnified. */
function measureRest() {
  restCenters = new Map();
  const gap = layout.spacing;
  const items = [...tiles.children].filter((n) => !n.classList.contains('leave')) as HTMLElement[];
  const sizes = items.map((n) => (n.classList.contains('sep') ? 1 + 2 * (gap + 3) : layout.iconSize + gap));
  const total = sizes.reduce((a, b) => a + b, 0) + PAD * 2;
  let pos = ((vertical() ? window.innerHeight : window.innerWidth) - total) / 2 + PAD;
  items.forEach((n, i) => {
    if (n.classList.contains('tile')) restCenters.set(n, pos + sizes[i] / 2);
    pos += sizes[i];
  });
}

function scheduleMagnify() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    magnify();
  });
}

function magnify() {
  if (!layout.magnification || dragState || !pointer || !interactive) return;
  if (restCenters.size === 0) measureRest();
  const p = axis(pointer);
  dock.classList.remove('settling');
  for (const [node, center] of restCenters) {
    const size = magnifiedSize(layout.iconSize, layout.magnifiedSize, center, p);
    node.style.width = node.style.height = `${size.toFixed(2)}px`;
  }
  if (hovered) positionTooltip(hovered);
}

// ---------- Interactivity / click-through ----------

function hitDock(x: number, y: number): boolean {
  const r = dock.getBoundingClientRect();
  const m = 4;
  if (dock.classList.contains('hidden')) return false;
  return x >= r.left - m && x <= r.right + m && y >= r.top - (vertical() ? m : layout.magnifiedSize - layout.iconSize + m) && y <= r.bottom + m;
}

function atRevealEdge(x: number, y: number) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (layout.position === 'bottom') return y >= h - 3;
  if (layout.position === 'left') return x <= 2;
  return x >= w - 3;
}

function setInteractive(on: boolean) {
  if (on === interactive) return;
  interactive = on;
  nova.dock.setInteractive(on);
  if (on) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    dock.classList.remove('hidden');
  } else {
    pointer = null;
    hideTooltip();
    resetSizes();
    restCenters.clear();
    if (layout.autoHide && !dragState) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => dock.classList.add('hidden'), 450);
    }
  }
}

document.addEventListener('mousemove', (e) => {
  if (dragState) return;
  const inside = hitDock(e.clientX, e.clientY) || (layout.autoHide && dock.classList.contains('hidden') && atRevealEdge(e.clientX, e.clientY));
  if (inside !== interactive) setInteractive(inside);
  if (interactive) {
    pointer = { x: e.clientX, y: e.clientY };
    scheduleMagnify();
  }
});
document.addEventListener('mouseleave', () => {
  if (!dragState) setInteractive(false);
});

// ---------- Tooltip ----------

function showTooltip(node: HTMLElement) {
  hovered = node;
  if (!layout.showLabels || !node.dataset.label) return;
  tooltip.textContent = node.dataset.label;
  tooltip.classList.remove('removing');
  positionTooltip(node);
  tooltip.classList.add('show');
}

function positionTooltip(node: HTMLElement) {
  const r = node.getBoundingClientRect();
  const tr = tooltip.getBoundingClientRect();
  let x: number;
  let y: number;
  if (layout.position === 'bottom') {
    x = r.left + r.width / 2 - tr.width / 2;
    y = r.top - tr.height - 10;
  } else if (layout.position === 'left') {
    x = r.right + 12;
    y = r.top + r.height / 2 - tr.height / 2;
  } else {
    x = r.left - tr.width - 12;
    y = r.top + r.height / 2 - tr.height / 2;
  }
  x = Math.max(4, Math.min(window.innerWidth - tr.width - 4, x));
  y = Math.max(2, Math.min(window.innerHeight - tr.height - 2, y));
  tooltip.style.transform = '';
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  hovered = null;
  tooltip.classList.remove('show');
}

// ---------- Tiles: click, context menu, drag to reorder / remove ----------

interface DragState {
  node: HTMLElement;
  key: string;
  start: { x: number; y: number };
  origin: DOMRect;
  active: boolean;
  removing: boolean;
  pointerId: number;
}
let dragState: DragState | null = null;

function bindTile(node: HTMLElement) {
  node.addEventListener('mouseenter', () => showTooltip(node));
  node.addEventListener('mouseleave', () => { if (hovered === node) hideTooltip(); });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideTooltip();
    nova.dock.contextMenu(node.dataset.key!);
  });
  node.addEventListener('auxclick', (e) => {
    if (e.button === 1) nova.dock.activate(node.dataset.key!, { newInstance: true });
  });
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    node.setPointerCapture(e.pointerId);
    dragState = { node, key: node.dataset.key!, start: { x: e.clientX, y: e.clientY }, origin: node.getBoundingClientRect(), active: false, removing: false, pointerId: e.pointerId };
  });
  node.addEventListener('pointermove', (e) => {
    const d = dragState;
    if (!d || d.node !== node) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.active) {
      if (Math.hypot(dx, dy) < 6 || node.dataset.section !== 'pinned') return;
      d.active = true;
      hideTooltip();
      resetSizes();
      restCenters.clear();
      node.classList.add('dragging');
    }
    // Perpendicular distance from the dock decides "remove" (drag out, like macOS).
    const out = layout.position === 'bottom' ? -dy : layout.position === 'left' ? dx : -dx;
    d.removing = out > layout.iconSize * 1.4;
    node.classList.toggle('removing', d.removing);
    if (d.removing) {
      tooltip.textContent = t('dock.dropRemove');
      tooltip.classList.add('show', 'removing');
      positionTooltip(node);
    } else {
      tooltip.classList.remove('show', 'removing');
      reorderDuringDrag(node, e.clientX, e.clientY);
    }
    const r = node.getBoundingClientRect();
    const baseX = r.left - (parseFloat(node.dataset.tx ?? '0') || 0);
    const baseY = r.top - (parseFloat(node.dataset.ty ?? '0') || 0);
    const tx = d.origin.left + dx - baseX;
    const ty = d.origin.top + dy - baseY;
    node.dataset.tx = String(tx);
    node.dataset.ty = String(ty);
    node.style.transform = `translate(${tx}px, ${ty}px)`;
  });
  const end = (e: PointerEvent, canceled: boolean) => {
    const d = dragState;
    if (!d || d.node !== node) return;
    dragState = null;
    try { node.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!d.active) {
      if (!canceled) nova.dock.activate(d.key, { newInstance: e.shiftKey });
      return;
    }
    node.classList.remove('dragging', 'removing');
    node.style.transform = '';
    delete node.dataset.tx;
    delete node.dataset.ty;
    tooltip.classList.remove('show', 'removing');
    if (d.removing && !canceled) {
      nova.dock.remove(d.key);
      return;
    }
    const ids = [...tiles.children]
      .filter((n) => (n as HTMLElement).dataset.key && ((n as HTMLElement).dataset.section === 'pinned' || (n as HTMLElement).dataset.user))
      .map((n) => (n as HTMLElement).dataset.key!);
    nova.dock.reorder(ids);
  };
  node.addEventListener('pointerup', (e) => end(e, false));
  node.addEventListener('pointercancel', (e) => end(e, true));
}

function reorderDuringDrag(node: HTMLElement, x: number, y: number) {
  const p = vertical() ? y : x;
  const pinned = [...tiles.children].filter(
    (n) => n !== node && ((n as HTMLElement).dataset.section === 'pinned' || (n as HTMLElement).dataset.user),
  ) as HTMLElement[];
  let before: HTMLElement | null = null;
  for (const n of pinned) {
    const r = n.getBoundingClientRect();
    const c = vertical() ? r.top + r.height / 2 : r.left + r.width / 2;
    if (p < c) { before = n; break; }
  }
  const lastPinned = pinned[pinned.length - 1];
  const ref = before ?? (lastPinned ? lastPinned.nextSibling : tiles.firstChild);
  if (ref !== node && node.nextSibling !== ref) tiles.insertBefore(node, ref);
}

// Right-click on the bar itself (not on a tile): Dock-wide menu.
dock.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const target = (e.target as HTMLElement).closest<HTMLElement>('.sep[data-user]');
  nova.dock.contextMenu(target?.dataset.key ?? null);
});

// ---------- Files dropped from Explorer ----------

function dropIndex(x: number, y: number): number {
  const pinned = [...tiles.children].filter((n) => (n as HTMLElement).dataset.section === 'pinned' || (n as HTMLElement).dataset.user) as HTMLElement[];
  const p = vertical() ? y : x;
  const idx = pinned.findIndex((n) => {
    const r = n.getBoundingClientRect();
    return p < (vertical() ? r.top + r.height / 2 : r.left + r.width / 2);
  });
  return idx === -1 ? pinned.length : idx;
}

document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'link';
  setInteractive(true);
  dock.classList.add('drop-target');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dock.classList.remove('drop-target');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dock.classList.remove('drop-target');
  const files = [...(e.dataTransfer?.files ?? [])];
  const paths = files.map((f) => nova.pathForFile(f)).filter(Boolean);
  if (paths.length) nova.dock.addPaths(paths, dropIndex(e.clientX, e.clientY));
});

// ---------- Wiring ----------

async function init() {
  const boot = await nova.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  nova.onSettings(({ settings, language, darkSystem }) => {
    setLanguage(language);
    applyTheme(settings, darkSystem);
  });
  nova.dock.onLayout((l) => {
    layout = l;
    applyLayout();
  });
  nova.dock.onState((s) => {
    state = s;
    render();
  });
}

void init();
