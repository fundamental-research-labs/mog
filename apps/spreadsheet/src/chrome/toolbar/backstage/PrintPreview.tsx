/**
 * PrintPreview Component
 *
 * Canvas-based print preview that renders spreadsheet pages as they will appear
 * when printed. Supports page navigation, zoom controls, and margin visualization.
 *
 * Architecture:
 * - Uses PaginationEngine (via printHandler) for page layout calculation
 * - Renders cell content using the same cell style adapters as the main grid
 * - Page navigation state is local React state (not UIStore per architecture)
 * - Margin drag updates dispatch through the Unified Action System
 * - Data access via Workbook/Worksheet API (viewport sync reads)
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ITableDataProvider,
  PageInfo,
  PageLayoutResult,
  PageSetup,
  PrintArea,
  PrintOptions,
} from '@mog/print-export';
import { inchesToPixels, PAPER_SIZES, printHandler } from '@mog/print-export';
import type { CellData, CellFormat, PrintSettings, SheetId } from '@mog-sdk/contracts/core';
import { getUsedRange } from '../../../infra/utils';

import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';

import {
  createCanvasTextMeasurer,
  createPrintMergeIndex,
  createPrintPositionIndex,
  drawPrintCell,
  type PrintCellRenderContext,
} from './print-preview-cell-rendering';
import { useSpreadsheetDisplayMode } from '../../../hooks/view/use-display-mode';

// =============================================================================
// CSS Custom Property Helper
// =============================================================================

const getColor = (varName: string, fallback: string) => {
  if (typeof document !== 'undefined') {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  }
  return fallback;
};

// =============================================================================
// Types
// =============================================================================

export interface PrintPreviewProps {
  /** Workbook API for data access */
  workbook: Workbook;
  /** Sheet ID to preview */
  sheetId: SheetId;
  /** Print settings */
  printSettings: PrintSettings;
  /** Called when zoom level changes */
  onZoomChange?: (zoom: number) => void;
  /** Called when page changes */
  onPageChange?: (page: number, totalPages: number) => void;
  /** Called when margins are changed (for D4 drag feature) */
  onMarginChange?: (margin: 'top' | 'bottom' | 'left' | 'right', newValue: number) => void;
}

export interface PrintPreviewState {
  currentPage: number;
  totalPages: number;
  zoom: number;
  layout: PageLayoutResult | null;
}

// =============================================================================
// Worksheet Data Provider Adapter
// =============================================================================

/**
 * Adapter that implements ITableDataProvider using the Worksheet API.
 * Allows PaginationEngine to work with viewport-backed sync data.
 */
async function createWorksheetDataProvider(ws: Worksheet): Promise<ITableDataProvider> {
  return {
    getCellData(_sid: string, row: number, col: number): CellData | undefined {
      // Use ViewportReader for sync cell data access in print preview
      const cell = ws.viewport.getCellData(row, col);
      if (!cell) return undefined;

      return {
        value: (cell.value ?? null) as CellData['value'],
        format: (cell.format ?? undefined) as CellFormat | undefined,
      };
    },

    getCellsInRange(
      _sid: string,
      range: { startRow: number; startCol: number; endRow: number; endCol: number },
    ): Array<{ row: number; col: number; data: CellData }> {
      const results: Array<{ row: number; col: number; data: CellData }> = [];

      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let col = range.startCol; col <= range.endCol; col++) {
          const cell = ws.viewport.getCellData(row, col);
          if (!cell) continue;
          const data: CellData = {
            value: (cell.value ?? null) as CellData['value'],
            format: (cell.format ?? undefined) as CellFormat | undefined,
          };
          if (data.value !== null || data.format) {
            results.push({ row, col, data });
          }
        }
      }

      return results;
    },

    getUsedRange(
      _sid: string,
    ): { startRow: number; startCol: number; endRow: number; endCol: number } | undefined {
      // Create a sync getter using ViewportReader
      const getCellValue = (row: number, col: number) => {
        const cell = ws.viewport.getCellData(row, col);
        return cell?.value ?? undefined;
      };
      const usedRange = getUsedRange(getCellValue, 1000, 100);
      return usedRange ?? undefined;
    },

    getColumnWidth(_sid: string, col: number): number {
      // Use viewport dimension (sync) with fallback to default column width
      const dim = ws.viewport.getColDimension(col);
      return dim?.width ?? 64;
    },

    getRowHeight(_sid: string, row: number): number {
      // Use viewport dimension (sync) with fallback to default row height
      const dim = ws.viewport.getRowDimension(row);
      return dim?.height ?? 20;
    },

    async getSheetName(_sid: string): Promise<string> {
      return ws.getName();
    },
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Map OOXML paper size code to print-export PaperSize string */
function ooxmlPaperSizeToString(code: number | null): 'letter' | 'legal' | 'a4' | 'a3' | 'custom' {
  switch (code) {
    case 1:
      return 'letter';
    case 5:
      return 'legal';
    case 9:
      return 'a4';
    case 8:
      return 'a3';
    default:
      return 'letter';
  }
}

