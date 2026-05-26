/**
 * Pivot Table Renderer
 *
 * Renders pivot tables on the canvas as overlays.
 * Similar to chart overlay rendering but for pivot tables.
 *
 * Supports three layout forms (Excel-compatible):
 * - **Compact**: Single column for all row headers with indentation (default)
 * - **Outline**: Separate column per row field, no label repetition, subtotals at top
 * - **Tabular**: Separate column per row field, labels repeated on every row
 */

import { DEFAULT_CELL_STYLE } from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellValue } from '@mog-sdk/contracts/core';
import type {
  PivotColumnHeader,
  PivotRow,
  PivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';

// =============================================================================
// Layout Form Types
// =============================================================================

type LayoutForm = NonNullable<PivotTableLayout['layoutForm']>;

// =============================================================================
// Types
// =============================================================================

export interface PivotPosition {
  /** Anchor row in the grid (0-indexed) */
  anchorRow: number;
  /** Anchor column in the grid (0-indexed) */
  anchorCol: number;
  /** Width in cells */
  widthCells: number;
  /** Height in cells */
  heightCells: number;
}

export interface PivotRenderData {
  /** Pivot table configuration */
  config: PivotTableConfig;
  /** Computed result */
  result: PivotTableResult;
  /** Position in the grid */
  position: PivotPosition;
  /** Pixel bounds */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Whether the pivot is selected */
  isSelected?: boolean;
  /** Whether the pivot is being edited */
  isEditing?: boolean;
}

export interface PivotRendererConfig {
  /** Cell padding */
  padding: number;
  /** Header row height */
  headerHeight: number;
  /** Data row height */
  rowHeight: number;
  /** Minimum column width */
  minColumnWidth: number;
  /** Font size */
  fontSize: number;
  /** Font family */
  fontFamily: string;
  /** Colors */
  colors: {
    background: string;
    headerBackground: string;
    border: string;
    text: string;
    headerText: string;
    subtotalBackground: string;
    grandTotalBackground: string;
    selection: string;
    selectionBorder: string;
  };
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: PivotRendererConfig = {
  padding: 6,
  headerHeight: 24,
  rowHeight: 22,
  minColumnWidth: 80,
  fontSize: DEFAULT_CELL_STYLE.fontSize,
  fontFamily: DEFAULT_CELL_STYLE.fontFamily,
  colors: {
    background: '#ffffff',
    headerBackground: '#f8f9fa',
    border: '#dadce0',
    text: '#202124',
    headerText: '#5f6368',
    subtotalBackground: '#f1f3f4',
    grandTotalBackground: '#e8eaed',
    selection: 'rgba(33, 115, 70, 0.1)',
    selectionBorder: '#217346',
  },
};

// =============================================================================
// Pivot Table Renderer
// =============================================================================

/**
 * Render a pivot table on the canvas
 */
export function renderPivotTable(
  ctx: CanvasRenderingContext2D,
  data: PivotRenderData,
  config: Partial<PivotRendererConfig> = {},
): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const { bounds, result, isSelected, config: pivotConfig } = data;

  // Save context state
  ctx.save();

  // Clip to bounds
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();

  // Draw background
  ctx.fillStyle = cfg.colors.background;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Calculate layout (passes pivot config for layout form)
  const layout = calculateLayout(result, bounds, cfg, pivotConfig);

  // Draw column headers
  drawColumnHeaders(ctx, result.columnHeaders, layout, cfg);

  // Draw rows (layout-form-aware)
  drawRows(ctx, result.rows, layout, cfg);

  // Draw border
  ctx.strokeStyle = cfg.colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.x + 0.5, bounds.y + 0.5, bounds.width - 1, bounds.height - 1);

  // Draw selection indicator if selected
  if (isSelected) {
    ctx.strokeStyle = cfg.colors.selectionBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.x + 1, bounds.y + 1, bounds.width - 2, bounds.height - 2);
  }

  // Restore context state
  ctx.restore();
}

// =============================================================================
// Layout Calculation
// =============================================================================

interface PivotLayout {
  /** X position of content area */
  contentX: number;
  /** Y position of content area */
  contentY: number;
  /** Width of row header area (total for all row header columns) */
  rowHeaderWidth: number;
  /** Column widths for data columns */
  columnWidths: number[];
  /** Y positions for each row */
  rowYPositions: number[];
  /** Height of column header area */
  columnHeaderHeight: number;
  /** Layout form being used */
  layoutForm: LayoutForm;
  /** Number of row header columns (1 for compact, N for outline/tabular) */
  numRowHeaderColumns: number;
  /** Individual widths for row header columns (only used in outline/tabular) */
  rowHeaderColumnWidths: number[];
}

