import type { TextMeasurer } from '@mog/canvas-engine';
import type { CellFormat } from '@mog-sdk/contracts/core';
import {
  buildCellFont,
  calculateTextOverflow,
  canValueOverflow,
  mapHorizontalAlign,
  renderNormalText,
  type OverflowResult,
  ViewportMergeIndex,
  ViewportPositionIndex,
} from '@mog/grid-renderer';

import { OFFICE_THEME } from '../../../infra/styles/built-in-themes';

export interface PrintCellRenderContext {
  readonly positionIndex: ViewportPositionIndex;
  readonly mergeIndex: ViewportMergeIndex;
  readonly isCellEmpty: (row: number, col: number) => boolean;
  readonly maxCol: number;
  readonly textMeasurer: TextMeasurer;
}

export interface PrintMergedRegion {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export function createPrintPositionIndex(
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  rowHeightMap: Map<number, number>,
  colWidthMap: Map<number, number>,
  hiddenColumns: Set<number>,
): ViewportPositionIndex {
  const rowCount = endRow - startRow + 1;
  const colCount = endCol - startCol + 1;
  const rowPositions = new Float64Array(rowCount + 1);
  const colPositions = new Float64Array(colCount + 1);

  let y = 0;
  for (let row = startRow; row <= endRow; row++) {
    rowPositions[row - startRow] = y;
    y += rowHeightMap.get(row) ?? 20;
  }
  rowPositions[rowCount] = y;

  let x = 0;
  for (let col = startCol; col <= endCol; col++) {
    colPositions[col - startCol] = x;
    x += colWidthMap.get(col) ?? 64;
  }
  colPositions[colCount] = x;

  const index = new ViewportPositionIndex(20, 64);
  index.setPositions(rowPositions, colPositions, startRow, startCol, rowCount, colCount, 20, 64);
  index.setHiddenState(new Set(), hiddenColumns);
  return index;
}

export function createPrintMergeIndex(
  mergedRegions: readonly PrintMergedRegion[],
): ViewportMergeIndex {
  const index = new ViewportMergeIndex();
  index.setMerges(
    mergedRegions.map((merge) => ({
      start_row: merge.startRow,
      start_col: merge.startCol,
      end_row: merge.endRow,
      end_col: merge.endCol,
    })),
  );
  return index;
}

export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  const measureText = (text: string, font: string): ReturnType<TextMeasurer['measureText']> => {
    const previousFont = ctx.font;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    ctx.font = previousFont;
    return {
      width: metrics.width,
      actualBoundingBoxAscent: metrics.actualBoundingBoxAscent ?? 0,
      actualBoundingBoxDescent: metrics.actualBoundingBoxDescent ?? 0,
    };
  };

  return {
    measureText,
    measureWrappedText(text, _font) {
      const lineHeight = 12;
      return {
        lines: [text],
        lineHeight,
        totalHeight: lineHeight,
      };
    },
  };
}

export function drawPrintCell(
  ctx: CanvasRenderingContext2D,
  cell: {
    readonly row: number;
    readonly col: number;
    readonly value: unknown;
    readonly format: CellFormat | undefined;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly preFormatted?: string;
  },
  context: PrintCellRenderContext,
): void {
  const { row, col, value, format, x, y, width, height, preFormatted } = cell;
  const displayText = preFormatted ?? formatCellValue(value);
  if (!displayText) return;

  ctx.save();
  if (format?.backgroundColor) {
    ctx.fillStyle = format.backgroundColor;
    ctx.fillRect(x, y, width, height);
  }

  const font = buildCellFont(format, OFFICE_THEME, displayText);
  const textWidth = context.textMeasurer.measureText(displayText, font).width;
  const overflowResult = calculatePrintCellOverflow(
    { row, col, value, format, x, width, textWidth },
    context,
  );

  renderNormalText(
    ctx,
    {
      row,
      col,
      x,
      y,
      width,
      height,
      value,
      format,
      displayText,
      isEditing: false,
    },
    format,
    context.textMeasurer,
    {
      hasHyperlink: false,
      isCutCell: false,
      theme: OFFICE_THEME,
      textMeasurer: context.textMeasurer,
      overflowResult,
    },
  );

  ctx.restore();
}

export function calculatePrintCellOverflow(
  cell: {
    readonly row: number;
    readonly col: number;
    readonly value: unknown;
    readonly format: CellFormat | undefined;
    readonly x: number;
    readonly width: number;
    readonly textWidth: number;
  },
  context: PrintCellRenderContext,
): OverflowResult | null {
  const { row, col, value, format, x, width, textWidth } = cell;
  if (canValueOverflow(value) && textWidth > width) {
    return calculateTextOverflow({
      row,
      col,
      cellX: x,
      cellWidth: width,
      textWidth,
      alignment: mapHorizontalAlign(format?.horizontalAlign, value),
      wrapText: format?.wrapText === true,
      shrinkToFit: format?.shrinkToFit === true,
      positionIndex: context.positionIndex,
      mergeIndex: context.mergeIndex,
      isCellEmpty: context.isCellEmpty,
      maxCol: context.maxCol,
    });
  }

  if (textWidth > width && !canValueOverflow(value)) {
    return { renderX: x, renderWidth: width, isClipped: true };
  }

  return null;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}
