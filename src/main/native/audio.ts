// Master volume of the default playback device through Core Audio (IMMDeviceEnumerator →
// IMMDevice → IAudioEndpointVolume), called over COM vtables with koffi. No helper process.
import { log } from '../logger';
import { coCreate, comCall, comRelease, guidBytes, koffiApi } from './win32';

const CLSID_MMDeviceEnumerator = 'BCDE0395-E52F-467C-8E3D-C4579291692E';
const IID_IMMDeviceEnumerator = 'A95664D2-9614-4F35-A746-DE8DB63617E6';
const IID_IAudioEndpointVolume = '5CDF2C82-841E-4546-9722-0CF74078229A';
const PKEY_Device_FriendlyName = { fmtid: guidBytes('A45C254E-DF1C-4EFD-8020-67D146A850E0'), pid: 14 };

let protos: ReturnType<typeof makeProtos> | null = null;
function makeProtos() {
  const k = koffiApi()!.koffi;
  return {
    getDefault: k.proto('long __stdcall OrelleGetDefaultEndpoint(void *self, int flow, int role, _Out_ void **dev)'),
    activate: k.proto('long __stdcall OrelleActivate(void *self, const uint8_t *iid, uint32_t ctx, void *params, _Out_ void **out)'),
    openStore: k.proto('long __stdcall OrelleOpenPropertyStore(void *self, uint32_t access, _Out_ void **store)'),
    setScalar: k.proto('long __stdcall OrelleSetMasterScalar(void *self, float level, void *ctx)'),
    getScalar: k.proto('long __stdcall OrelleGetMasterScalar(void *self, _Out_ float *level)'),
    setMute: k.proto('long __stdcall OrelleSetMute(void *self, int mute, void *ctx)'),
    getMute: k.proto('long __stdcall OrelleGetMute(void *self, _Out_ int *mute)'),
  };
}

/** flow: 0 = playback (eRender), 1 = recording (eCapture). */
function withEndpoint<T>(fn: (volume: unknown, device: unknown) => T, flow: 0 | 1 = 0): T | null {
  const api = koffiApi();
  if (!api) return null;
  protos ??= makeProtos();
  const enumerator = coCreate(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator);
  if (!enumerator) return null;
  let device: unknown = null;
  let volume: unknown = null;
  try {
    const dev: unknown[] = [null];
    // role eMultimedia = 1 (eCommunications for capture would follow the call device instead)
    if (comCall(enumerator, 4, protos.getDefault, flow, 1, dev) !== 0 || !dev[0]) return null;
    device = dev[0];
    const vol: unknown[] = [null];
    if (comCall(device, 3, protos.activate, guidBytes(IID_IAudioEndpointVolume), 0x17, null, vol) !== 0 || !vol[0]) return null;
    volume = vol[0];
    return fn(volume, device);
  } catch (err) {
    log.warn('audio', 'Core Audio call failed', err);
    return null;
  } finally {
    comRelease(volume);
    comRelease(device);
    comRelease(enumerator);
  }
}

function deviceName(device: unknown): string {
  const api = koffiApi()!;
  const k = api.koffi;
  const out: unknown[] = [null];
  if (comCall(device, 4, protos!.openStore, 0 /* STGM_READ */, out) !== 0 || !out[0]) return '';
  const store = out[0];
  const pv = Buffer.alloc(k.sizeof(api.PROPVARIANT));
  try {
    if (comCall(store, 5, api.GetValueProto, PKEY_Device_FriendlyName, pv) !== 0 || pv.readUInt16LE(0) !== 31) return '';
    const ptr = k.decode(pv, 8, 'void *');
    return ptr ? (k.decode(ptr, 'char16_t', -1) as string) : '';
  } finally {
    api.PropVariantClear(pv);
    comRelease(store);
  }
}