function calculateLayout(
  result: PivotTableResult,
  bounds: { x: number; y: number; width: number; height: number },
  cfg: PivotRendererConfig,
  pivotConfig?: PivotTableConfig,
): PivotLayout {
  const { columnHeaders, rows } = result;

  // Determine layout form from config (default to compact)
  const layoutForm: LayoutForm = pivotConfig?.layout?.layoutForm ?? 'compact';

  // Calculate column header height
  const columnHeaderHeight = (columnHeaders.length || 1) * cfg.headerHeight;

  // Determine number of row header columns based on layout form
  // For compact: 1 column with nested indentation
  // For outline/tabular: one column per row field
  const maxDepth = rows.length > 0 ? Math.max(...rows.map((r) => r.headers.length)) : 1;
  const numRowHeaderColumns = layoutForm === 'compact' ? 1 : maxDepth;

  // Calculate row header column widths
  let rowHeaderColumnWidths: number[];
  let rowHeaderWidth: number;

  if (layoutForm === 'compact') {
    // Compact form: single column with all headers concatenated
    rowHeaderWidth = Math.min(
      Math.max(
        cfg.minColumnWidth * 2,
        ...rows.map(
          (r) =>
            estimateTextWidth(r.headers.map((h) => formatValue(h.value)).join(' > '), cfg) +
            cfg.padding * 2 +
            r.depth * 16, // indent
        ),
      ),
      bounds.width * 0.4,
    );
    rowHeaderColumnWidths = [rowHeaderWidth];
  } else {
    // Outline/Tabular form: separate column per row field
    rowHeaderColumnWidths = [];
    for (let i = 0; i < numRowHeaderColumns; i++) {
      // Calculate max width needed for this header column
      const maxWidth = Math.max(
        cfg.minColumnWidth,
        ...rows
          .filter((r) => r.headers[i] !== undefined)
          .map(
            (r) => estimateTextWidth(formatValue(r.headers[i]?.value ?? ''), cfg) + cfg.padding * 2,
          ),
      );
      rowHeaderColumnWidths.push(Math.min(maxWidth, cfg.minColumnWidth * 2));
    }
    rowHeaderWidth = rowHeaderColumnWidths.reduce((a, b) => a + b, 0);
    // Cap total row header width
    if (rowHeaderWidth > bounds.width * 0.5) {
      const scale = (bounds.width * 0.5) / rowHeaderWidth;
      rowHeaderColumnWidths = rowHeaderColumnWidths.map((w) => w * scale);
      rowHeaderWidth = bounds.width * 0.5;
    }
  }

  // Calculate number of value columns
  const numValueCols = rows.length > 0 ? rows[0].values.length : 1;

  // Calculate column widths for value columns
  const availableWidth = bounds.width - rowHeaderWidth;
  const columnWidth = Math.max(cfg.minColumnWidth, availableWidth / numValueCols);
  const columnWidths = Array(numValueCols).fill(columnWidth);

  // Calculate row Y positions
  let currentY = bounds.y + columnHeaderHeight;
  const rowYPositions: number[] = [];
  for (const row of rows) {
    rowYPositions.push(currentY);
    currentY += row.isGrandTotal || row.isSubtotal ? cfg.headerHeight : cfg.rowHeight;
  }

  return {
    contentX: bounds.x,
    contentY: bounds.y,
    rowHeaderWidth,
    columnWidths,
    rowYPositions,
    columnHeaderHeight,
    layoutForm,
    numRowHeaderColumns,
    rowHeaderColumnWidths,
  };
}

// =============================================================================
// Drawing Functions
// =============================================================================

