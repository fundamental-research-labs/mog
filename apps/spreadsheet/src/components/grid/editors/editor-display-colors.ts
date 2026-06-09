import type { CellFormat } from '@mog-sdk/contracts/core';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import { DEFAULT_CELL_STYLE } from '@mog/spreadsheet-utils/cells/cell-style';

type EditorDisplayFormat = Pick<CellFormat, 'backgroundColor' | 'fontColor'>;

export interface InlineEditorDisplayColors {
  backgroundColor: string;
  textColor: string;
}

function normalizeColor(value: string): string {
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
      return `#${[r, g, b]
        .map((component) => component.toString(16).padStart(2, '0'))
        .join('')}`;
    }
  }

  return trimmed;
}

function resolveTextColor(format: EditorDisplayFormat | undefined, skin: ResolvedSheetViewSkin): string {
  const fontColor = format?.fontColor;
  if (!fontColor) {
    return skin.defaultCellText;
  }

  // Viewport formats can arrive resolved with DEFAULT_CELL_STYLE.fontColor even
  // when the cell has automatic text. Keep that automatic value skin-driven.
  if (normalizeColor(fontColor) === normalizeColor(DEFAULT_CELL_STYLE.fontColor)) {
    return skin.defaultCellText;
  }

  return fontColor;
}

export function resolveInlineEditorDisplayColors(
  format: EditorDisplayFormat | undefined,
  skin: ResolvedSheetViewSkin,
): InlineEditorDisplayColors {
  return {
    backgroundColor: format?.backgroundColor ?? skin.defaultCellBackground,
    textColor: resolveTextColor(format, skin),
  };
}
