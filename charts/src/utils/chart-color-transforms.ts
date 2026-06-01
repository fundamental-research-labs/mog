import type { ColorTransformLike, Rgba } from './chart-color-types';
import { normalizeChartHexColor } from './chart-color-normalization';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h = 0;
  if (max === rn) {
    h = (gn - bn) / delta + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  return [h / 6, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255,
  ];
}

export function applyChartTintShade(hexColor: string, tintShade: number | undefined): string {
  if (tintShade === undefined || tintShade === 0) return hexColor;
  const tintAmount =
    tintShade > 0 && tintShade <= 1 ? (tintShade > 0.5 ? 1 - tintShade : tintShade) : tintShade;
  const normalized = normalizeChartHexColor(hexColor);
  if (!normalized) return hexColor;
  const hex = normalized.slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  const [h, s, l] = rgbToHsl(r, g, b);
  const adjustedL =
    tintAmount > 0 ? l * (1 - tintAmount) + tintAmount : l * Math.max(0, 1 + tintAmount);
  const channels = hslToRgb(h, s, clamp01(adjustedL)).map((channel) => clamp255(channel));
  return rgbToHex({ r: channels[0], g: channels[1], b: channels[2], a: 1 });
}

export function percent(val: number | undefined, fallback = 1): number {
  return val === undefined ? fallback : val / 100000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbToHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clamp255(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function hexToRgba(hexColor: string, alpha = 1): Rgba | undefined {
  const normalized = normalizeChartHexColor(hexColor);
  if (!normalized) return undefined;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
    a: alpha,
  };
}

function transformName(transform: ColorTransformLike): string {
  return String(transform.name ?? transform.type ?? '')
    .replace(/_/g, '')
    .toLowerCase();
}

export function applyColorTransforms(
  base: Rgba,
  transforms: ColorTransformLike[] | undefined,
): Rgba {
  let color = { ...base };
  for (const transform of transforms ?? []) {
    const value = transform.val;
    switch (transformName(transform)) {
      case 'alpha':
        color.a = clamp01(percent(value));
        break;
      case 'alphamod':
        color.a = clamp01(color.a * percent(value));
        break;
      case 'alphaoff':
        color.a = clamp01(color.a + percent(value, 0));
        break;
      case 'hue':
      case 'hueoff':
      case 'huemod':
      case 'sat':
      case 'satoff':
      case 'satmod':
      case 'lum':
      case 'lumoff':
      case 'lummod':
      case 'tint':
      case 'shade':
      case 'comp':
        color = applyHslTransform(color, transform);
        break;
      case 'red':
        color.r = clamp255(percent(value) * 255);
        break;
      case 'redmod':
        color.r = clamp255(color.r * percent(value));
        break;
      case 'redoff':
        color.r = clamp255(color.r + percent(value, 0) * 255);
        break;
      case 'green':
        color.g = clamp255(percent(value) * 255);
        break;
      case 'greenmod':
        color.g = clamp255(color.g * percent(value));
        break;
      case 'greenoff':
        color.g = clamp255(color.g + percent(value, 0) * 255);
        break;
      case 'blue':
        color.b = clamp255(percent(value) * 255);
        break;
      case 'bluemod':
        color.b = clamp255(color.b * percent(value));
        break;
      case 'blueoff':
        color.b = clamp255(color.b + percent(value, 0) * 255);
        break;
      case 'inv':
        color = { ...color, r: 255 - color.r, g: 255 - color.g, b: 255 - color.b };
        break;
      case 'gray': {
        const gray = clamp255(0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b);
        color = { ...color, r: gray, g: gray, b: gray };
        break;
      }
      case 'gamma':
        color = gamma(color, 2.2);
        break;
      case 'invgamma':
        color = gamma(color, 1 / 2.2);
        break;
    }
  }
  return color;
}

function applyHslTransform(color: Rgba, transform: ColorTransformLike): Rgba {
  let [h, s, l] = rgbToHsl(color.r, color.g, color.b);
  const value = transform.val;
  switch (transformName(transform)) {
    case 'hue':
      h = ((value ?? 0) / 21600000) % 1;
      break;
    case 'hueoff':
      h += (value ?? 0) / 21600000;
      break;
    case 'huemod':
      h *= percent(value);
      break;
    case 'sat':
      s = percent(value);
      break;
    case 'satoff':
      s += percent(value, 0);
      break;
    case 'satmod':
      s *= percent(value);
      break;
    case 'lum':
      l = percent(value);
      break;
    case 'lumoff':
      l += percent(value, 0);
      break;
    case 'lummod':
      l *= percent(value);
      break;
    case 'tint':
      l = l * (1 - percent(value, 0)) + percent(value, 0);
      break;
    case 'shade':
      l *= 1 - percent(value, 0);
      break;
    case 'comp':
      h += 0.5;
      break;
  }
  const [r, g, b] = hslToRgb(((h % 1) + 1) % 1, clamp01(s), clamp01(l));
  return { ...color, r: clamp255(r), g: clamp255(g), b: clamp255(b) };
}

function gamma(color: Rgba, exponent: number): Rgba {
  return {
    ...color,
    r: clamp255((color.r / 255) ** exponent * 255),
    g: clamp255((color.g / 255) ** exponent * 255),
    b: clamp255((color.b / 255) ** exponent * 255),
  };
}
