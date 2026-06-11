/**
 * Cell Text Style Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/cells/cell-style.
 */

import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import type { CellTextStyle } from '@mog-sdk/contracts/cells/cell-style';
import { DEFAULT_CELL_STYLE } from '@mog-sdk/contracts/cells/cell-style';

// Re-export so consumers can import from one place
export { DEFAULT_CELL_STYLE };

function normalizeFontColor(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const shortHexMatch = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (shortHexMatch) {
    return `#${shortHexMatch[1]}${shortHexMatch[1]}${shortHexMatch[2]}${shortHexMatch[2]}${shortHexMatch[3]}${shortHexMatch[3]}`;
  }

  const rgbMatch = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1]
      .split(',')
      .slice(0, 3)
      .map((part) => Number.parseInt(part.trim(), 10));

    if ([r, g, b].every((component) => Number.isInteger(component))) {
      return `#${[r, g, b].map((component) => component.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  return trimmed;
}

export function isAutomaticDefaultFontColor(fontColor: string | undefined): boolean {
  return (
    !!fontColor &&
    normalizeFontColor(fontColor) === normalizeFontColor(DEFAULT_CELL_STYLE.fontColor)
  );
}

export function resolveCellTextColor(
  format: Pick<CellFormat, 'fontColor'> | undefined,
  defaultFontColor?: string,
): string {
  const fontColor = format?.fontColor;
  if (!fontColor) {
    return defaultFontColor ?? DEFAULT_CELL_STYLE.fontColor;
  }

  // Viewport-resolved formats can include the workbook default black even when
  // the cell text is automatic. Let renderer skins/theme defaults own that case.
  if (defaultFontColor && isAutomaticDefaultFontColor(fontColor)) {
    return defaultFontColor;
  }

  return fontColor;
}

/**
 * Compute text alignment based on format and cell value.
 */
export function computeTextAlign(
  align: CellFormat['horizontalAlign'] | undefined,
  value: CellValue | undefined,
): 'left' | 'center' | 'right' | 'justify' {
  if (!align || align === 'general') {
    if (typeof value === 'number') return 'right';
    if (typeof value === 'boolean') return 'center';
    return 'left';
  }
  if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') {
    return align;
  }
  switch (align) {
    case 'fill':
      return 'left';
    case 'centerContinuous':
      return 'center';
    case 'distributed':
      return 'justify';
    default:
      return 'left';
  }
}

/**
 * Map canonical vertical alignment to CSS-compatible alignment.
 * `justify` and `distributed` aren't expressible as CSS vertical-align —
 * fall back to Excel's default (`bottom`).
 */
function mapVerticalAlign(align: CellFormat['verticalAlign']): CellTextStyle['verticalAlign'] {
  switch (align) {
    case 'justify':
    case 'distributed':
    case undefined:
      return 'bottom';
    case 'middle':
      return 'middle';
    case 'top':
    case 'bottom':
      return align;
    default:
      return 'bottom';
  }
}

/**
 * Build CSS text-decoration value from format flags.
 */
function buildTextDecoration(format: CellFormat | undefined): string {
  const parts = [
    format?.underlineType && format.underlineType !== 'none' ? 'underline' : '',
    format?.strikethrough ? 'line-through' : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Resolve cell format to a complete text style.
 */
export function resolveCellTextStyle(
  format: CellFormat | undefined,
  value?: CellValue,
  defaultFontColor?: string,
): CellTextStyle {
  return {
    paddingX: DEFAULT_CELL_STYLE.padding,
    fontSize: format?.fontSize ?? DEFAULT_CELL_STYLE.fontSize,
    fontFamily: format?.fontFamily ?? DEFAULT_CELL_STYLE.fontFamily,
    fontWeight: format?.bold ? 'bold' : 'normal',
    fontStyle: format?.italic ? 'italic' : 'normal',
    color: resolveCellTextColor(format, defaultFontColor),
    textDecoration: buildTextDecoration(format),
    textAlign: computeTextAlign(format?.horizontalAlign, value),
    verticalAlign: mapVerticalAlign(format?.verticalAlign),
    lineHeight: 1,
    backgroundColor: format?.backgroundColor ?? DEFAULT_CELL_STYLE.backgroundColor,
  };
}