/** Default margins (Excel defaults) */
const DEFAULT_MARGINS = { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7 };

/**
 * Convert PrintSettings to PrintOptions
 */
function settingsToPrintOptions(settings: PrintSettings): PrintOptions {
  const margins = settings.margins
    ? {
        top: settings.margins.top,
        right: settings.margins.right,
        bottom: settings.margins.bottom,
        left: settings.margins.left,
      }
    : DEFAULT_MARGINS;

  return {
    paperSize: ooxmlPaperSizeToString(settings.paperSize),
    orientation: (settings.orientation as 'portrait' | 'landscape') ?? 'portrait',
    margins,
    scale: (settings.scale ?? 100) / 100, // Convert percentage to decimal
    fitTo:
      settings.fitToWidth != null || settings.fitToHeight != null
        ? { width: settings.fitToWidth ?? undefined, height: settings.fitToHeight ?? undefined }
        : undefined,
    showGridlines: settings.gridlines,
    showHeaders: settings.headings,
    center: {
      horizontal: settings.hCentered,
      vertical: settings.vCentered,
    },
  };
}

/**
 * Convert PrintSettings to PageSetup
 */
function settingsToPageSetup(settings: PrintSettings): PageSetup {
  const hf = settings.headerFooter;
  return {
    header: hf?.oddHeader ? { center: hf.oddHeader } : undefined,
    footer: hf?.oddFooter ? { center: hf.oddFooter } : undefined,
    differentFirstPage: hf?.differentFirst,
    firstPageHeader: hf?.firstHeader ? { center: hf.firstHeader } : undefined,
    firstPageFooter: hf?.firstFooter ? { center: hf.firstFooter } : undefined,
    differentOddEven: hf?.differentOddEven,
  };
}

/**
 * Get page dimensions in pixels
 */
function getPageDimensions(settings: PrintSettings): { width: number; height: number } {
  let width: number;
  let height: number;

  // Convert OOXML paper size code to string for PAPER_SIZES lookup
  const paperSizeStr = ooxmlPaperSizeToString(settings.paperSize);
  const size = PAPER_SIZES[paperSizeStr as keyof typeof PAPER_SIZES] ?? PAPER_SIZES.letter;
  width = inchesToPixels(size.width);
  height = inchesToPixels(size.height);

  // Swap for landscape
  if (settings.orientation === 'landscape') {
    [width, height] = [height, width];
  }

  return { width, height };
}

// =============================================================================
// PrintPreview Component
// =============================================================================