export function getVolume(): { level: number; muted: boolean; device: string } | null {
  return withEndpoint((vol, dev) => {
    const level = [0];
    const mute = [0];
    comCall(vol, 9, protos!.getScalar, level);
    comCall(vol, 15, protos!.getMute, mute);
    return { level: Math.round(level[0] * 100), muted: mute[0] !== 0, device: deviceName(dev) };
  });
}

export function setVolume(level: number): boolean {
  return !!withEndpoint((vol) => {
    const v = Math.max(0, Math.min(100, level)) / 100;
    if (v > 0) comCall(vol, 14, protos!.setMute, 0, null);
    return comCall(vol, 7, protos!.setScalar, v, null) === 0;
  });
}

export function setMuted(muted: boolean): boolean {
  return !!withEndpoint((vol) => comCall(vol, 14, protos!.setMute, muted ? 1 : 0, null) === 0);
}

export function getMicrophone(): { muted: boolean; device: string; level: number } | null {
  return withEndpoint((vol, dev) => {
    const level = [0];
    const mute = [0];
    comCall(vol, 9, protos!.getScalar, level);
    comCall(vol, 15, protos!.getMute, mute);
    return { level: Math.round(level[0] * 100), muted: mute[0] !== 0, device: deviceName(dev) };
  }, 1);
}

export function setMicrophoneMuted(muted: boolean): boolean {
  return !!withEndpoint((vol) => comCall(vol, 14, protos!.setMute, muted ? 1 : 0, null) === 0, 1);
}
// ---------- Audio Center: devices, per-app sessions, peak meters ----------

const IID_IAudioSessionManager2 = '77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F';
const IID_IAudioSessionControl2 = 'BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D';
const IID_ISimpleAudioVolume = '87CE5498-68D6-44E5-9215-6DA47EF883D8';
const IID_IAudioMeterInformation = 'C02216F6-8C67-4B5B-9D00-D008E73E0064';

let ext: ReturnType<typeof makeExtProtos> | null = null;
function makeExtProtos() {
  const k = koffiApi()!.koffi;
  return {
    enumEndpoints: k.proto('long __stdcall OrelleEnumAudioEndpoints(void *self, int flow, uint32_t mask, _Out_ void **coll)'),
    getDevice: k.proto('long __stdcall OrelleGetDevice(void *self, const char16_t *id, _Out_ void **dev)'),
    count: k.proto('long __stdcall OrelleCollectionCount(void *self, _Out_ uint32_t *n)'),
    item: k.proto('long __stdcall OrelleCollectionItem(void *self, uint32_t i, _Out_ void **dev)'),
    getId: k.proto('long __stdcall OrelleDeviceGetId(void *self, _Out_ void **id)'),
    qi: k.proto('long __stdcall OrelleQueryInterface(void *self, const uint8_t *iid, _Out_ void **out)'),
    sessionEnum: k.proto('long __stdcall OrelleGetSessionEnumerator(void *self, _Out_ void **e)'),
    getSession: k.proto('long __stdcall OrelleGetSession(void *self, int i, _Out_ void **s)'),
    getState: k.proto('long __stdcall OrelleSessionGetState(void *self, _Out_ int *state)'),
    getPid: k.proto('long __stdcall OrelleSessionGetProcessId(void *self, _Out_ uint32_t *pid)'),
    isSystem: k.proto('long __stdcall OrelleIsSystemSoundsSession(void *self)'),
    sSetVol: k.proto('long __stdcall OrelleSimpleSetVolume(void *self, float level, void *ctx)'),
    sGetVol: k.proto('long __stdcall OrelleSimpleGetVolume(void *self, _Out_ float *level)'),
    sSetMute: k.proto('long __stdcall OrelleSimpleSetMute(void *self, int mute, void *ctx)'),
    sGetMute: k.proto('long __stdcall OrelleSimpleGetMute(void *self, _Out_ int *mute)'),
    peak: k.proto('long __stdcall OrelleGetPeakValue(void *self, _Out_ float *peak)'),
  };
}

