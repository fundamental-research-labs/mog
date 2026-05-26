/**
 * SpreadsheetPdfExporter -- the top-level orchestrator for PDF export.
 *
 * Wires together the pagination engine, cell renderer, conditional formatting
 * renderer, sparkline renderer, chart/drawing/image renderers, and the
 * RenderBackend to produce a complete multi-page PDF export.
 *
 * The exporter is intentionally a thin orchestrator. All heavy lifting is
 * delegated to the existing renderer modules and the pdf-layout pagination
 * engine.
 *
 * Export flow:
 * 1. Determine which sheets to export
 * 2. For each sheet:
 *    a. Build a ContentMeasurer from the PdfDataProvider
 *    b. Compute PageSetupInput (from provider or defaults)
 *    c. Run PaginationEngine.calculateLayout() to get a PaginationPlan
 *    d. For each PageSlice in the plan:
 *       - backend.beginPage(width, height)
 *       - Apply scale transform
 *       - Render repeat rows/cols
 *       - Render cells using CellRenderer
 *       - Render floating objects (charts, drawings, images)
 *       - backend.endPage()
 * 3. Collect warnings and return PdfExportResult
 */

import type { RenderBackend } from '@mog/pdf-graphics';
import type {
  ContentMeasurer,
  MergedRegion,
  PageSetupInput,
  PaginationPlan,
} from '@mog/pdf-layout';
import { PaginationEngine } from '@mog/pdf-layout';

import type {
  BorderStyle,
  CellBounds,
  CellFormat,
  CellRenderData,
  RichTextSegment,
} from './cell-renderer';
import { CellRenderer } from './cell-renderer';
import type { CFResult } from './cf-renderer';
import { CFRenderer } from './cf-renderer';
import type { ChartInfo } from './chart-renderer';
import { ChartPdfRenderer } from './chart-renderer';
import type { DrawingInfo } from './drawing-pdf-renderer';
import { DrawingPdfRenderer } from './drawing-pdf-renderer';
import type { FontResolver } from './font-resolver';
import { DefaultFontResolver } from './font-resolver';
import type { ImageInfo } from './image-renderer';
import { ImagePdfRenderer } from './image-renderer';
import type { PageSlice as PositionPageSlice, PositionResolver } from './position-resolver';
import { DefaultPositionResolver } from './position-resolver';
import type { SparklineRenderData } from './sparkline-renderer';
import { SparklineRenderer } from './sparkline-renderer';

// ============================================================================
// Data Provider Interface
// ============================================================================

/**
 * Data provider interface -- supplies all spreadsheet data needed for export.
 *
 * The exporter pulls data through this interface rather than coupling to
 * any particular spreadsheet model. The bridge layer (kernel/shell)
 * implements this interface and translates from its internal representation.
 */
export interface PdfDataProvider {
  /** Get all sheet IDs in workbook order. */
  getSheetIds(): string[] | Promise<string[]>;

  /** Get the display name for a sheet. */
  getSheetName(sheetId: string): string | Promise<string>;

  /** Get cell data at a specific position. */
  getCellData(
    sheetId: string,
    row: number,
    col: number,
  ): CellDataInput | undefined | Promise<CellDataInput | undefined>;

  /** Get the height of a row in points. */
  getRowHeight(sheetId: string, row: number): number;

  /** Get the width of a column in points. */
  getColumnWidth(sheetId: string, col: number): number;

  /**
   * Get the bounding box of all non-empty content in the sheet.
   * Returns undefined if the sheet is completely empty.
   */
  getUsedRange(sheetId: string): UsedRange | undefined | Promise<UsedRange | undefined>;

  /** Get all merged regions in the sheet. */
  getMergedRegions(sheetId: string): MergedRegion[] | Promise<MergedRegion[]>;

  /** Whether a row is hidden. */
  isRowHidden(sheetId: string, row: number): boolean | Promise<boolean>;

  /** Whether a column is hidden. */
  isColHidden(sheetId: string, col: number): boolean | Promise<boolean>;

  /** Get all charts in the sheet. */
  getCharts(sheetId: string): ChartInfo[];

  /** Get all drawings in the sheet. */
  getDrawings(sheetId: string): DrawingInfo[];