export function PrintPreview({
  workbook,
  sheetId,
  printSettings,
  onZoomChange,
  onPageChange,
}: PrintPreviewProps) {
  // Unified Workbook API
  const wb = workbook;

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Local state (per architecture - page navigation is local state)
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const { effectiveScheme } = useSpreadsheetDisplayMode();

  // Calculate layout using PaginationEngine (async data provider)
  const [layout, setLayout] = useState<PageLayoutResult | null>(null);

  useEffect(() => {
    void (async () => {
      const ws = wb.getSheetById(sheetId);
      const dataProvider = await createWorksheetDataProvider(ws);
      const printOptions = settingsToPrintOptions(printSettings);
      const pageSetup = settingsToPageSetup(printSettings);
      const area: PrintArea = { sheetId };

      const result = await printHandler.calculateLayoutWithEngine(
        dataProvider,
        printOptions,
        pageSetup,
        area,
      );
      setLayout(result);
    })();
  }, [wb, sheetId, printSettings]);

  const totalPages = layout?.pageCount ?? 0;

  // Notify parent of page change
  useEffect(() => {
    onPageChange?.(currentPage, totalPages);
  }, [currentPage, totalPages, onPageChange]);

  // Notify parent of zoom change
  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  // Ensure currentPage is valid
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    } else if (currentPage < 1 && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Get page dimensions
  const pageDimensions = useMemo(() => getPageDimensions(printSettings), [printSettings]);

  // Render the preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || totalPages === 0) return;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    // Get current page info
    const pageInfo = layout?.pages[currentPage - 1];
    if (!pageInfo) return;

    // Calculate scaled dimensions
    const scale = zoom / 100;
    const scaledWidth = pageDimensions.width * scale;
    const scaledHeight = pageDimensions.height * scale;

    // Set canvas size (account for device pixel ratio)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = scaledWidth * dpr;
    canvas.height = scaledHeight * dpr;
    canvas.style.width = `${scaledWidth}px`;
    canvas.style.height = `${scaledHeight}px`;

    // Scale for DPR
    ctx2d.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    // Clear and draw page background
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillRect(0, 0, pageDimensions.width, pageDimensions.height);

    // Draw page shadow/border
    ctx2d.strokeStyle = '#cccccc';
    ctx2d.lineWidth = 1 / scale;
    ctx2d.strokeRect(0, 0, pageDimensions.width, pageDimensions.height);

    // Draw margins
    drawMargins(ctx2d, printSettings, pageDimensions);

    // Draw cell content (async for Rust compute bridge formatting)
    (async () => {
      await drawPageContent(ctx2d, sheetId, pageInfo, printSettings, pageDimensions, wb);
      drawHeaderFooter(ctx2d, printSettings, pageInfo, totalPages, pageDimensions);
    })();
  }, [wb, sheetId, printSettings, currentPage, zoom, layout, totalPages, pageDimensions]);

  // Navigation handlers
  const handlePrevPage = useCallback(() => {
    setCurrentPage((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const handlePageInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value) && value >= 1 && value <= totalPages) {
        setCurrentPage(value);
      }
    },
    [totalPages],
  );

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(200, z + 25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(25, z - 25));
  }, []);

  const handleZoomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value >= 25 && value <= 200) {
      setZoom(value);
    }
  }, []);

  // Empty state
  if (totalPages === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-ss-surface-tertiary">
        <div className="text-ss-text-secondary">
          No content to preview. The sheet appears to be empty.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-ss-surface-active">
      {/* Preview controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-ss-surface border-b border-ss-border">
        {/* Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="px-2 py-1 text-body border rounded hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div className="flex items-center gap-1 text-body">
            <span>Page</span>
            <input
              type="number"
              value={currentPage}
              onChange={handlePageInput}
              min={1}
              max={totalPages}
              className="w-12 px-1 py-0.5 text-center border rounded"
              aria-label="Current page"
            />
            <span>of {totalPages}</span>
          </div>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            className="px-2 py-1 text-body border rounded hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomOut}
            disabled={zoom <= 25}
            className="px-2 py-1 text-body border rounded hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>

          <div className="flex items-center gap-1 text-body">
            <input
              type="range"
              value={zoom}
              onChange={handleZoomChange}
              min={25}
              max={200}
              step={25}
              className="w-24"
              aria-label="Zoom level"
            />
            <span className="w-12 text-right">{zoom}%</span>
          </div>

          <button
            onClick={handleZoomIn}
            disabled={zoom >= 200}
            className="px-2 py-1 text-body border rounded hover:bg-ss-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>
      {effectiveScheme === 'dark' && (
        <div
          data-testid="print-preview-light-output-indicator"
          className="px-4 py-1 text-hint bg-ss-info-bg text-ss-info-text border-b border-ss-border"
        >
          Print and PDF output use light paper for default cells.
        </div>
      )}

      {/* Canvas container */}
      <div className="flex-1 overflow-auto p-8 flex items-start justify-center">
        <div
          className="shadow-ss-lg"
          style={{
            // Drop shadow to make it look like paper
            boxShadow: 'var(--shadow-ss-lg)',
          }}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Drawing Functions
// =============================================================================

/**
 * Draw margin guidelines on the page
 */
function drawMargins(
  ctx: CanvasRenderingContext2D,
  settings: PrintSettings,
  pageDimensions: { width: number; height: number },
): void {
  const margins = settings.margins ?? {
    top: 0.75,
    bottom: 0.75,
    left: 0.7,
    right: 0.7,
    header: 0.3,
    footer: 0.3,
  };

  const leftPx = inchesToPixels(margins.left);
  const rightPx = pageDimensions.width - inchesToPixels(margins.right);
  const topPx = inchesToPixels(margins.top);
  const bottomPx = pageDimensions.height - inchesToPixels(margins.bottom);

  ctx.save();
  ctx.strokeStyle = getColor('--color-ss-border', '#e0e0e0');
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 0.5;

  // Left margin
  ctx.beginPath();
  ctx.moveTo(leftPx, 0);
  ctx.lineTo(leftPx, pageDimensions.height);
  ctx.stroke();

  // Right margin
  ctx.beginPath();
  ctx.moveTo(rightPx, 0);
  ctx.lineTo(rightPx, pageDimensions.height);
  ctx.stroke();

  // Top margin
  ctx.beginPath();
  ctx.moveTo(0, topPx);
  ctx.lineTo(pageDimensions.width, topPx);
  ctx.stroke();

  // Bottom margin
  ctx.beginPath();
  ctx.moveTo(0, bottomPx);
  ctx.lineTo(pageDimensions.width, bottomPx);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw the cell content for a specific page
 */
async function drawPageContent(
  ctx2d: CanvasRenderingContext2D,
  sheetId: SheetId,
  pageInfo: PageInfo,
  settings: PrintSettings,
  pageDimensions: { width: number; height: number },
  wb: Workbook,
): Promise<void> {
  const margins = settings.margins ?? {
    top: 0.75,
    bottom: 0.75,
    left: 0.7,
    right: 0.7,
    header: 0.3,
    footer: 0.3,
  };
  const [startRow, endRow] = pageInfo.rowRange;
  const [startCol, endCol] = pageInfo.colRange;

  const leftPx = inchesToPixels(margins.left);
  const topPx = inchesToPixels(margins.top);
  const rightPx = pageDimensions.width - inchesToPixels(margins.right);
  const bottomPx = pageDimensions.height - inchesToPixels(margins.bottom);

  const printableWidth = rightPx - leftPx;
  const printableHeight = bottomPx - topPx;

  // Calculate scale factor if content doesn't fit
  const ws = wb.getSheetById(sheetId);
  const colWidthPairs = await ws.layout.getColWidthsBatch(startCol, endCol);
  const rowHeightPairs = await ws.layout.getRowHeightsBatch(startRow, endRow);

  // Build lookup maps from batch results
  const colWidthMap = new Map<number, number>(colWidthPairs);
  const rowHeightMap = new Map<number, number>(rowHeightPairs);

  let totalWidth = 0;
  let totalHeight = 0;

  for (let col = startCol; col <= endCol; col++) {
    totalWidth += colWidthMap.get(col) ?? 64;
  }
  for (let row = startRow; row <= endRow; row++) {
    totalHeight += rowHeightMap.get(row) ?? 20;
  }

  const scaleX = Math.min(1, printableWidth / totalWidth);
  const scaleY = Math.min(1, printableHeight / totalHeight);
  const contentScale = Math.min(scaleX, scaleY) * ((settings.scale ?? 100) / 100);

  // Save context and apply transforms
  ctx2d.save();
  ctx2d.translate(leftPx, topPx);
  ctx2d.scale(contentScale, contentScale);

  // Clip to printable area
  ctx2d.beginPath();
  ctx2d.rect(0, 0, printableWidth / contentScale, printableHeight / contentScale);
  ctx2d.clip();

  // Draw gridlines if enabled (pass pre-fetched dimension maps)
  if (settings.gridlines) {
    drawGridlines(ctx2d, startRow, endRow, startCol, endCol, colWidthMap, rowHeightMap);
  }

  const [hiddenColumns, mergedRegions] = await Promise.all([
    ws.layout.getHiddenColumnsBitmap().catch(() => new Set<number>()),
    ws.structure.getMergedRegions().catch(() => []),
  ]);
  const positionIndex = createPrintPositionIndex(
    startRow,
    endRow,
    startCol,
    endCol,
    rowHeightMap,
    colWidthMap,
    hiddenColumns,
  );
  const mergeIndex = createPrintMergeIndex(mergedRegions);

  const rawEntries = await Promise.all(
    Array.from({ length: (endRow - startRow + 1) * (endCol - startCol + 1) }, async (_, idx) => {
      const row = startRow + Math.floor(idx / (endCol - startCol + 1));
      const col = startCol + (idx % (endCol - startCol + 1));
      return [`${row},${col}`, row, col, await ws.getRawCellData(row, col)] as const;
    }),
  );
  const rawDataMap = new Map(rawEntries.map(([key, _row, _col, rawData]) => [key, rawData]));
  const isCellEmpty = (row: number, col: number) => {
    const rawData = rawDataMap.get(`${row},${col}`);
    return (
      !rawData || rawData.value === null || rawData.value === undefined || rawData.value === ''
    );
  };
  const textMeasurer = createCanvasTextMeasurer(ctx2d);
  const renderContext: PrintCellRenderContext = {
    positionIndex,
    mergeIndex,
    isCellEmpty,
    maxCol: endCol,
    textMeasurer,
  };

  // Pre-compute formatted values via Rust
  const formatEntries: Array<{ value: { type: string; value?: unknown }; formatCode: string }> = [];
  const cellKeys: string[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const rawData = rawDataMap.get(`${row},${col}`);
      if (
        rawData &&
        rawData.value !== null &&
        rawData.value !== undefined &&
        rawData.value !== ''
      ) {
        formatEntries.push({
          value: toFormatValue(rawData.value),
          formatCode: rawData.format?.numberFormat || 'General',
        });
        cellKeys.push(`${row},${col}`);
      }
    }
  }
  const formattedValues = formatEntries.length > 0 ? await ws.formatValues(formatEntries) : [];
  const formattedMap = new Map<string, string>();
  cellKeys.forEach((key, i) => formattedMap.set(key, formattedValues[i]));

  // Draw cells (using pre-fetched dimension maps)
  let currentY = 0;
  for (let row = startRow; row <= endRow; row++) {
    const rowHeight = rowHeightMap.get(row) ?? 20;
    let currentX = 0;

    for (let col = startCol; col <= endCol; col++) {
      const colWidth = colWidthMap.get(col) ?? 64;

      // Get cell data via unified Worksheet API
      const rawData = rawDataMap.get(`${row},${col}`);

      if (
        rawData &&
        rawData.value !== null &&
        rawData.value !== undefined &&
        rawData.value !== ''
      ) {
        const preFormatted = formattedMap.get(`${row},${col}`);
        drawPrintCell(
          ctx2d,
          {
            row,
            col,
            value: rawData.value,
            format: rawData.format,
            x: currentX,
            y: currentY,
            width: colWidth,
            height: rowHeight,
            preFormatted,
          },
          renderContext,
        );
      }

      currentX += colWidth;
    }

    currentY += rowHeight;
  }

  ctx2d.restore();
}

/**
 * Draw gridlines for the page content
 */
function drawGridlines(
  ctx2d: CanvasRenderingContext2D,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  colWidthMap: Map<number, number>,
  rowHeightMap: Map<number, number>,
): void {
  ctx2d.save();
  ctx2d.strokeStyle = getColor('--color-ss-border', '#d0d0d0');
  ctx2d.lineWidth = 0.5;

  // Calculate total width and height using pre-fetched dimension maps
  let totalWidth = 0;
  let totalHeight = 0;
  const colWidths: number[] = [];
  const rowHeights: number[] = [];

  for (let col = startCol; col <= endCol; col++) {
    const w = colWidthMap.get(col) ?? 64;
    colWidths.push(w);
    totalWidth += w;
  }
  for (let row = startRow; row <= endRow; row++) {
    const h = rowHeightMap.get(row) ?? 20;
    rowHeights.push(h);
    totalHeight += h;
  }

  // Draw vertical lines
  let x = 0;
  for (const w of colWidths) {
    ctx2d.beginPath();
    ctx2d.moveTo(x, 0);
    ctx2d.lineTo(x, totalHeight);
    ctx2d.stroke();
    x += w;
  }
  // Right border
  ctx2d.beginPath();
  ctx2d.moveTo(x, 0);
  ctx2d.lineTo(x, totalHeight);
  ctx2d.stroke();

  // Draw horizontal lines
  let y = 0;
  for (const h of rowHeights) {
    ctx2d.beginPath();
    ctx2d.moveTo(0, y);
    ctx2d.lineTo(totalWidth, y);
    ctx2d.stroke();
    y += h;
  }
  // Bottom border
  ctx2d.beginPath();
  ctx2d.moveTo(0, y);
  ctx2d.lineTo(totalWidth, y);
  ctx2d.stroke();

  ctx2d.restore();
}

/** Convert a JS value to the Rust CellValue wire format */
function toFormatValue(value: unknown): { type: string; value?: unknown } {
  if (value === null || value === undefined) return { type: 'Null' };
  if (typeof value === 'number') return { type: 'Number', value };
  if (typeof value === 'boolean') return { type: 'Boolean', value };
  if (typeof value === 'string') return { type: 'Text', value };
  return { type: 'Text', value: String(value) };
}

/**
 * Draw header and footer on the page
 */
function drawHeaderFooter(
  ctx2d: CanvasRenderingContext2D,
  settings: PrintSettings,
  pageInfo: PageInfo,
  totalPages: number,
  pageDimensions: { width: number; height: number },
): void {
  const margins = settings.margins ?? {
    top: 0.75,
    bottom: 0.75,
    left: 0.7,
    right: 0.7,
    header: 0.3,
    footer: 0.3,
  };
  const hf = settings.headerFooter;

  ctx2d.save();
  ctx2d.font = '10px Arial, sans-serif';
  ctx2d.fillStyle = getColor('--color-ss-text-secondary', '#666666');

  const leftPx = inchesToPixels(margins.left);
  const rightPx = pageDimensions.width - inchesToPixels(margins.right);
  const centerX = (leftPx + rightPx) / 2;

  // Header position (halfway between top and margin)
  const headerY = inchesToPixels(margins.top) / 2;

  // Footer position (halfway between bottom margin and page bottom)
  const footerY = pageDimensions.height - inchesToPixels(margins.bottom) / 2;

  // Render header (oddHeader is the default header string)
  if (hf?.oddHeader) {
    const header = { center: hf.oddHeader };
    const renderedHeader = renderHeaderFooterSection(header, pageInfo.pageNumber, totalPages, '');

    if (renderedHeader.left) {
      ctx2d.textAlign = 'left';
      ctx2d.fillText(renderedHeader.left, leftPx, headerY);
    }
    if (renderedHeader.center) {
      ctx2d.textAlign = 'center';
      ctx2d.fillText(renderedHeader.center, centerX, headerY);
    }
    if (renderedHeader.right) {
      ctx2d.textAlign = 'right';
      ctx2d.fillText(renderedHeader.right, rightPx, headerY);
    }
  }

  // Render footer (oddFooter is the default footer string)
  if (hf?.oddFooter) {
    const footer = { center: hf.oddFooter };
    const renderedFooter = renderHeaderFooterSection(footer, pageInfo.pageNumber, totalPages, '');

    if (renderedFooter.left) {
      ctx2d.textAlign = 'left';
      ctx2d.fillText(renderedFooter.left, leftPx, footerY);
    }
    if (renderedFooter.center) {
      ctx2d.textAlign = 'center';
      ctx2d.fillText(renderedFooter.center, centerX, footerY);
    }
    if (renderedFooter.right) {
      ctx2d.textAlign = 'right';
      ctx2d.fillText(renderedFooter.right, rightPx, footerY);
    }
  }

  ctx2d.restore();
}

/**
 * Render header/footer section with placeholders replaced
 */
function renderHeaderFooterSection(
  section: { left?: string; center?: string; right?: string },
  pageNumber: number,
  totalPages: number,
  sheetName: string,
): { left?: string; center?: string; right?: string } {
  const replacePlaceholders = (text?: string): string | undefined => {
    if (!text) return undefined;

    return text
      .replace(/&\[Page\]/gi, String(pageNumber))
      .replace(/&\[Pages\]/gi, String(totalPages))
      .replace(/&\[Sheet\]/gi, sheetName)
      .replace(/&\[Date\]/gi, new Date().toLocaleDateString())
      .replace(/&\[Time\]/gi, new Date().toLocaleTimeString());
  };

  return {
    left: replacePlaceholders(section.left),
    center: replacePlaceholders(section.center),
    right: replacePlaceholders(section.right),
  };
}

export default PrintPreview;
