import type {
  ChartColor,
  ChartColorMapOverride,
  ChartStyleDiagnostic,
  ChartWorkbookThemeData,
} from '../../types';

export type ChartThemeColorReference = {
  theme: string;
  tintShade?: number;
  tint_shade?: number;
};

export type ChartWorkbookThemeColorPalette = Record<string, string>;

export type ChartWorkbookThemeColorEntry = {
  name: string;
  color: string;
};

export type ResolveChartColorOptions = {
  palette?: ChartWorkbookThemeColorPalette;
  workbookTheme?: ChartWorkbookThemeData | null;
  colorMapOverride?: ChartColorMapOverride;
  ownerKey?: string;
  diagnostics?: ChartStyleDiagnostic[];
};

export type ResolvedColor = {
  color: string;
  opacity?: number;
};

type DrawingColorLike = {
  type?: string;
  val?: string;
  last_clr?: string;
  lastClr?: string;
  hue?: number;
  sat?: number;
  lum?: number;
  r?: number;
  g?: number;
  b?: number;
  transforms?: ColorTransformLike[];
};

type ColorTransformLike = {
  type?: string;
  name?: string;
  val?: number;
};

type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export function normalizeChartHexColor(
  value: string,
  options: { uppercase?: boolean } = {},
): string | undefined {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const format = (normalized: string) =>
    `#${options.uppercase ? normalized.toUpperCase() : normalized}`;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return format(hex);
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return format(
      hex
        .split('')
        .map((ch) => ch + ch)
        .join(''),
    );
  }
  return undefined;
}

function normalizeDirectColorString(value: string): string | undefined {
  const trimmed = value.trim();
  return normalizeChartHexColor(trimmed) ?? (trimmed.startsWith('#') ? trimmed : undefined);
}

export function ooxmlSchemeColorHex(value: string): string | undefined {
  switch (normalizeThemeSlotKey(value)) {
    case 'dk1':
    case 'tx1':
      return '#000000';
    case 'lt1':
    case 'bg1':
      return '#FFFFFF';
    case 'dk2':
    case 'tx2':
      return '#1F497D';
    case 'lt2':
    case 'bg2':
      return '#EEECE1';
    case 'accent1':
      return '#4472C4';
    case 'accent2':
      return '#ED7D31';
    case 'accent3':
      return '#A5A5A5';
    case 'accent4':
      return '#FFC000';
    case 'accent5':
      return '#5B9BD5';
    case 'accent6':
      return '#70AD47';
    case 'hlink':
      return '#0563C1';
    case 'folhlink':
      return '#954F72';
    default:
      return undefined;
  }
}

function normalizeThemeSlotKey(theme: string): string {
  return theme.replace(/_/g, '').toLowerCase();
}

export function chartThemeSlotKey(theme: string): string {
  switch (normalizeThemeSlotKey(theme)) {
    case 'tx1':
      return 'dk1';
    case 'bg1':
      return 'lt1';
    case 'tx2':
      return 'dk2';
    case 'bg2':
      return 'lt2';
    case 'folhlink':
      return 'folhlink';
    default:
      return normalizeThemeSlotKey(theme);
  }
}

export function chartThemeColorKey(color: ChartColor | undefined): string | undefined {
  return typeof color === 'object' && color !== null ? color.theme.toLowerCase() : undefined;
}

export function chartColorTintShade(
  color: ChartColor | ChartThemeColorReference | undefined,
): number | undefined {
  if (!color || typeof color !== 'object') return undefined;
  const wireColor = color as ChartThemeColorReference;
  return wireColor.tintShade ?? wireColor.tint_shade;
}

function isThemeColorReference(value: unknown): value is ChartThemeColorReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { theme?: unknown }).theme === 'string'
  );
}

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

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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

