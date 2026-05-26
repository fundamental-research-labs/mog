/**
 * Theme Resolution Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/formatting/theme.
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import type {
  ColorValue,
  ParsedThemeColor,
  ThemeColorSlot,
  ThemeDefinition,
} from '@mog-sdk/contracts/formatting/theme';

export function isThemeColor(colorValue: string | undefined): boolean {
  return colorValue !== undefined && colorValue.startsWith('theme:');
}

export function parseThemeColor(ref: string): ParsedThemeColor | null {
  if (!ref.startsWith('theme:')) {
    return null;
  }

  const parts = ref.slice(6).split(':');
  const slot = parts[0] as ThemeColorSlot;

  const validSlots: ThemeColorSlot[] = [
    'dark1',
    'light1',
    'dark2',
    'light2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hyperlink',
    'followedHyperlink',
  ];

  if (!validSlots.includes(slot)) {
    return null;
  }

  const result: ParsedThemeColor = { slot };

  if (parts.length > 1) {
    const tint = parseFloat(parts[1]);
    if (!isNaN(tint)) {
      result.tint = tint;
    }
  }

  return result;
}

/** Convert RGB (0..255 each) to HSL (h in 0..360, s and l in 0..1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;

  if (Math.abs(max - min) < 1e-10) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (Math.abs(max - rN) < 1e-10) {
    h = (gN - bN) / d;
    if (gN < bN) {
      h += 6;
    }
  } else if (Math.abs(max - gN) < 1e-10) {
    h = (bN - rN) / d + 2;
  } else {
    h = (rN - gN) / d + 4;
  }

  return [h * 60, s, l];
}

/** Convert HSL (h in 0..360, s and l in 0..1) back to RGB (0..255 each). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (Math.abs(s) < 1e-10) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hN = h / 360;

  function hueToRgb(p: number, q: number, t: number): number {
    let tN = t;
    if (tN < 0) tN += 1;
    if (tN > 1) tN -= 1;
    if (tN < 1 / 6) return p + (q - p) * 6 * tN;
    if (tN < 1 / 2) return q;
    if (tN < 2 / 3) return p + (q - p) * (2 / 3 - tN) * 6;
    return p;
  }

  const r = Math.round(hueToRgb(p, q, hN + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, hN) * 255);
  const b = Math.round(hueToRgb(p, q, hN - 1 / 3) * 255);
  return [r, g, b];
}

/**
 * Apply an ECMA-376 tint to a hex color string (e.g. "#4472C4").
 *
 * Uses HSL-based tinting per ECMA-376 §20.1.2.3.14:
 * - tint < 0 darkens: L' = L * (1 + tint)
 * - tint >= 0 lightens: L' = L * (1 - tint) + tint
 */
export function applyTint(hexColor: string, tint: number): string {
  const hex = hexColor.replace('#', '');
  if (hex.length < 6) return hexColor;

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const [h, s, l] = rgbToHsl(r, g, b);

  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;

  const [r2, g2, b2] = hslToRgb(h, s, l2);

  const toHex = (n: number) =>
    Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

export function resolveColor(colorValue: string, theme: ThemeDefinition): string {
  const parsed = parseThemeColor(colorValue);

  if (!parsed) {
    return colorValue;
  }

  const baseColor = theme.colors[parsed.slot];

  if (parsed.tint !== undefined) {
    return applyTint(baseColor, parsed.tint);
  }

  return baseColor;
}

export function resolveThemeColors(
  format: CellFormat | undefined,
  theme: ThemeDefinition,
): CellFormat | undefined {
  if (!format) {
    return undefined;
  }

  const needsResolution =
    (format.fontColor && isThemeColor(format.fontColor)) ||
    (format.backgroundColor && isThemeColor(format.backgroundColor));

  if (!needsResolution) {
    return format;
  }

  return {
    ...format,
    fontColor:
      format.fontColor && isThemeColor(format.fontColor)
        ? resolveColor(format.fontColor, theme)
        : format.fontColor,
    backgroundColor:
      format.backgroundColor && isThemeColor(format.backgroundColor)
        ? resolveColor(format.backgroundColor, theme)
        : format.backgroundColor,
  };
}

export function createThemeColorRef(slot: ThemeColorSlot, tint?: number): ColorValue {
  if (tint !== undefined && tint !== 0) {
    return `theme:${slot}:${tint}`;
  }
  return `theme:${slot}`;
}

export function resolveThemeFont(fontTheme: 'major' | 'minor', theme: ThemeDefinition): string {
  return fontTheme === 'major' ? theme.fonts.majorFont : theme.fonts.minorFont;
}

export function resolveThemeFonts(
  format: CellFormat | undefined,
  theme: ThemeDefinition,
): CellFormat | undefined {
  if (!format) {
    return undefined;
  }

  if (!format.fontTheme) {
    return format;
  }

  const resolvedFontFamily = resolveThemeFont(format.fontTheme, theme);

  return {
    ...format,
    fontFamily: resolvedFontFamily,
  };
}

export function resolveAllThemeRefs(
  format: CellFormat | undefined,
  theme: ThemeDefinition,
): CellFormat | undefined {
  return resolveThemeColors(resolveThemeFonts(format, theme), theme);
}
