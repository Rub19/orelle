// Unit conversions for the launcher: "10 km en mi", "72 f to c", "5 go in mo".
import { evaluate } from './calc';

type Unit = { dim: string; factor: number; label: string };

const U: Record<string, Unit> = {};
const def = (dim: string, factor: number, label: string, ...aliases: string[]) => {
  for (const a of aliases) U[a] = { dim, factor, label };
};

// Length (metre)
def('length', 1e-3, 'mm', 'mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters');
def('length', 1e-2, 'cm', 'cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters');
def('length', 1, 'm', 'm', 'metre', 'metres', 'meter', 'meters');
def('length', 1e3, 'km', 'km', 'kilometre', 'kilometres', 'kilometer', 'kilometers');
def('length', 0.0254, 'in', 'in', 'inch', 'inches', 'pouce', 'pouces', '"');
def('length', 0.3048, 'ft', 'ft', 'foot', 'feet', 'pied', 'pieds');
def('length', 0.9144, 'yd', 'yd', 'yard', 'yards');
def('length', 1609.344, 'mi', 'mi', 'mile', 'miles');
def('length', 1852, 'nmi', 'nmi', 'nautical');
// Mass (kilogram)
def('mass', 1e-6, 'mg', 'mg');
def('mass', 1e-3, 'g', 'g', 'gramme', 'grammes', 'gram', 'grams');
def('mass', 1, 'kg', 'kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes', 'kilogram', 'kilograms');
def('mass', 1000, 't', 't', 'tonne', 'tonnes');
def('mass', 0.45359237, 'lb', 'lb', 'lbs', 'pound', 'pounds', 'livre', 'livres');
def('mass', 0.028349523125, 'oz', 'oz', 'ounce', 'ounces', 'once', 'onces');
// Volume (litre)
def('volume', 1e-3, 'ml', 'ml');
def('volume', 1e-2, 'cl', 'cl');
def('volume', 1, 'l', 'l', 'litre', 'litres', 'liter', 'liters');
def('volume', 3.785411784, 'gal', 'gal', 'gallon', 'gallons');
def('volume', 0.0295735295625, 'fl oz', 'floz');
def('volume', 0.2365882365, 'cup', 'cup', 'cups', 'tasse', 'tasses');
// Data (byte) — decimal and binary prefixes; French "o" (octet) aliases.
def('data', 1, 'B', 'b', 'byte', 'bytes', 'o', 'octet', 'octets');
def('data', 1e3, 'kB', 'kb', 'ko');
def('data', 1e6, 'MB', 'mb', 'mo');
def('data', 1e9, 'GB', 'gb', 'go');
def('data', 1e12, 'TB', 'tb', 'to');
def('data', 1024, 'KiB', 'kib', 'kio');
def('data', 1024 ** 2, 'MiB', 'mib', 'mio');
def('data', 1024 ** 3, 'GiB', 'gib', 'gio');
def('data', 1024 ** 4, 'TiB', 'tib', 'tio');
// Time (second)
def('time', 1e-3, 'ms', 'ms');
def('time', 1, 's', 's', 'sec', 'second', 'seconds', 'seconde', 'secondes');
def('time', 60, 'min', 'min', 'minute', 'minutes');
def('time', 3600, 'h', 'h', 'hr', 'hour', 'hours', 'heure', 'heures');
def('time', 86400, 'd', 'd', 'day', 'days', 'j', 'jour', 'jours');
def('time', 604800, 'wk', 'wk', 'week', 'weeks', 'semaine', 'semaines');
// Speed (m/s)
def('speed', 1, 'm/s', 'm/s', 'mps');
def('speed', 1 / 3.6, 'km/h', 'km/h', 'kmh', 'kph');
def('speed', 0.44704, 'mph', 'mph');
def('speed', 0.514444, 'kn', 'kn', 'knot', 'knots', 'noeud', 'noeuds');
// Area (m²)
def('area', 1, 'm²', 'm2', 'm²');
def('area', 1e6, 'km²', 'km2', 'km²');
def('area', 1e4, 'ha', 'ha', 'hectare', 'hectares');
def('area', 4046.8564224, 'ac', 'acre', 'acres');
def('area', 0.09290304, 'ft²', 'ft2', 'sqft');
// Temperature handled separately.
const TEMPS: Record<string, 'C' | 'F' | 'K'> = {
  c: 'C', '°c': 'C', celsius: 'C',
  f: 'F', '°f': 'F', fahrenheit: 'F',
  k: 'K', kelvin: 'K',
};

function toKelvin(v: number, u: 'C' | 'F' | 'K') {
  return u === 'C' ? v + 273.15 : u === 'F' ? (v - 32) * (5 / 9) + 273.15 : v;
}
function fromKelvin(v: number, u: 'C' | 'F' | 'K') {
  return u === 'C' ? v - 273.15 : u === 'F' ? (v - 273.15) * (9 / 5) + 32 : v;
}

export interface Conversion {
  value: number;
  from: string;
  to: string;
  result: number;
}

const RE = /^\s*(.+?)\s*([a-z°²"/]+(?:\s?oz)?)\s+(?:en|to|in|->|=>|vers|=)\s+([a-z°²"/]+(?:\s?oz)?)\s*$/i;

export function convert(input: string): Conversion | null {
  const m = RE.exec(input.trim().toLowerCase());
  if (!m) return null;
  const value = evaluate(m[1]) ?? (Number.isFinite(Number(m[1].replace(',', '.'))) ? Number(m[1].replace(',', '.')) : null);
  if (value === null) return null;
  const a = m[2].replace(/\s/g, '');
  const b = m[3].replace(/\s/g, '');

  const ta = TEMPS[a];
  const tb = TEMPS[b];
  if (ta && tb) {
    return { value, from: `°${ta}`.replace('°K', 'K'), to: `°${tb}`.replace('°K', 'K'), result: fromKelvin(toKelvin(value, ta), tb) };
  }
  const ua = U[a];
  const ub = U[b];
  if (!ua || !ub || ua.dim !== ub.dim) return null;
  return { value, from: ua.label, to: ub.label, result: (value * ua.factor) / ub.factor };
}