export interface AudioDevice { id: string; name: string; flow: 'output' | 'input'; isDefault: boolean; level: number; muted: boolean; peak: number }
export interface AudioSession { pid: number; system: boolean; active: boolean; level: number; muted: boolean; peak: number }

function readId(device: unknown): string {
  const api = koffiApi()!;
  const out: unknown[] = [null];
  if (comCall(device, 5, ext!.getId, out) !== 0 || !out[0]) return '';
  try {
    return api.koffi.decode(out[0], 'char16_t', -1) as string;
  } finally {
    api.CoTaskMemFree(out[0]);
  }
}

function activate(device: unknown, iid: string): unknown | null {
  const out: unknown[] = [null];
  return comCall(device, 3, protos!.activate, guidBytes(iid), 0x17, null, out) === 0 ? out[0] : null;
}

function query(obj: unknown, iid: string): unknown | null {
  const out: unknown[] = [null];
  return comCall(obj, 0, ext!.qi, guidBytes(iid), out) === 0 ? out[0] : null;
}

function peakOf(meterOwner: unknown, viaQuery: boolean): number {
  const meter = viaQuery ? query(meterOwner, IID_IAudioMeterInformation) : activate(meterOwner, IID_IAudioMeterInformation);
  if (!meter) return 0;
  try {
    const p = [0];
    return comCall(meter, 3, ext!.peak, p) === 0 ? Math.round(p[0] * 100) : 0;
  } finally {
    comRelease(meter);
  }
}

function withEnumerator<T>(fn: (enumerator: unknown) => T): T | null {
  if (!koffiApi()) return null;
  protos ??= makeProtos();
  ext ??= makeExtProtos();
  const enumerator = coCreate(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator);
  if (!enumerator) return null;
  try {
    return fn(enumerator);
  } catch (err) {
    log.warn('audio', 'Core Audio call failed', err);
    return null;
  } finally {
    comRelease(enumerator);
  }
}

/** Active playback and recording devices with their volume and live peak level. */
export function listDevices(): AudioDevice[] {
  return withEnumerator((en) => {
    const out: AudioDevice[] = [];
    for (const flow of [0, 1] as const) {
      const def: unknown[] = [null];
      let defaultId = '';
      if (comCall(en, 4, protos!.getDefault, flow, 1, def) === 0 && def[0]) {
        defaultId = readId(def[0]);
        comRelease(def[0]);
      }
      const coll: unknown[] = [null];
      if (comCall(en, 3, ext!.enumEndpoints, flow, 1 /* DEVICE_STATE_ACTIVE */, coll) !== 0 || !coll[0]) continue;
      try {
        const n = [0];
        comCall(coll[0], 3, ext!.count, n);
        for (let i = 0; i < Math.min(n[0], 32); i++) {
          const d: unknown[] = [null];
          if (comCall(coll[0], 4, ext!.item, i, d) !== 0 || !d[0]) continue;
          try {
            const id = readId(d[0]);
            const vol = activate(d[0], IID_IAudioEndpointVolume);
            const level = [0];
            const mute = [0];
            if (vol) {
              comCall(vol, 9, protos!.getScalar, level);
              comCall(vol, 15, protos!.getMute, mute);
              comRelease(vol);
            }
            out.push({ id, name: deviceName(d[0]) || id, flow: flow === 0 ? 'output' : 'input', isDefault: id === defaultId, level: Math.round(level[0] * 100), muted: mute[0] !== 0, peak: peakOf(d[0], false) });
          } finally {
            comRelease(d[0]);
          }
        }
      } finally {
        comRelease(coll[0]);
      }
    }
    return out;
  }) ?? [];
}

function withDevice<T>(id: string, fn: (device: unknown) => T): T | null {
  return withEnumerator((en) => {
    const d: unknown[] = [null];
    if (comCall(en, 5, ext!.getDevice, id, d) !== 0 || !d[0]) return null;
    try {
      return fn(d[0]);
    } finally {
      comRelease(d[0]);
    }
  });
}

