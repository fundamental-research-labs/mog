import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';

const DEFAULT_FONT_COLOR = '#000000';
const MAX_SELECTION_COLOR_SCAN_CELLS = 512;

function normalizeHexColor(color: string): string {
  const trimmed = color.trim();
  const shortHex = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${shortHex[1]
      .split('')
      .map((part) => part + part)
      .join('')
      .toUpperCase()}`;
  }
  const longHex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (longHex) return `#${longHex[1].toUpperCase()}`;
  return trimmed.toLowerCase();
}

export function normalizeEffectiveFontColor(color: string | null | undefined): string {
  return color ? normalizeHexColor(color) : DEFAULT_FONT_COLOR;
}

function normalizedRange(range: CellRange): {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
} {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    endRow: Math.max(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

export function getCommonSelectionFontColor(args: {
  ranges: readonly CellRange[];
  activeCellFontColor: string | null | undefined;
  getCellFormat: (row: number, col: number) => CellFormat | null | undefined;
  maxCells?: number;
}): string | undefined {
  const maxCells = args.maxCells ?? MAX_SELECTION_COLOR_SCAN_CELLS;
  if (args.ranges.length === 0) return normalizeEffectiveFontColor(args.activeCellFontColor);

  let cellCount = 0;
  for (const range of args.ranges) {
    const normalized = normalizedRange(range);
    cellCount +=
      (normalized.endRow - normalized.startRow + 1) * (normalized.endCol - normalized.startCol + 1);
    if (cellCount > maxCells) {
      return normalizeEffectiveFontColor(args.activeCellFontColor);
    }
  }

  let commonColor: string | null = null;
  for (const range of args.ranges) {
    const normalized = normalizedRange(range);
    for (let row = normalized.startRow; row <= normalized.endRow; row++) {
      for (let col = normalized.startCol; col <= normalized.endCol; col++) {
        const color = normalizeEffectiveFontColor(args.getCellFormat(row, col)?.fontColor);
        if (commonColor === null) {
          commonColor = color;
        } else if (color !== commonColor) {
          return undefined;
        }
      }
    }
  }

  return commonColor ?? normalizeEffectiveFontColor(args.activeCellFontColor);
}