  /** Get all floating images in the sheet. */
  getImages(sheetId: string): ImageInfo[];

  /** Get the evaluated CF result for a cell, if any. */
  getCFResult(sheetId: string, row: number, col: number): CFResult | undefined;

  /** Get sparkline data for a cell, if any. */
  getSparklineData(sheetId: string, row: number, col: number): SparklineRenderData | undefined;

  /** Get per-sheet page setup override (returns undefined to use defaults). */
  getPageSetup(sheetId: string): PageSetupInput | undefined;
}

// ============================================================================
// Supporting Types
// ============================================================================

/**
 * Cell data as provided by the data provider.
 * Closely mirrors CellRenderData + CellFormat but from the provider's perspective.
 */
export interface CellDataInput {
  /** Display value (already formatted by the number format engine). */
  displayValue: string;
  /** Value type for alignment heuristics. */
  valueType: 'string' | 'number' | 'boolean' | 'error' | 'date' | 'empty';
  /** Cell format. */
  format: CellFormatInput;
  /** Rich text segments (overrides displayValue if present). */
  richText?: RichTextSegment[];
  /** Whether the cell is a hyperlink. */
  hyperlink?: boolean;
  /** Whether the cell has a comment. */
  comment?: boolean;
}

/**
 * Cell format as provided by the data provider.
 * Maps directly to the CellFormat type used by CellRenderer.
 */
export interface CellFormatInput {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  strikethrough?: boolean;
  fontColor?: [number, number, number];
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapText?: boolean;
  shrinkToFit?: boolean;
  textRotation?: number;
  indent?: number;
  backgroundColor?: [number, number, number];
  patternType?: string;
  patternForeColor?: [number, number, number];
  patternBackColor?: [number, number, number];
  gradientFill?: {
    type: 'linear' | 'radial';
    angle?: number;
    stops: { position: number; color: [number, number, number] }[];
  };
  borderTop?: BorderStyle;
  borderRight?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderDiagonalUp?: BorderStyle;
  borderDiagonalDown?: BorderStyle;
  isHyperlink?: boolean;
}

/**
 * Used range from the data provider.
 */
export interface UsedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ============================================================================
// Export Result
// ============================================================================

/**
 * PDF export result.
 */
export interface PdfExportResult {
  /** Total number of pages generated across all sheets. */
  pageCount: number;
  /** Warnings generated during export. */
  warnings: PdfWarning[];
}

/**
 * Warning types generated during export.
 */
export type PdfWarning =
  | { type: 'font_fallback'; requested: string; used: string }
  | { type: 'image_unsupported'; format: string; location: string }
  | { type: 'merge_overflow'; row: number; col: number }
  | { type: 'fit_unreadable'; requestedScale: number; actualScale: number }
  | { type: 'empty_sheet'; sheetId: string; sheetName: string }
  | { type: 'layout_warning'; message: string };

// ============================================================================
// Export Options
// ============================================================================

/**
 * Options for the export operation.
 */
export interface PdfExportOptions {
  /** Which sheets to export (default: all sheets from the data provider). */
  sheetIds?: string[];
  /** Progress callback: (currentPage, totalPages). */
  onProgress?: (current: number, total: number) => void;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Custom font resolver (default: DefaultFontResolver). */
  fontResolver?: FontResolver;
  /** Default page setup (used when data provider returns undefined). */
  defaultPageSetup?: PageSetupInput;
}

// ============================================================================
// Default Page Setup
// ============================================================================

/** Default page margins (in points): 0.75in top/bottom, 0.7in left/right. */
const DEFAULT_MARGINS = {
  top: 54, // 0.75 * 72
  bottom: 54,
  left: 50.4, // 0.7 * 72
  right: 50.4,
  header: 18, // 0.25 * 72
  footer: 18,
};

/** Default page setup: Letter portrait, 100% scale, standard margins. */
const DEFAULT_PAGE_SETUP: PageSetupInput = {
  pageWidth: 612, // 8.5 * 72
  pageHeight: 792, // 11 * 72
  margins: DEFAULT_MARGINS,
  orientation: 'portrait',
  scale: 1.0,
};

// ============================================================================
// SpreadsheetPdfExporter
// ============================================================================

