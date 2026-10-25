import { describe, expect, it } from 'vitest';
import { isModestPc, resolvePerformance, tuning } from '../src/shared/performance';

const GB = 1024 ** 3;

describe('performance profile', () => {
  it('detects modest PCs by RAM or thread count', () => {
    expect(isModestPc(8 * GB, 8)).toBe(true);
    expect(isModestPc(4 * GB, 12)).toBe(true);
    expect(isModestPc(16 * GB, 4)).toBe(true);
    expect(isModestPc(16 * GB, 8)).toBe(false);
  });
  it('lets the user override the detection', () => {
    expect(resolvePerformance('auto', 4 * GB, 2)).toBe('light');
    expect(resolvePerformance('standard', 4 * GB, 2)).toBe('standard');
    expect(resolvePerformance('light', 64 * GB, 32)).toBe('light');
  });
  it('samples less often in light mode', () => {
    expect(tuning('light').statsInterval).toBeGreaterThan(tuning('standard').statsInterval);
    expect(tuning('light').buildFileIndexAtStart).toBe(false);
    expect(tuning('light').trimHiddenAfter).toBeLessThan(tuning('standard').trimHiddenAfter);
  });
});

describe('version comparison', async () => {
  const { compareVersions } = await import('../src/shared/version');
  it('orders releases and pre-releases', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBe(1);
    expect(compareVersions('v1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.3')).toBe(1);
  });
});

describe('network diagnostics', async () => {
  const { parsePing } = await import('../src/main/services/networkService');
  it('reads ping times in French and English output', () => {
    expect(parsePing('Réponse de 1.1.1.1 : octets=32 temps=12 ms TTL=57\nRéponse de 1.1.1.1 : octets=32 temps=14 ms TTL=57')).toBe(13);
    expect(parsePing('Reply from 192.168.1.1: bytes=32 time<1ms TTL=64')).toBe(1);
    expect(parsePing('Délai d’attente de la demande dépassé.')).toBeNull();
  });
});

describe('sensors', async () => {
  const { parseBatteryReport, parseNvidiaSmi, parseThermalZones } = await import('../src/main/services/sensorService');
  it('reads nvidia-smi CSV with missing fields', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 3050 Laptop GPU, 38, 0, 9, 4096, 6.62, [N/A]\n')).toEqual([
      { name: 'NVIDIA GeForce RTX 3050 Laptop GPU', tempC: 38, load: 0, memUsedMB: 9, memTotalMB: 4096, powerW: 6.62, fan: null },
    ]);
  });
  it('computes battery health from the battery report', () => {
    const xml = '<BatteryReport><Batteries><Battery><Id>AP18E7M</Id><DesignCapacity>58751</DesignCapacity><FullChargeCapacity>46801</FullChargeCapacity><CycleCount>14</CycleCount></Battery></Batteries></BatteryReport>';
    expect(parseBatteryReport(xml)).toEqual({ id: 'AP18E7M', designMWh: 58751, fullMWh: 46801, healthPercent: 79.7, cycles: 14 });
    expect(parseBatteryReport('<BatteryReport/>')).toBeNull();
  });
  it('converts thermal zones from tenths of kelvin and drops empty ones', () => {
    expect(parseThermalZones('\\_TZ.TZ00|3132\r\n\\_TZ.TZ01|0\r\nbad|x\r\n')).toEqual([{ name: 'TZ00', tempC: 40.1 }]);
    expect(parseThermalZones('')).toEqual([]);
  });
});