function percent(val: number | undefined, fallback = 1): number {
  return val === undefined ? fallback : val / 100000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(color: Rgba): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) => clamp255(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function hexToRgba(hexColor: string, alpha = 1): Rgba | undefined {
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
  return String(transform.name ?? transform.type ?? '').replace(/_/g, '').toLowerCase();
}

function applyColorTransforms(base: Rgba, transforms: ColorTransformLike[] | undefined): Rgba {
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

function resolvePresetColor(value: string): string | undefined {
  switch (normalizeThemeSlotKey(value)) {
    case 'black':
      return '#000000';
    case 'white':
      return '#FFFFFF';
    case 'red':
      return '#FF0000';
    case 'green':
      return '#008000';
    case 'blue':
      return '#0000FF';
    case 'yellow':
      return '#FFFF00';
    case 'cyan':
    case 'aqua':
      return '#00FFFF';
    case 'magenta':
    case 'fuchsia':
      return '#FF00FF';
    case 'gray':
    case 'grey':
      return '#808080';
    case 'ltgray':
      return '#D3D3D3';
    case 'dkgray':
      return '#A9A9A9';
    case 'orange':
      return '#FFA500';
    case 'purple':
      return '#800080';
    default:
      return undefined;
  }
}

function colorSchemeField(slot: string): string {
  const key = chartThemeSlotKey(slot);
  return key === 'folhlink' ? 'fol_hlink' : key;
}

function colorMapValue(
  mapping: ChartColorMapOverride | undefined,
  logicalSlot: string,
): string | undefined {
  if (!mapping || mapping.type !== 'override') return undefined;
  const normalized = normalizeThemeSlotKey(logicalSlot);
  const raw = mapping.mapping as Record<string, string | undefined>;
  return raw[normalized] ?? raw[normalized === 'folhlink' ? 'folHlink' : normalized];
}

function mappedThemeSlot(
  logicalSlot: string,
  colorMapOverride: ChartColorMapOverride | undefined,
): string {
  return colorMapValue(colorMapOverride, logicalSlot) ?? logicalSlot;
}

function themePalette(theme: ChartWorkbookThemeData | null | undefined): ChartWorkbookThemeColorPalette {
  const palette: ChartWorkbookThemeColorPalette = {};
  for (const color of theme?.colors ?? []) {
    const normalized = normalizeChartHexColor(color.color, { uppercase: true });
    if (normalized) palette[chartThemeSlotKey(color.name)] = normalized;
  }
  return palette;
}

function resolveDrawingColor(
  color: DrawingColorLike | null | undefined,
  options: ResolveChartColorOptions,
  resolvingSlots = new Set<string>(),
): ResolvedColor | undefined {
  if (!color?.type) return undefined;
  let base: Rgba | undefined;
  switch (color.type) {
    case 'SrgbClr':
    case 'srgbClr':
      base = hexToRgba(color.val ?? '');
      break;
    case 'SchemeClr':
    case 'schemeClr':
      return resolveThemeSlot(String(color.val ?? ''), options, resolvingSlots, color.transforms);
    case 'SysClr':
    case 'sysClr':
      base = hexToRgba(color.last_clr ?? color.lastClr ?? '') ?? hexToRgba('#000000');
      break;
    case 'PrstClr':
    case 'prstClr':
      base = hexToRgba(resolvePresetColor(String(color.val ?? '')) ?? '');
      break;
    case 'HslClr':
    case 'hslClr': {
      const [r, g, b] = hslToRgb(
        ((color.hue ?? 0) / 21600000) % 1,
        percent(color.sat),
        percent(color.lum),
      );
      base = { r, g, b, a: 1 };
      break;
    }
    case 'ScrgbClr':
    case 'scrgbClr':
      base = {
        r: percent(color.r) * 255,
        g: percent(color.g) * 255,
        b: percent(color.b) * 255,
        a: 1,
      };
      break;
  }
  if (!base) return undefined;
  const transformed = applyColorTransforms(base, color.transforms);
  return {
    color: rgbToHex(transformed),
    ...(transformed.a < 1 ? { opacity: transformed.a } : {}),
  };
}

function resolveThemeSlot(
  slot: string,
  options: ResolveChartColorOptions,
  resolvingSlots = new Set<string>(),
  transforms?: ColorTransformLike[],
): ResolvedColor | undefined {
  const mappedSlot = mappedThemeSlot(slot, options.colorMapOverride);
  const key = chartThemeSlotKey(mappedSlot);
  if (resolvingSlots.has(key)) return undefined;
  resolvingSlots.add(key);

  const schemeColor = (options.workbookTheme?.colorScheme as Record<string, unknown> | undefined)?.[
    colorSchemeField(key)
  ] as DrawingColorLike | undefined;
  const resolvedFromScheme = resolveDrawingColor(schemeColor, options, resolvingSlots);
  const fallback =
    resolvedFromScheme ??
    resolveDirectColor(options.palette?.[key] ?? themePalette(options.workbookTheme)[key]) ??
    resolveDirectColor(ooxmlSchemeColorHex(key));
  if (!fallback) return undefined;

  const transformed = applyColorTransforms(hexToRgba(fallback.color, fallback.opacity ?? 1)!, transforms);
  return {
    color: rgbToHex(transformed),
    ...(transformed.a < 1 ? { opacity: transformed.a } : {}),
  };
}

function resolveDirectColor(color: string | undefined): ResolvedColor | undefined {
  if (!color) return undefined;
  const normalized = normalizeChartHexColor(color, { uppercase: true });
  return normalized ? { color: normalized } : { color };
}

export function resolveChartColorDetailed(
  color: ChartColor | ChartThemeColorReference | undefined,
  options: ResolveChartColorOptions = {},
): ResolvedColor | undefined {
  if (typeof color === 'string') {
    const normalized = normalizeDirectColorString(color);
    return { color: normalized ?? color };
  }
  if (!isThemeColorReference(color)) return undefined;
  const resolved = resolveThemeSlot(color.theme, options);
  if (!resolved) return undefined;
  const tintShade = chartColorTintShade(color);
  return {
    color: applyChartTintShade(resolved.color, tintShade),
    ...(resolved.opacity !== undefined ? { opacity: resolved.opacity } : {}),
  };
}

export function resolveChartThemeColorReference(
  color: ChartThemeColorReference,
  palette: ChartWorkbookThemeColorPalette,
): string | ChartThemeColorReference {
  const resolved = resolveChartColorDetailed(color, { palette });
  return resolved?.color ?? color;
}

export function resolveChartColor(
  color: ChartColor | ChartThemeColorReference | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColorDetailed(color, options)?.color;
}

export function resolveChartTextColor(
  color: ChartColor | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  if (chartThemeColorKey(color) === 'tx1' && chartColorTintShade(color) === undefined) {
    return '#595959';
  }
  return resolveChartColor(color, options);
}

export function resolveGridlineColor(
  color: ChartColor | undefined,
  options: ResolveChartColorOptions = {},
): string | undefined {
  return resolveChartColor(color, options);
}

export function chartStyleRepeatThemeColor(
  theme: string | undefined,
  sourceSeriesIndex: number,
): string | undefined {
  if (sourceSeriesIndex < 6 || !theme) return undefined;
  switch (theme.toLowerCase()) {
    case 'accent1':
      return '#264478';
    case 'accent2':
      return '#9E480E';
    case 'accent3':
      return '#636363';
    default:
      return undefined;
  }
}

export function applyWorkbookThemePalette<T>(
  value: T,
  palette: ChartWorkbookThemeColorPalette,
): T {
  if (Array.isArray(value)) {
    return value.map((item) => applyWorkbookThemePalette(item, palette)) as T;
  }
  if (isThemeColorReference(value)) {
    return resolveChartThemeColorReference(value, palette) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = applyWorkbookThemePalette(item, palette);
    }
    return output as T;
  }
  return value;
}

export function createChartWorkbookThemeColorPalette(
  colors: readonly ChartWorkbookThemeColorEntry[] | null | undefined,
): ChartWorkbookThemeColorPalette | null {
  if (!Array.isArray(colors) || colors.length === 0) return null;

  const palette: ChartWorkbookThemeColorPalette = {};
  for (const color of colors) {
    const normalized = normalizeChartHexColor(color.color, { uppercase: true });
    if (normalized) palette[chartThemeSlotKey(color.name)] = normalized;
  }
  return Object.keys(palette).length > 0 ? palette : null;
}
