// Live window thumbnails through the documented DWM thumbnail API (the same one Alt+Tab and the
// taskbar previews use): DWM composites the source window's current content into a rectangle of
// one of Orelle's windows. Nothing is captured or copied by Orelle itself.
import { koffiApi, type HWND, type Rect } from './win32';
import { log } from '../logger';

const DWM_TNP_RECTDESTINATION = 0x1;
const DWM_TNP_OPACITY = 0x4;
const DWM_TNP_VISIBLE = 0x8;
const DWM_TNP_SOURCECLIENTAREAONLY = 0x10;

let api: ReturnType<typeof bind> | null | undefined;
function bind() {
  const base = koffiApi();
  if (!base) return null;
  const koffi = base.koffi;
  const dwm = koffi.load('dwmapi.dll');
  const PROPS = koffi.struct('ORELLE_DWM_THUMBNAIL_PROPERTIES', {
    dwFlags: 'uint32',
    rcDestination: 'ORELLE_RECT',
    rcSource: 'ORELLE_RECT',
    opacity: 'uint8',
    fVisible: 'int32',
    fSourceClientAreaOnly: 'int32',
  });
  return {
    PROPS,
    Register: dwm.func('long __stdcall DwmRegisterThumbnail(intptr_t dest, intptr_t src, _Out_ intptr_t *thumb)'),
    Unregister: dwm.func('long __stdcall DwmUnregisterThumbnail(intptr_t thumb)'),
    Update: dwm.func('long __stdcall DwmUpdateThumbnailProperties(intptr_t thumb, ORELLE_DWM_THUMBNAIL_PROPERTIES *props)'),
  };
}

function lib() {
  if (api === undefined) {
    try {
      api = bind();
    } catch (err) {
      log.warn('dwm', 'Thumbnail API unavailable', err);
      api = null;
    }
  }
  return api;
}

export function registerThumbnail(dest: HWND, src: HWND): number | null {
  const a = lib();
  if (!a) return null;
  const out = [0];
  return a.Register(dest, src, out) === 0 && out[0] ? Number(out[0]) : null;
}

/** Places a thumbnail in `rect` (physical pixels, relative to the destination window). */
export function updateThumbnail(thumb: number, rect: Rect | null, opacity = 255): boolean {
  const a = lib();
  if (!a) return false;
  const props = {
    dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY,
    rcDestination: rect ?? { left: 0, top: 0, right: 0, bottom: 0 },
    rcSource: { left: 0, top: 0, right: 0, bottom: 0 },
    opacity: Math.max(0, Math.min(255, Math.round(opacity))),
    fVisible: rect ? 1 : 0,
    fSourceClientAreaOnly: 0,
  };
  return a.Update(thumb, props) === 0;
}

export function unregisterThumbnail(thumb: number) {
  lib()?.Unregister(thumb);
}
