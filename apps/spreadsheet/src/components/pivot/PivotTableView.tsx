/**
 * PivotTableView Component
 *
 * Renders a computed pivot table result with headers, values, and totals.
 * Supports expand/collapse for hierarchical data.
 */

import { useCallback, type MouseEvent } from 'react';

import type { CellValue } from '@mog-sdk/contracts/core';
import type {
  PivotColumnHeader,
  PivotRow,
  PivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import { PIVOT_READBACK_REVISION } from '../../systems/pivot';
import { Button } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

export interface PivotTableViewProps {
  /** Pivot table configuration */
  config: PivotTableConfig;
  /** Computed pivot table result */
  result: PivotTableResult;
  /** Callback when a header is expanded/collapsed */
  onToggleExpand?: (headerKey: string, isRow: boolean) => void;
  /** Callback when a value cell is clicked (drill-down) */
  onCellClick?: (rowKey: string, columnKey: string) => void;
  /** Callback to open the field panel for configuration */
  onOpenFieldPanel?: () => void;
  /** Whether the table is selected */
  isSelected?: boolean;
  /** Custom className */
  className?: string;
  /** Custom style */
  style?: React.CSSProperties;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a cell value for display
 */
function formatValue(value: CellValue, numberFormat?: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    if (numberFormat === 'currency') {
      return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    if (numberFormat === 'percent') {
      return (value * 100).toFixed(1) + '%';
    }
    // Default number formatting with commas
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Get column key for a value cell
 */
function getColumnKey(columnHeaders: PivotColumnHeader[], colIndex: number): string {
  if (columnHeaders.length === 0) {
    return `col-${colIndex}`;
  }
  // Build column key from all header levels
  const keys: string[] = [];
  for (const level of columnHeaders) {
    // Find which header this column falls under
    let cumSpan = 0;
    for (const header of level.headers) {
      if (colIndex >= cumSpan && colIndex < cumSpan + header.span) {
        keys.push(header.key);
        break;
      }
      cumSpan += header.span;
    }
  }
  return keys.join('|');
}

function fieldLabel(config: PivotTableConfig, fieldId: string): string {
  return config.fields.find((field) => field.id === fieldId)?.name ?? fieldId;
}

function placementsFor(config: PivotTableConfig, area: 'row' | 'column' | 'value' | 'filter') {
  return config.placements
    .filter((placement) => placement.area === area)
    .sort((a, b) => a.position - b.position);
}

function placementFieldNames(config: PivotTableConfig, area: 'row' | 'column' | 'filter'): string {
  return JSON.stringify(
    placementsFor(config, area).map((placement) => fieldLabel(config, placement.fieldId)),
  );
}

function valueFieldReadback(config: PivotTableConfig): string {
  return JSON.stringify(
    placementsFor(config, 'value').map((placement) => {
      const sourceField = placement.calculatedFieldId
        ? (config.calculatedFields ?? []).find(
            (field) => (field.calculatedFieldId ?? field.fieldId) === placement.calculatedFieldId,
          )?.name
        : fieldLabel(config, placement.fieldId);
      const name = placement.displayName ?? sourceField ?? placement.fieldId;
      return {
        name,
        sourceField: sourceField ?? name,
        aggregation: placement.aggregateFunction ?? 'sum',
      };
    }),
  );
}

function leafColumnCount(columnHeaders: PivotColumnHeader[]): number {
  const lastLevel = columnHeaders[columnHeaders.length - 1];
  if (!lastLevel) return 0;
  return lastLevel.headers.reduce((sum, header) => sum + header.span, 0);
}

// =============================================================================
// Sub-Components
// =============================================================================

interface ExpandButtonProps {
  isExpanded: boolean;
  onClick: () => void;
  axis: 'row' | 'column';
  headerKey: string;
}

function ExpandButton({ isExpanded, onClick, axis, headerKey }: ExpandButtonProps) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-4 h-4 mr-1 p-0 border-none rounded-ss-sm bg-transparent cursor-pointer text-hint text-ss-text-secondary hover:bg-ss-surface-hover"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={isExpanded ? 'Collapse' : 'Expand'}
      data-pivot-target="expand-toggle"
      data-pivot-axis={axis}
      data-pivot-header-key={headerKey}
      data-pivot-expanded={isExpanded ? 'true' : 'false'}
    >
      {isExpanded ? '-' : '+'}
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PivotTableView({
  config,
  result,
  onToggleExpand,
  onCellClick,
  onOpenFieldPanel,
  isSelected = false,
  className,
  style,
}: PivotTableViewProps) {
  const { columnHeaders, rows, grandTotals, sourceRowCount } = result;
  const rowPlacements = placementsFor(config, 'row');
  const columnPlacements = placementsFor(config, 'column');
  const valuePlacements = placementsFor(config, 'value');
  const hasRowFields = rowPlacements.length > 0;
  const hasColumnFields = columnPlacements.length > 0;
  const hasValueFields = valuePlacements.length > 0;
  const isNoValuesPivot = !hasValueFields && (hasRowFields || hasColumnFields);
  const rowHeaderLabel = hasRowFields ? fieldLabel(config, rowPlacements[0].fieldId) : '';
  const grandTotalLabel = grandTotals.rowLabel ?? 'Grand Total';
  const hasColumnGrandTotals = grandTotals.column != null;
  const hasRowGrandTotals = grandTotals.row != null;
  const noValueDataColumnCount = Math.max(
    leafColumnCount(columnHeaders) + (hasColumnGrandTotals || hasColumnFields ? 1 : 0),
    0,
  );

  // Handle row expand toggle
  const handleRowExpand = useCallback(
    (headerKey: string) => {
      onToggleExpand?.(headerKey, true);
    },
    [onToggleExpand],
  );

  // Handle column expand toggle
  const handleColumnExpand = useCallback(
    (headerKey: string) => {
      onToggleExpand?.(headerKey, false);
    },
    [onToggleExpand],
  );

  // Handle cell click
  const handleCellClick = useCallback(
    (_e: MouseEvent, rowKey: string, colIndex: number) => {
      if (!onCellClick) return;
      const columnKey = getColumnKey(columnHeaders, colIndex);
      onCellClick(rowKey, columnKey);
    },
    [columnHeaders, onCellClick],
  );

  // Render column headers
  const renderColumnHeaders = () => {
    const headerCellClass =
      'px-2 py-1.5 bg-ss-surface-secondary border-b border-r border-ss-border font-semibold text-left whitespace-nowrap';

    if (isNoValuesPivot && columnHeaders.length === 0) {
      return (
        <tr data-pivot-target="readback-row" data-pivot-row-index={0}>
          {hasRowFields && (
            <th
              className={headerCellClass}
              data-pivot-target="readback-cell"
              data-pivot-cell-role="header"
              data-pivot-row-index={0}
              data-pivot-column-index={0}
            >
              {rowHeaderLabel}
            </th>
          )}
          {!hasRowFields && (
            <th
              className={headerCellClass}
              data-pivot-target="readback-cell"
              data-pivot-cell-role="grand-total"
              data-pivot-row-index={0}
              data-pivot-column-index={0}
            >
              {grandTotalLabel}
            </th>
          )}
        </tr>
      );
    }

    if (columnHeaders.length === 0) {
      return (
        <tr data-pivot-target="readback-row" data-pivot-row-index={0}>
          <th
            className={headerCellClass}
            data-pivot-target="readback-cell"
            data-pivot-cell-role="empty"
          ></th>
          <th
            className={headerCellClass}
            data-pivot-target="readback-cell"
            data-pivot-cell-role="header"
          >
            Values
          </th>
          {hasColumnGrandTotals && (
            <th
              className={headerCellClass}
              data-pivot-target="readback-cell"
              data-pivot-cell-role="grand-total"
            >
              {grandTotalLabel}
            </th>
          )}
        </tr>
      );
    }

    return columnHeaders.map((level, levelIndex) => (
      <tr
        key={`header-level-${levelIndex}`}
        data-pivot-target="readback-row"
        data-pivot-row-index={levelIndex}
      >
        {/* Row header area placeholder */}
        {levelIndex === 0 && hasRowFields && (
          <th
            className={headerCellClass}
            rowSpan={columnHeaders.length}
            data-pivot-target="readback-cell"
            data-pivot-cell-role="header"
          >
            {rowHeaderLabel}
          </th>
        )}
        {/* Column headers */}
        {level.headers.map((header) => (
          <th
            key={header.key}
            className={headerCellClass}
            colSpan={header.span}
            data-pivot-target="readback-cell"
            data-pivot-cell-role={header.isGrandTotal ? 'grand-total' : 'header'}
            data-pivot-header-key={header.key}
          >
            {header.isExpandable && onToggleExpand && (
              <ExpandButton
                isExpanded={header.isExpanded}
                onClick={() => handleColumnExpand(header.key)}
                axis="column"
                headerKey={header.key}
              />
            )}
            {header.isGrandTotal ? 'Grand Total' : formatValue(header.value)}
          </th>
        ))}
        {(hasColumnGrandTotals || isNoValuesPivot) && levelIndex === columnHeaders.length - 1 && (
          <th
            className={headerCellClass}
            data-pivot-target="readback-cell"
            data-pivot-cell-role="grand-total"
          >
            {grandTotalLabel}
          </th>
        )}
      </tr>
    ));
  };

  // Render a data row
  const renderRow = (row: PivotRow, rowIndex: number) => {
    const isSubtotal = row.isSubtotal;
    const isGrandTotal = row.isGrandTotal;

    const rowClass = isGrandTotal
      ? 'bg-ss-surface-hover font-semibold'
      : isSubtotal
        ? 'bg-ss-surface-tertiary'
        : '';

    return (
      <tr
        key={row.key}
        className={rowClass}
        data-pivot-target="readback-row"
        data-pivot-row-key={row.key}
        data-pivot-row-index={rowIndex}
      >
        {/* Row headers */}
        <td
          className="px-2 py-1.5 bg-ss-surface-secondary border-b border-ss-border-light border-r border-r-border font-medium text-left whitespace-nowrap"
          style={{ paddingLeft: `${8 + row.depth * 16}px` }}
          data-pivot-target="readback-cell"
          data-pivot-cell-role={isGrandTotal ? 'grand-total' : 'header'}
          data-pivot-row-key={row.key}
          data-pivot-column-index={0}
        >
          {row.headers.length > 0 &&
            row.headers[row.headers.length - 1].isExpandable &&
            onToggleExpand && (
              <ExpandButton
                isExpanded={row.headers[row.headers.length - 1].isExpanded}
                onClick={() => handleRowExpand(row.headers[row.headers.length - 1].key)}
                axis="row"
                headerKey={row.headers[row.headers.length - 1].key}
              />
            )}
          {isGrandTotal ? 'Grand Total' : row.headers.map((h) => formatValue(h.value)).join(' > ')}
        </td>

        {/* Value cells */}
        {(isNoValuesPivot
          ? Array.from({ length: noValueDataColumnCount }, () => null)
          : [...row.values, ...(hasColumnGrandTotals ? (grandTotals.column?.[rowIndex] ?? []) : [])]
        ).map((value, colIndex) => (
          <td
            key={`${row.key}-${colIndex}`}
            className="px-2 py-1.5 border-b border-r border-ss-border-light text-right tabular-nums"
            onClick={(e) => handleCellClick(e, row.key, colIndex)}
            data-pivot-target="readback-cell"
            data-pivot-cell-role="value"
            data-pivot-row-key={row.key}
            data-pivot-column-index={colIndex + 1}
            data-pivot-raw-value={value == null ? '' : String(value)}
          >
            {formatValue(value)}
          </td>
        ))}
      </tr>
    );
  };

  const renderGrandTotalRow = () => {
    if (!hasRowGrandTotals) return null;
    const values = [
      ...(grandTotals.row ?? []),
      ...(hasColumnGrandTotals ? (grandTotals.grand ?? []) : []),
    ];

    return (
      <tr
        className="bg-ss-surface-hover font-semibold"
        data-pivot-target="readback-row"
        data-pivot-row-key="grand-total"
      >
        <td
          className="px-2 py-1.5 bg-ss-surface-secondary border-b border-ss-border-light border-r border-r-border font-medium text-left whitespace-nowrap"
          data-pivot-target="readback-cell"
          data-pivot-cell-role="grand-total"
          data-pivot-column-index={0}
        >
          {grandTotalLabel}
        </td>
        {values.map((value, colIndex) => (
          <td
            key={`grand-total-${colIndex}`}
            className="px-2 py-1.5 border-b border-r border-ss-border-light text-right tabular-nums"
            data-pivot-target="readback-cell"
            data-pivot-cell-role="grand-total"
            data-pivot-column-index={colIndex + 1}
            data-pivot-raw-value={value == null ? '' : String(value)}
          >
            {formatValue(value)}
          </td>
        ))}
      </tr>
    );
  };

  const renderColumnOnlyNoValuesRows = () => {
    if (!isNoValuesPivot || hasRowFields || !hasColumnFields || columnHeaders.length === 0) {
      return null;
    }
    return <tbody />;
  };

  // Container classes
  const containerClasses = `flex flex-col border rounded overflow-auto bg-ss-surface text-body ${
    isSelected ? 'border-ss-primary ring-2 ring-ss-primary/20' : 'border-ss-border'
  } ${className || ''}`;

  // Empty state
  if (rows.length === 0 && !isNoValuesPivot) {
    return (
      <div
        className={containerClasses}
        style={style}
        data-pivot-target="table-view"
        data-pivot-id={config.id}
        data-pivot-name={config.name}
        data-pivot-readback-revision={PIVOT_READBACK_REVISION}
        data-pivot-row-fields={placementFieldNames(config, 'row')}
        data-pivot-column-fields={placementFieldNames(config, 'column')}
        data-pivot-filter-fields={placementFieldNames(config, 'filter')}
        data-pivot-value-fields={valueFieldReadback(config)}
      >
        <div
          className="flex flex-col items-center justify-center gap-2 p-10 text-center text-ss-text-secondary min-h-[200px]"
          data-pivot-target="empty-state"
        >
          <div className="text-5xl mb-2 opacity-80" role="img" aria-label="Pivot table">
            📊
          </div>
          <div className="text-subtitle font-semibold text-text">Configure Your Pivot Table</div>
          <div
            className="text-body-sm font-medium text-ss-text-secondary mb-1"
            data-pivot-target="empty-state-name"
          >
            {config.name}
          </div>
          <div className="text-body-lg text-ss-text-tertiary max-w-[260px] leading-normal">
            Add fields to Rows, Columns, and Values to build your report. Changes update live.
          </div>
          {onOpenFieldPanel && (
            <Button variant="primary" className="mt-4 px-6 py-2.5" onClick={onOpenFieldPanel}>
              Open Field Panel
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={containerClasses}
      style={style}
      data-pivot-target="table-view"
      data-pivot-id={config.id}
      data-pivot-name={config.name}
      data-pivot-readback-revision={PIVOT_READBACK_REVISION}
      data-pivot-row-fields={placementFieldNames(config, 'row')}
      data-pivot-column-fields={placementFieldNames(config, 'column')}
      data-pivot-filter-fields={placementFieldNames(config, 'filter')}
      data-pivot-value-fields={valueFieldReadback(config)}
    >
      <table className="border-collapse w-full" data-pivot-target="readback-table">
        <thead>{renderColumnHeaders()}</thead>
        {renderColumnOnlyNoValuesRows() ?? (
          <tbody>
            {rows.map((row, rowIndex) => renderRow(row, rowIndex))}
            {renderGrandTotalRow()}
          </tbody>
        )}
      </table>

      {/* Stats bar */}
      <div className="flex justify-between px-2 py-1 bg-ss-surface-secondary border-t border-ss-border text-caption text-ss-text-secondary">
        <span>{sourceRowCount.toLocaleString()} source rows</span>
      </div>
    </div>
  );
}

export default PivotTableView;