function drawColumnHeaders(
  ctx: CanvasRenderingContext2D,
  columnHeaders: PivotColumnHeader[],
  layout: PivotLayout,
  cfg: PivotRendererConfig,
): void {
  const {
    contentX,
    contentY,
    rowHeaderWidth,
    columnWidths,
    columnHeaderHeight,
    layoutForm,
    rowHeaderColumnWidths,
  } = layout;

  // Draw header background
  ctx.fillStyle = cfg.colors.headerBackground;
  ctx.fillRect(
    contentX,
    contentY,
    rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0),
    columnHeaderHeight,
  );

  // Draw row header column titles (for outline/tabular forms)
  ctx.fillStyle = cfg.colors.headerText;
  ctx.font = `bold ${cfg.fontSize}px ${cfg.fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (layoutForm !== 'compact') {
    // In outline/tabular form, draw field names as column headers
    const headerY = contentY + columnHeaderHeight / 2;
    let headerX = contentX;
    rowHeaderColumnWidths.forEach((colWidth, i) => {
      // Field name placeholder - ideally we'd have field names from config
      // For now, just draw "Row Labels" in first column if single column header level
      if (i === 0 && columnHeaders.length <= 1) {
        ctx.fillText(
          truncateText(ctx, 'Row Labels', colWidth - cfg.padding * 2),
          headerX + cfg.padding,
          headerY,
        );
      }

      // Draw vertical border for each row header column
      ctx.strokeStyle = cfg.colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(headerX + colWidth + 0.5, contentY);
      ctx.lineTo(headerX + colWidth + 0.5, contentY + columnHeaderHeight);
      ctx.stroke();

      headerX += colWidth;
    });
  }

  // If no column headers, draw simple "Values" header
  if (columnHeaders.length === 0) {
    const headerY = contentY + columnHeaderHeight / 2;

    // In compact form, draw empty corner cell
    if (layoutForm === 'compact') {
      ctx.fillText('', contentX + cfg.padding, headerY);
    }

    const colX = contentX + rowHeaderWidth;
    ctx.fillText('Values', colX + cfg.padding, headerY);

    // Draw vertical border after row headers (only for compact form, outline/tabular already done above)
    if (layoutForm === 'compact') {
      ctx.strokeStyle = cfg.colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(contentX + rowHeaderWidth + 0.5, contentY);
      ctx.lineTo(contentX + rowHeaderWidth + 0.5, contentY + columnHeaderHeight);
      ctx.stroke();
    }

    // Draw horizontal border below headers
    ctx.beginPath();
    ctx.moveTo(contentX, contentY + columnHeaderHeight + 0.5);
    ctx.lineTo(
      contentX + rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0),
      contentY + columnHeaderHeight + 0.5,
    );
    ctx.stroke();

    return;
  }

  // Draw each level of column headers
  columnHeaders.forEach((level, levelIndex) => {
    const headerY = contentY + (levelIndex + 0.5) * cfg.headerHeight;
    let colX = contentX + rowHeaderWidth;

    level.headers.forEach((header) => {
      const width = header.span * (columnWidths[0] || cfg.minColumnWidth);

      // Draw header text
      ctx.fillStyle = cfg.colors.headerText;
      ctx.font = `bold ${cfg.fontSize}px ${cfg.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        truncateText(ctx, formatValue(header.value), width - cfg.padding * 2),
        colX + width / 2,
        headerY,
      );

      // Draw vertical border
      ctx.strokeStyle = cfg.colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX + width + 0.5, contentY + levelIndex * cfg.headerHeight);
      ctx.lineTo(colX + width + 0.5, contentY + (levelIndex + 1) * cfg.headerHeight);
      ctx.stroke();

      colX += width;
    });
  });

  // Draw vertical border after row headers (only for compact form, outline/tabular already done above)
  if (layoutForm === 'compact') {
    ctx.strokeStyle = cfg.colors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(contentX + rowHeaderWidth + 0.5, contentY);
    ctx.lineTo(contentX + rowHeaderWidth + 0.5, contentY + columnHeaderHeight);
    ctx.stroke();
  }

  // Draw horizontal border below headers
  ctx.beginPath();
  ctx.moveTo(contentX, contentY + columnHeaderHeight + 0.5);
  ctx.lineTo(
    contentX + rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0),
    contentY + columnHeaderHeight + 0.5,
  );
  ctx.stroke();
}

function drawRows(
  ctx: CanvasRenderingContext2D,
  rows: PivotRow[],
  layout: PivotLayout,
  cfg: PivotRendererConfig,
): void {
  const { layoutForm } = layout;

  // Dispatch to layout-form-specific renderer
  switch (layoutForm) {
    case 'compact':
      drawRowsCompact(ctx, rows, layout, cfg);
      break;
    case 'outline':
      drawRowsOutline(ctx, rows, layout, cfg);
      break;
    case 'tabular':
      drawRowsTabular(ctx, rows, layout, cfg);
      break;
    default:
      drawRowsCompact(ctx, rows, layout, cfg);
  }
}

/**
 * Compact form: Single column for all row headers with indentation by depth.
 * Headers are concatenated with " > " separator.
 * This is the default Excel pivot layout.
 */