function withDeviceVolume(id: string, fn: (vol: unknown) => boolean): boolean {
  return !!withDevice(id, (d) => {
    const vol = activate(d, IID_IAudioEndpointVolume);
    if (!vol) return false;
    try {
      return fn(vol);
    } finally {
      comRelease(vol);
    }
  });
}

export function setDeviceVolume(id: string, level: number): boolean {
  return withDeviceVolume(id, (vol) => {
    const v = Math.max(0, Math.min(100, level)) / 100;
    if (v > 0) comCall(vol, 14, protos!.setMute, 0, null);
    return comCall(vol, 7, protos!.setScalar, v, null) === 0;
  });
}

export function setDeviceMuted(id: string, muted: boolean): boolean {
  return withDeviceVolume(id, (vol) => comCall(vol, 14, protos!.setMute, muted ? 1 : 0, null) === 0);
}

/** Visits every audio session of the default playback device (expired sessions skipped). */
function eachSession(fn: (control2: unknown, simple: unknown, pid: number, system: boolean, active: boolean) => void) {
  withEnumerator((en) => {
    const def: unknown[] = [null];
    if (comCall(en, 4, protos!.getDefault, 0, 1, def) !== 0 || !def[0]) return;
    const mgr = activate(def[0], IID_IAudioSessionManager2);
    comRelease(def[0]);
    if (!mgr) return;
    const e: unknown[] = [null];
    try {
      if (comCall(mgr, 5, ext!.sessionEnum, e) !== 0 || !e[0]) return;
      const n = [0];
      comCall(e[0], 3, ext!.count, n);
      for (let i = 0; i < Math.min(n[0], 128); i++) {
        const s: unknown[] = [null];
        if (comCall(e[0], 4, ext!.getSession, i, s) !== 0 || !s[0]) continue;
        const c2 = query(s[0], IID_IAudioSessionControl2);
        const simple = query(s[0], IID_ISimpleAudioVolume);
        try {
          if (!c2 || !simple) continue;
          const state = [0];
          comCall(c2, 3, ext!.getState, state);
          if (state[0] === 2) continue; // expired
          const pid = [0];
          comCall(c2, 14, ext!.getPid, pid);
          const system = comCall(c2, 15, ext!.isSystem) === 0;
          fn(c2, simple, pid[0], system, state[0] === 1);
        } finally {
          comRelease(simple);
          comRelease(c2);
          comRelease(s[0]);
        }
      }
    } finally {
      comRelease(e[0]);
      comRelease(mgr);
    }
  });
}

export function listSessions(): AudioSession[] {
  const out: AudioSession[] = [];
  eachSession((c2, simple, pid, system, active) => {
    const level = [0];
    const mute = [0];
    comCall(simple, 4, ext!.sGetVol, level);
    comCall(simple, 6, ext!.sGetMute, mute);
    const peak = peakOf(c2, true);
    const existing = out.find((x) => x.pid === pid && x.system === system);
    if (existing) {
      existing.peak = Math.max(existing.peak, peak);
      existing.active ||= active;
      return;
    }
    out.push({ pid, system, active, level: Math.round(level[0] * 100), muted: mute[0] !== 0, peak });
  });
  return out;
}

/** Volume / mute of every session of one process (an app can own several sessions). */
export function setSession(pid: number, system: boolean, change: { level?: number; muted?: boolean }): boolean {
  let ok = false;
  eachSession((_c2, simple, p, sys) => {
    if (p !== pid || sys !== system) return;
    if (change.level !== undefined) ok = comCall(simple, 3, ext!.sSetVol, Math.max(0, Math.min(100, change.level)) / 100, null) === 0 || ok;
    if (change.muted !== undefined) ok = comCall(simple, 5, ext!.sSetMute, change.muted ? 1 : 0, null) === 0 || ok;
  });
  return ok;
}
