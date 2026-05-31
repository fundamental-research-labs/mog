import type {
  ColorTransformLike,
  DrawingColorLike,
  ResolveChartColorOptions,
  ResolvedColor,
  Rgba,
} from './chart-color-types';
import { resolveDirectColor } from './chart-color-normalization';
import {
  applyColorTransforms,
  hexToRgba,
  hslToRgb,
  percent,
  rgbToHex,
} from './chart-color-transforms';
import {
  chartThemeSlotKey,
  colorSchemeField,
  mappedThemeSlot,
  normalizeThemeSlotKey,
  ooxmlSchemeColorHex,
  themePalette,
} from './chart-theme-colors';

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

export function resolveDrawingColor(
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

export function resolveThemeSlot(
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

  const transformed = applyColorTransforms(
    hexToRgba(fallback.color, fallback.opacity ?? 1)!,
    transforms,
  );
  return {
    color: rgbToHex(transformed),
    ...(transformed.a < 1 ? { opacity: transformed.a } : {}),
  };
}