function drawRowsCompact(
  ctx: CanvasRenderingContext2D,
  rows: PivotRow[],
  layout: PivotLayout,
  cfg: PivotRendererConfig,
): void {
  const { contentX, rowHeaderWidth, columnWidths, rowYPositions } = layout;

  rows.forEach((row, rowIndex) => {
    const y = rowYPositions[rowIndex];
    const height = row.isGrandTotal || row.isSubtotal ? cfg.headerHeight : cfg.rowHeight;

    // Draw row background
    drawRowBackground(ctx, row, contentX, y, rowHeaderWidth, columnWidths, height, cfg);

    // Draw row header (single column with indentation)
    ctx.fillStyle = row.isGrandTotal || row.isSubtotal ? cfg.colors.headerText : cfg.colors.text;
    ctx.font = row.isGrandTotal
      ? `bold ${cfg.fontSize}px ${cfg.fontFamily}`
      : `${cfg.fontSize}px ${cfg.fontFamily}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const indent = row.depth * 16;
    const headerText = row.isGrandTotal
      ? 'Grand Total'
      : row.headers.map((h) => formatValue(h.value)).join(' > ');
    ctx.fillText(
      truncateText(ctx, headerText, rowHeaderWidth - cfg.padding * 2 - indent),
      contentX + cfg.padding + indent,
      y + height / 2,
    );

    // Draw value cells
    drawValueCells(ctx, row, contentX + rowHeaderWidth, y, height, columnWidths, cfg);

    // Draw horizontal border below row
    drawRowBorder(ctx, contentX, y, height, rowHeaderWidth, columnWidths, cfg);
  });
}

/**
 * Outline form: Separate column for each row field.
 * No label repetition - only shows label when it changes.
 * Subtotals appear at the top of each group.
 */
function drawRowsOutline(
  ctx: CanvasRenderingContext2D,
  rows: PivotRow[],
  layout: PivotLayout,
  cfg: PivotRendererConfig,
): void {
  const { contentX, rowHeaderWidth, columnWidths, rowYPositions, rowHeaderColumnWidths } = layout;

  // Track previous row's header values to avoid repetition
  const prevHeaders: (CellValue | undefined)[] = [];

  rows.forEach((row, rowIndex) => {
    const y = rowYPositions[rowIndex];
    const height = row.isGrandTotal || row.isSubtotal ? cfg.headerHeight : cfg.rowHeight;

    // Draw row background
    drawRowBackground(ctx, row, contentX, y, rowHeaderWidth, columnWidths, height, cfg);

    // Draw row headers (separate column per field)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let headerX = contentX;
    rowHeaderColumnWidths.forEach((colWidth, colIndex) => {
      const header = row.headers[colIndex];
      const headerValue = header?.value;

      // In outline form, only show label if it changed from previous row
      // (unless it's a subtotal or grand total row)
      const shouldShow =
        row.isGrandTotal ||
        row.isSubtotal ||
        headerValue !== prevHeaders[colIndex] ||
        // Show if any previous column changed (hierarchy reset)
        (colIndex > 0 && row.headers[colIndex - 1]?.value !== prevHeaders[colIndex - 1]);

      if (shouldShow && headerValue !== undefined) {
        ctx.fillStyle =
          row.isGrandTotal || row.isSubtotal ? cfg.colors.headerText : cfg.colors.text;
        ctx.font =
          row.isGrandTotal || row.isSubtotal
            ? `bold ${cfg.fontSize}px ${cfg.fontFamily}`
            : `${cfg.fontSize}px ${cfg.fontFamily}`;

        const displayText = row.isGrandTotal ? 'Grand Total' : formatValue(headerValue);
        ctx.fillText(
          truncateText(ctx, displayText, colWidth - cfg.padding * 2),
          headerX + cfg.padding,
          y + height / 2,
        );
      }

      // Draw vertical border for header column
      ctx.strokeStyle = cfg.colors.border;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(headerX + colWidth + 0.5, y);
      ctx.lineTo(headerX + colWidth + 0.5, y + height);
      ctx.stroke();

      headerX += colWidth;
    });

    // Update previous headers for next iteration
    row.headers.forEach((h, i) => {
      prevHeaders[i] = h.value;
    });

    // Draw value cells
    drawValueCells(ctx, row, contentX + rowHeaderWidth, y, height, columnWidths, cfg);

    // Draw horizontal border below row
    drawRowBorder(ctx, contentX, y, height, rowHeaderWidth, columnWidths, cfg);
  });
}

/**
 * Tabular form: Separate column for each row field.
 * Labels are repeated on every row (full denormalization).
 * Most table-like appearance.
 */
function drawRowsTabular(
  ctx: CanvasRenderingContext2D,
  rows: PivotRow[],
  layout: PivotLayout,
  cfg: PivotRendererConfig,
): void {
  const { contentX, rowHeaderWidth, columnWidths, rowYPositions, rowHeaderColumnWidths } = layout;

  rows.forEach((row, rowIndex) => {
    const y = rowYPositions[rowIndex];
    const height = row.isGrandTotal || row.isSubtotal ? cfg.headerHeight : cfg.rowHeight;

    // Draw row background
    drawRowBackground(ctx, row, contentX, y, rowHeaderWidth, columnWidths, height, cfg);

    // Draw row headers (separate column per field, always show labels)
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let headerX = contentX;
    rowHeaderColumnWidths.forEach((colWidth, colIndex) => {
      const header = row.headers[colIndex];
      const headerValue = header?.value;

      // In tabular form, always show the label (repeat on every row)
      if (headerValue !== undefined || row.isGrandTotal) {
        ctx.fillStyle =
          row.isGrandTotal || row.isSubtotal ? cfg.colors.headerText : cfg.colors.text;
        ctx.font =
          row.isGrandTotal || row.isSubtotal
            ? `bold ${cfg.fontSize}px ${cfg.fontFamily}`
            : `${cfg.fontSize}px ${cfg.fontFamily}`;

        const displayText =
          row.isGrandTotal && colIndex === 0 ? 'Grand Total' : formatValue(headerValue ?? '');
        ctx.fillText(
          truncateText(ctx, displayText, colWidth - cfg.padding * 2),
          headerX + cfg.padding,
          y + height / 2,
        );
      }

      // Draw vertical border for header column
      ctx.strokeStyle = cfg.colors.border;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(headerX + colWidth + 0.5, y);
      ctx.lineTo(headerX + colWidth + 0.5, y + height);
      ctx.stroke();

      headerX += colWidth;
    });

    // Draw value cells
    drawValueCells(ctx, row, contentX + rowHeaderWidth, y, height, columnWidths, cfg);

    // Draw horizontal border below row
    drawRowBorder(ctx, contentX, y, height, rowHeaderWidth, columnWidths, cfg);
  });
}

// =============================================================================
// Shared Drawing Helpers
// =============================================================================

/**
 * Draw row background (subtotal/grand total highlighting)
 */
function drawRowBackground(
  ctx: CanvasRenderingContext2D,
  row: PivotRow,
  contentX: number,
  y: number,
  rowHeaderWidth: number,
  columnWidths: number[],
  height: number,
  cfg: PivotRendererConfig,
): void {
  if (row.isGrandTotal) {
    ctx.fillStyle = cfg.colors.grandTotalBackground;
    ctx.fillRect(contentX, y, rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0), height);
  } else if (row.isSubtotal) {
    ctx.fillStyle = cfg.colors.subtotalBackground;
    ctx.fillRect(contentX, y, rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0), height);
  }
}

/**
 * Draw value cells (shared across all layout forms)
 */
function drawValueCells(
  ctx: CanvasRenderingContext2D,
  row: PivotRow,
  startX: number,
  y: number,
  height: number,
  columnWidths: number[],
  cfg: PivotRendererConfig,
): void {
  let colX = startX;
  row.values.forEach((value, colIndex) => {
    const width = columnWidths[colIndex] || cfg.minColumnWidth;

    ctx.fillStyle = cfg.colors.text;
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(value), colX + width - cfg.padding, y + height / 2);

    // Draw vertical border
    ctx.strokeStyle = cfg.colors.border;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(colX + width + 0.5, y);
    ctx.lineTo(colX + width + 0.5, y + height);
    ctx.stroke();

    colX += width;
  });
}

/**
 * Draw horizontal border below row
 */
function drawRowBorder(
  ctx: CanvasRenderingContext2D,
  contentX: number,
  y: number,
  height: number,
  rowHeaderWidth: number,
  columnWidths: number[],
  cfg: PivotRendererConfig,
): void {
  ctx.strokeStyle = cfg.colors.border;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(contentX, y + height + 0.5);
  ctx.lineTo(contentX + rowHeaderWidth + columnWidths.reduce((a, b) => a + b, 0), y + height + 0.5);
  ctx.stroke();
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatValue(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(value);
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const metrics = ctx.measureText(text);
  if (metrics.width <= maxWidth) {
    return text;
  }

  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }

  return truncated + '...';
}

function estimateTextWidth(text: string, cfg: PivotRendererConfig): number {
  // Rough estimate: average character width is ~0.5 * font size
  return text.length * cfg.fontSize * 0.5;
}

// =============================================================================
// Exports
// =============================================================================

export { DEFAULT_CONFIG as DEFAULT_PIVOT_RENDERER_CONFIG };
