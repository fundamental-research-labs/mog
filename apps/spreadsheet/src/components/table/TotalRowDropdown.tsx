/**
 * TotalRowDropdown Component
 *
 * Dropdown menu displayed when clicking on a total row cell in a table.
 * Shows aggregation function options: None, Average, Count, Count Numbers,
 * Max, Min, Sum, StdDev, Var.
 *
 * Total Row Function Dropdown
 * Enhanced with formula preview on hover
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { TotalFunction } from '@mog-sdk/contracts/tables';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore, useWorkbook } from '../../infra/context';
import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

/**
 * Total function options matching Excel's total row dropdown.
 */
const TOTAL_FUNCTIONS: { value: TotalFunction; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'average', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'countNums', label: 'Count Numbers' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'sum', label: 'Sum' },
  { value: 'stdDev', label: 'StdDev' },
  { value: 'var', label: 'Var' },
];

/**
 * Generate SUBTOTAL formula preview for a function.
 * Excel uses SUBTOTAL function for table total rows.
 *
 * @param fn - Total function
 * @param columnName - Column name
 * @returns Formula preview string
 */
function getFormulaPreview(fn: TotalFunction, columnName: string): string {
  // SUBTOTAL function codes (with filter-ignore variants)
  const subtotalCodes: Record<TotalFunction, number> = {
    none: 0,
    average: 101,
    count: 102,
    countNums: 103,
    max: 104,
    min: 105,
    sum: 109,
    stdDev: 107,
    var: 110,
    custom: 0, // Custom formulas don't use SUBTOTAL
  };

  if (fn === 'none' || fn === 'custom') {
    return '';
  }

  const code = subtotalCodes[fn];
  return `=SUBTOTAL(${code},[${columnName}])`;
}

// =============================================================================
// Component
// =============================================================================

export function TotalRowDropdown(): React.ReactElement | null {
  const deps = useActionDependencies();
  const wb = useWorkbook();

  // Subscribe to total row dropdown state
  const { isOpen, tableId, columnIndex, position, currentFunction } = useUIStore(
    (s) => s.totalRowDropdown,
  );
  const closeTotalRowDropdown = useUIStore((s) => s.closeTotalRowDropdown);

  // Track hovered function for formula preview
  const [hoveredFunction, setHoveredFunction] = useState<TotalFunction | null>(null);

  // Get table and column info for formula preview via Workbook/Worksheet API (async)
  const [tableInfo, setTableInfo] = useState<{ columnName: string } | null>(null);
  useEffect(() => {
    if (!tableId || columnIndex === null) {
      setTableInfo(null);
      return;
    }
    // Search all sheets for the table by ID
    // The tableId from UIStore is sufficient to identify the table
    void (async () => {
      try {
        const sheetNames = await wb.getSheetNames();
        for (const name of sheetNames) {
          const ws = await wb.getSheet(name);
          const tables = await ws.tables.list();
          const table = tables.find((t) => t.id === tableId || t.name === tableId);
          if (table && table.columns) {
            const column = table.columns[columnIndex];
            setTableInfo({
              columnName: column?.name ?? `Column${columnIndex + 1}`,
            });
            return;
          }
        }
        setTableInfo(null);
      } catch {
        setTableInfo(null);
      }
    })();
  }, [wb, tableId, columnIndex]);

  // Formula preview text
  const formulaPreview = useMemo(() => {
    if (!tableInfo || !hoveredFunction) return '';
    return getFormulaPreview(hoveredFunction, tableInfo.columnName);
  }, [tableInfo, hoveredFunction]);

  // Handle function selection
  const handleSelect = useCallback(
    (fn: TotalFunction) => {
      if (tableId !== null && columnIndex !== null) {
        dispatch('SET_TOTAL_ROW_FUNCTION', deps, {
          tableId,
          columnIndex,
          fn,
        });
      }
      closeTotalRowDropdown();
    },
    [tableId, columnIndex, closeTotalRowDropdown, deps],
  );

  // Don't render if not open
  if (!isOpen || !position) {
    return null;
  }

  return (
    <Popover open={isOpen} onOpenChange={(open) => !open && closeTotalRowDropdown()}>
      <PopoverAnchor virtualRef={{ current: createVirtualRef(position.x, position.y) }} />
      <PopoverContent
        side="bottom"
        align="start"
        shadow="lg"
        closeOnClickOutside={true}
        closeOnEscape={true}
        width={180}
        role="listbox"
        aria-label="Select total function for column"
      >
        <div onMouseLeave={() => setHoveredFunction(null)}>
          <ul className="list-none m-0 p-0">
            {TOTAL_FUNCTIONS.map(({ value, label }) => {
              const isSelected =
                currentFunction === value || (currentFunction === null && value === 'none');

              return (
                <li
                  key={value}
                  className={`px-3 py-1.5 cursor-pointer text-dropdown font-ss-sans text-text whitespace-nowrap hover:bg-ss-surface-hover ${
                    isSelected ? 'bg-ss-primary-light font-medium' : ''
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(value)}
                  onMouseEnter={() => setHoveredFunction(value)}
                >
                  {label}
                </li>
              );
            })}
          </ul>

          {/* Formula preview bar at bottom of dropdown */}
          {formulaPreview && (
            <div className="px-3 py-2 border-t border-ss-border bg-ss-surface-subtle text-ss-text-secondary text-caption font-ss-mono">
              {formulaPreview}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
