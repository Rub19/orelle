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

function withEndpoint<T>(fn: (volume: unknown, device: unknown) => T): T | null {
  const api = koffiApi();
  if (!api) return null;
  protos ??= makeProtos();
  const enumerator = coCreate(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator);
  if (!enumerator) return null;
  let device: unknown = null;
  let volume: unknown = null;
  try {
    const dev: unknown[] = [null];
    // eRender = 0, eMultimedia = 1
    if (comCall(enumerator, 4, protos.getDefault, 0, 1, dev) !== 0 || !dev[0]) return null;
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