/**
 * The main exporter class.
 *
 * Usage:
 *   const exporter = new SpreadsheetPdfExporter(dataProvider, backend);
 *   const result = await exporter.export();
 *   // PDF bytes are now in the backend (flushed via endPage calls)
 */
export class SpreadsheetPdfExporter {
  private paginationEngine: PaginationEngine;

  constructor(
    private dataProvider: PdfDataProvider,
    private backend: RenderBackend,
  ) {
    this.paginationEngine = new PaginationEngine();
  }

  /**
   * Export the spreadsheet to PDF.
   *
   * This drives the entire export pipeline:
   * 1. Determine which sheets to export
   * 2. Paginate each sheet
   * 3. Render pages to the backend
   * 4. Return results with warnings
   */
  async export(options?: PdfExportOptions): Promise<PdfExportResult> {
    const warnings: PdfWarning[] = [];

    // Determine sheets to export
    const sheetIds = options?.sheetIds ?? (await this.dataProvider.getSheetIds());

    // Set up renderers
    const fontResolver = options?.fontResolver ?? new DefaultFontResolver();
    const cellRenderer = new CellRenderer(this.backend, fontResolver);
    const cfRenderer = new CFRenderer(this.backend, fontResolver);
    const sparklineRenderer = new SparklineRenderer(this.backend);
    const chartRenderer = new ChartPdfRenderer(this.backend);
    const drawingRenderer = new DrawingPdfRenderer(this.backend);
    const imageRenderer = new ImagePdfRenderer(this.backend);

    // Step 1: calculate pagination for all sheets to know total pages
    const sheetPlans: Array<{
      sheetId: string;
      plan: PaginationPlan;
      pageSetup: PageSetupInput;
      usedRange: UsedRange;
    }> = [];

    for (const sheetId of sheetIds) {
      const usedRange = await this.dataProvider.getUsedRange(sheetId);
      if (!usedRange) {
        warnings.push({
          type: 'empty_sheet',
          sheetId,
          sheetName: await this.dataProvider.getSheetName(sheetId),
        });
        continue;
      }

      const pageSetup = this.resolvePageSetup(sheetId, options?.defaultPageSetup);

      // Ensure the page setup has a printArea covering the used range
      const effectiveSetup: PageSetupInput = {
        ...pageSetup,
        printArea: pageSetup.printArea ?? {
          startRow: usedRange.startRow,
          startCol: usedRange.startCol,
          endRow: usedRange.endRow,
          endCol: usedRange.endCol,
        },
      };

      // Build a ContentMeasurer that bridges the data provider
      const measurer = await this.buildContentMeasurer(sheetId, usedRange);

      const plan = this.paginationEngine.calculateLayout(measurer, effectiveSetup);

      // Convert layout warnings
      for (const w of plan.warnings) {
        warnings.push({ type: 'layout_warning', message: w.message });
      }

      sheetPlans.push({ sheetId, plan, pageSetup: effectiveSetup, usedRange });
    }

    // Calculate total pages
    let totalPages = 0;
    for (const sp of sheetPlans) {
      totalPages += sp.plan.totalPages;
    }

    // Step 2: render all pages
    let currentPage = 0;

    for (const { sheetId, plan, pageSetup, usedRange } of sheetPlans) {
      // Check cancellation
      if (options?.signal?.aborted) {
        break;
      }

      // Gather floating objects for this sheet
      const charts = this.dataProvider.getCharts(sheetId);
      const drawings = this.dataProvider.getDrawings(sheetId);
      const images = this.dataProvider.getImages(sheetId);
      const mergedRegions = await this.dataProvider.getMergedRegions(sheetId);

      // Build position resolver for floating objects
      const positionResolver = this.buildPositionResolver(sheetId, usedRange, plan, pageSetup);

      for (const pageSlice of plan.pages) {
        // Check cancellation
        if (options?.signal?.aborted) {
          break;
        }

        // Begin page
        this.backend.beginPage(pageSetup.pageWidth, pageSetup.pageHeight);

        // Apply margins offset
        this.backend.save();
        this.backend.translate(pageSetup.margins.left, pageSetup.margins.top);

        // Apply scale
        if (plan.scale !== 1.0) {
          this.backend.scale(plan.scale, plan.scale);
        }

        // Apply content offset (for centering)
        if (pageSlice.contentOffset.x !== 0 || pageSlice.contentOffset.y !== 0) {
          this.backend.translate(pageSlice.contentOffset.x, pageSlice.contentOffset.y);
        }

        // Track Y offset for rendering
        let yOffset = 0;

        // Render repeat rows at top of page (if applicable)
        if (pageSlice.repeatRows) {
          const [rStart, rEnd] = pageSlice.repeatRows;
          yOffset += await this.renderRowRange(
            sheetId,
            rStart,
            rEnd,
            pageSlice.colRange[0],
            pageSlice.colRange[1],
            0,
            yOffset,
            mergedRegions,
            cellRenderer,
            cfRenderer,
            sparklineRenderer,
          );
        }

        // Render repeat cols -- we handle this as part of the cell grid
        // by rendering the repeat column cells for the main row range
        let xOffset = 0;
        if (pageSlice.repeatCols) {
          const [cStart, cEnd] = pageSlice.repeatCols;
          xOffset += await this.renderColHeaders(
            sheetId,
            pageSlice.rowRange[0],
            pageSlice.rowRange[1],
            cStart,
            cEnd,
            0,
            yOffset,
            mergedRegions,
            cellRenderer,
            cfRenderer,
            sparklineRenderer,
          );
        }

        // Render the main cell grid
        await this.renderRowRange(
          sheetId,
          pageSlice.rowRange[0],
          pageSlice.rowRange[1],
          pageSlice.colRange[0],
          pageSlice.colRange[1],
          xOffset,
          yOffset,
          mergedRegions,
          cellRenderer,
          cfRenderer,
          sparklineRenderer,
        );

        // Render floating objects on this page
        const pageIndex = pageSlice.pageNumber - 1;
        chartRenderer.renderCharts(charts, positionResolver, pageIndex);
        drawingRenderer.renderDrawings(drawings, positionResolver, pageIndex);
        imageRenderer.renderImages(images, positionResolver, pageIndex);

        this.backend.restore();

        // End page
        await this.backend.endPage();

        currentPage++;
        options?.onProgress?.(currentPage, totalPages);
      }
    }

    return {
      pageCount: currentPage,
      warnings,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Resolve the page setup for a sheet, using the provider's override,
   * the caller's default, or the built-in default.
   */
  private resolvePageSetup(sheetId: string, callerDefault?: PageSetupInput): PageSetupInput {
    const providerSetup = this.dataProvider.getPageSetup(sheetId);
    if (providerSetup) return providerSetup;
    if (callerDefault) return callerDefault;
    return DEFAULT_PAGE_SETUP;
  }

  /**
   * Build a ContentMeasurer that reads from the data provider.
   *
   * Pre-caches async data (merged regions, hidden rows/cols) so the returned
   * measurer can satisfy the sync ContentMeasurer interface.
   */
  private async buildContentMeasurer(
    sheetId: string,
    usedRange: UsedRange,
  ): Promise<ContentMeasurer> {
    const provider = this.dataProvider;
    const mergedRegions = await provider.getMergedRegions(sheetId);

    // Pre-cache hidden state -- ContentMeasurer requires sync returns
    const hiddenRows = new Set<number>();
    const hiddenCols = new Set<number>();
    for (let r = usedRange.startRow; r <= usedRange.endRow; r++) {
      if (await provider.isRowHidden(sheetId, r)) hiddenRows.add(r);
    }
    for (let c = usedRange.startCol; c <= usedRange.endCol; c++) {
      if (await provider.isColHidden(sheetId, c)) hiddenCols.add(c);
    }

    return {
      getRowHeight: (row) => provider.getRowHeight(sheetId, row),
      getColumnWidth: (col) => provider.getColumnWidth(sheetId, col),
      getMergedRegions: () => mergedRegions,
      isRowHidden: (row) => hiddenRows.has(row),
      isColHidden: (col) => hiddenCols.has(col),
    };
  }

  /**
   * Build a PositionResolver for floating objects on a sheet.
   *
   * Translates the PaginationPlan's PageSlice[] into the position-resolver's
   * PageSlice format (which uses exclusive ranges and offsets).
   */
  private buildPositionResolver(
    sheetId: string,
    usedRange: UsedRange,
    plan: PaginationPlan,
    pageSetup: PageSetupInput,
  ): PositionResolver {
    // Collect row heights and column widths
    const rowHeights: number[] = [];
    const colWidths: number[] = [];

    for (let r = usedRange.startRow; r <= usedRange.endRow; r++) {
      rowHeights[r] = this.dataProvider.getRowHeight(sheetId, r);
    }
    for (let c = usedRange.startCol; c <= usedRange.endCol; c++) {
      colWidths[c] = this.dataProvider.getColumnWidth(sheetId, c);
    }

    // Convert PaginationPlan pages to position-resolver PageSlices
    const positionSlices: PositionPageSlice[] = plan.pages.map((page) => ({
      startRow: page.rowRange[0],
      endRow: page.rowRange[1] + 1, // Convert inclusive to exclusive
      startCol: page.colRange[0],
      endCol: page.colRange[1] + 1,
      offsetX: pageSetup.margins.left + page.contentOffset.x,
      offsetY: pageSetup.margins.top + page.contentOffset.y,
      pageIndex: page.pageNumber - 1,
    }));

    return new DefaultPositionResolver(rowHeights, colWidths, positionSlices);
  }

  /**
   * Render a range of rows x cols into the current page at the given offset.
   * Returns the total height rendered (sum of visible row heights).
   */
  private async renderRowRange(
    sheetId: string,
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number,
    xBase: number,
    yBase: number,
    mergedRegions: MergedRegion[],
    cellRenderer: CellRenderer,
    cfRenderer: CFRenderer,
    sparklineRenderer: SparklineRenderer,
  ): Promise<number> {
    let y = yBase;
    const renderedMerges = new Set<string>();

    for (let row = startRow; row <= endRow; row++) {
      if (await this.dataProvider.isRowHidden(sheetId, row)) continue;

      const rowHeight = this.dataProvider.getRowHeight(sheetId, row);
      let x = xBase;

      for (let col = startCol; col <= endCol; col++) {
        if (await this.dataProvider.isColHidden(sheetId, col)) continue;

        const colWidth = this.dataProvider.getColumnWidth(sheetId, col);

        // Check if this cell is part of a merged region
        const merge = this.findMerge(row, col, mergedRegions);

        if (merge) {
          // Only render the top-left cell of a merge
          if (merge.startRow !== row || merge.startCol !== col) {
            x += colWidth;
            continue;
          }

          // Check if we already rendered this merge on this page
          const mergeKey = `${merge.startRow},${merge.startCol}`;
          if (renderedMerges.has(mergeKey)) {
            x += colWidth;
            continue;
          }
          renderedMerges.add(mergeKey);

          // Calculate merged cell bounds
          const mergedBounds = await this.calculateMergedBounds(
            sheetId,
            merge,
            x,
            y,
            startCol,
            endCol,
            startRow,
            endRow,
          );

          await this.renderSingleCell(
            sheetId,
            row,
            col,
            mergedBounds,
            cellRenderer,
            cfRenderer,
            sparklineRenderer,
          );
        } else {
          // Normal (non-merged) cell
          const bounds: CellBounds = { x, y, width: colWidth, height: rowHeight };
          await this.renderSingleCell(
            sheetId,
            row,
            col,
            bounds,
            cellRenderer,
            cfRenderer,
            sparklineRenderer,
          );
        }

        x += colWidth;
      }

      y += rowHeight;
    }

    return y - yBase;
  }

  /**
   * Render repeat columns (the left-side repeated column headers).
   * Returns the total width rendered.
   */
  private async renderColHeaders(
    sheetId: string,
    startRow: number,
    endRow: number,
    repeatStartCol: number,
    repeatEndCol: number,
    xBase: number,
    yBase: number,
    mergedRegions: MergedRegion[],
    cellRenderer: CellRenderer,
    cfRenderer: CFRenderer,
    sparklineRenderer: SparklineRenderer,
  ): Promise<number> {
    let totalWidth = 0;
    for (let c = repeatStartCol; c <= repeatEndCol; c++) {
      if (!(await this.dataProvider.isColHidden(sheetId, c))) {
        totalWidth += this.dataProvider.getColumnWidth(sheetId, c);
      }
    }

    // Render the column cells for each row in the main range
    await this.renderRowRange(
      sheetId,
      startRow,
      endRow,
      repeatStartCol,
      repeatEndCol,
      xBase,
      yBase,
      mergedRegions,
      cellRenderer,
      cfRenderer,
      sparklineRenderer,
    );

    return totalWidth;
  }

  /**
   * Render a single cell with all its decorations.
   */
  private async renderSingleCell(
    sheetId: string,
    row: number,
    col: number,
    bounds: CellBounds,
    cellRenderer: CellRenderer,
    cfRenderer: CFRenderer,
    sparklineRenderer: SparklineRenderer,
  ): Promise<void> {
    const cellData = await this.dataProvider.getCellData(sheetId, row, col);

    // Build render data
    const renderData: CellRenderData = {
      displayValue: cellData?.displayValue ?? '',
      valueType: cellData?.valueType ?? 'empty',
      richText: cellData?.richText,
    };

    // Build format
    let format: CellFormat = cellData?.format ? this.toCellFormat(cellData) : {};

    // Apply conditional formatting style overrides BEFORE rendering cell
    // so the format reflects CF colors (including color scale as backgroundColor)
    const cfResult = this.dataProvider.getCFResult(sheetId, row, col);
    if (cfResult) {
      format = cfRenderer.applyCFOverrides(format, cfResult);
    }

    // Render the cell (background, content, borders)
    cellRenderer.renderCell(renderData, format, bounds);

    // Render CF visual overlays AFTER cell (on top of background)
    if (cfResult) {
      if (cfResult.dataBar) {
        cfRenderer.renderDataBar(cfResult.dataBar, bounds);
      }
      if (cfResult.iconSet) {
        cfRenderer.renderIcon(cfResult.iconSet, bounds);
      }
    }

    // Render sparkline on top of cell content if present
    const sparklineData = this.dataProvider.getSparklineData(sheetId, row, col);
    if (sparklineData) {
      sparklineRenderer.renderSparkline(sparklineData, bounds);
    }
  }

  /**
   * Convert CellDataInput to CellFormat for the renderer.
   */
  private toCellFormat(cellData: CellDataInput): CellFormat {
    const f = cellData.format;
    const result: CellFormat = { ...f } as CellFormat;

    // Overlay hyperlink flag
    if (cellData.hyperlink) {
      result.isHyperlink = true;
    }

    return result;
  }

  /**
   * Find a merged region that contains the given cell.
   */
  private findMerge(
    row: number,
    col: number,
    mergedRegions: MergedRegion[],
  ): MergedRegion | undefined {
    return mergedRegions.find(
      (m) => row >= m.startRow && row <= m.endRow && col >= m.startCol && col <= m.endCol,
    );
  }

  /**
   * Calculate the pixel bounds of a merged cell, clipped to the visible
   * area of the current page.
   */
  private async calculateMergedBounds(
    sheetId: string,
    merge: MergedRegion,
    cellX: number,
    cellY: number,
    visibleStartCol: number,
    visibleEndCol: number,
    visibleStartRow: number,
    visibleEndRow: number,
  ): Promise<CellBounds> {
    // Calculate width: sum of column widths for visible portion of merge
    let width = 0;
    const mergeStartCol = Math.max(merge.startCol, visibleStartCol);
    const mergeEndCol = Math.min(merge.endCol, visibleEndCol);
    for (let c = mergeStartCol; c <= mergeEndCol; c++) {
      if (!(await this.dataProvider.isColHidden(sheetId, c))) {
        width += this.dataProvider.getColumnWidth(sheetId, c);
      }
    }

    // Calculate height: sum of row heights for visible portion of merge
    let height = 0;
    const mergeStartRow = Math.max(merge.startRow, visibleStartRow);
    const mergeEndRow = Math.min(merge.endRow, visibleEndRow);
    for (let r = mergeStartRow; r <= mergeEndRow; r++) {
      if (!(await this.dataProvider.isRowHidden(sheetId, r))) {
        height += this.dataProvider.getRowHeight(sheetId, r);
      }
    }

    return { x: cellX, y: cellY, width, height };
  }
}
