// Window snapping geometry (pure, unit tested). Rects are physical pixels, like Win32 RECTs.
export interface Rect { left: number; top: number; right: number; bottom: number }

export type SnapTarget =
  | 'left' | 'right' | 'top' | 'bottom'
  | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  | 'leftThird' | 'centerThird' | 'rightThird' | 'leftTwoThirds' | 'rightTwoThirds'
  | 'maximize' | 'center' | 'minimize' | 'close';

export const SNAP_TARGETS: SnapTarget[] = ['left', 'right', 'top', 'bottom', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'leftThird', 'centerThird', 'rightThird', 'leftTwoThirds', 'rightTwoThirds', 'maximize', 'center', 'minimize', 'close'];

/** Fixed shortcuts (Ctrl+Alt…). Letters chosen so that no AltGr character of FR/EN layouts is lost. */
export const SNAP_HOTKEYS: Partial<Record<SnapTarget, string>> = {
  left: 'Ctrl+Alt+Left',
  right: 'Ctrl+Alt+Right',
  top: 'Ctrl+Alt+Up',
  bottom: 'Ctrl+Alt+Down',
  topLeft: 'Ctrl+Alt+U',
  topRight: 'Ctrl+Alt+I',
  bottomLeft: 'Ctrl+Alt+J',
  bottomRight: 'Ctrl+Alt+K',
  leftThird: 'Ctrl+Alt+D',
  centerThird: 'Ctrl+Alt+F',
  rightThird: 'Ctrl+Alt+G',
  maximize: 'Ctrl+Alt+Enter',
  center: 'Ctrl+Alt+M',
};

/** Pure geometry, unit tested: the rectangle a target occupies inside a work area. */
export function snapRect(wa: Rect, target: SnapTarget, current?: Rect): Rect {
  const W = wa.right - wa.left;
  const H = wa.bottom - wa.top;
  const x = (f: number) => Math.round(wa.left + W * f);
  const y = (f: number) => Math.round(wa.top + H * f);
  switch (target) {
    case 'left': return { left: wa.left, top: wa.top, right: x(0.5), bottom: wa.bottom };
    case 'right': return { left: x(0.5), top: wa.top, right: wa.right, bottom: wa.bottom };
    case 'top': return { left: wa.left, top: wa.top, right: wa.right, bottom: y(0.5) };
    case 'bottom': return { left: wa.left, top: y(0.5), right: wa.right, bottom: wa.bottom };
    case 'topLeft': return { left: wa.left, top: wa.top, right: x(0.5), bottom: y(0.5) };
    case 'topRight': return { left: x(0.5), top: wa.top, right: wa.right, bottom: y(0.5) };
    case 'bottomLeft': return { left: wa.left, top: y(0.5), right: x(0.5), bottom: wa.bottom };
    case 'bottomRight': return { left: x(0.5), top: y(0.5), right: wa.right, bottom: wa.bottom };
    case 'leftThird': return { left: wa.left, top: wa.top, right: x(1 / 3), bottom: wa.bottom };
    case 'centerThird': return { left: x(1 / 3), top: wa.top, right: x(2 / 3), bottom: wa.bottom };
    case 'rightThird': return { left: x(2 / 3), top: wa.top, right: wa.right, bottom: wa.bottom };
    case 'leftTwoThirds': return { left: wa.left, top: wa.top, right: x(2 / 3), bottom: wa.bottom };
    case 'rightTwoThirds': return { left: x(1 / 3), top: wa.top, right: wa.right, bottom: wa.bottom };
    case 'center': {
      // Keeps the window's size (capped to the work area) and centres it.
      const w = Math.min(W, current ? current.right - current.left : Math.round(W * 0.6));
      const h = Math.min(H, current ? current.bottom - current.top : Math.round(H * 0.7));
      const l = Math.round(wa.left + (W - w) / 2);
      const t = Math.round(wa.top + (H - h) / 2);
      return { left: l, top: t, right: l + w, bottom: t + h };
    }
    default: return { ...wa };
  }
}
