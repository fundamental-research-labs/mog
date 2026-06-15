/**
 * Sort Dialog
 *
 * Sort System
 *
 * Multi-column sort dialog matching Excel's "Custom Sort" dialog.
 * Allows users to:
 * - Sort by multiple columns (primary, secondary, tertiary, etc.)
 * - Choose sort direction per column
 * - Specify whether data has headers
 * - Sort by cell icon
 * - Sort orientation: top to bottom or left to right
 *
 * Cell Identity Model: The dialog works with column indices for UI
 * ergonomics. The domain module converts to CellId-based criteria
 * for CRDT safety.
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { displayStringOrNull } from '@mog-sdk/contracts/core';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  Label,
  Select,
} from '@mog/shell';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import type { CustomList } from '@mog-sdk/contracts/fill';
import type { SortBy, SortDirection } from '@mog-sdk/contracts/sorting';
import type { SortColumn } from '@mog-sdk/contracts/api';
import { cellRangeToA1 } from '@mog/spreadsheet-utils/a1';

// =============================================================================
// Types
// =============================================================================

/**
 * UI state for a single sort level.
 * Uses column index for display, converted to CellId on submit.
 */
interface SortLevelUI {
  /** Column index relative to range (0 = first column in range) */
  columnIndex: number;
  /** Sort direction */
  direction: SortDirection;
  /** What to sort by */
  sortBy: SortBy;
  /**
   * Optional custom-list id selecting one of the built-in custom lists.
   * When set, the Order dropdown displays "Custom List..." and a secondary
   * dropdown chooses which list. The list values are passed as
   * `customList` on the SortColumn so values not in the list sort to end.
   */
  customListId?: string;
  targetColor?: string;
  colorPosition?: 'top' | 'bottom';
}

// =============================================================================
// Constants
// =============================================================================

const DIRECTION_OPTIONS = [
  { value: 'asc', label: 'A to Z' },
  { value: 'desc', label: 'Z to A' },
  { value: 'custom-list', label: 'Custom List...' },
];

const SORT_BY_OPTIONS = [
  { value: 'value', label: 'Values' },
  { value: 'cellColor', label: 'Cell Color' },
  { value: 'fontColor', label: 'Font Color' },
  { value: 'icon', label: 'Cell Icon' },
];

// Sort orientation options
type SortOrientation = 'topToBottom' | 'leftToRight';
const ORIENTATION_OPTIONS = [
  { value: 'topToBottom', label: 'Sort top to bottom' },
  { value: 'leftToRight', label: 'Sort left to right' },
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get display value for a cell at position.
 * Uses Worksheet.viewport (sync) instead of getSheetMaps.
 */
function getDisplayValue(
  ws: {
    viewport: {
      getCellData(
        row: number,
        col: number,
      ): {
        displayText?: import('@mog-sdk/contracts/core').FormattedText | null;
      } | null;
    };
  },
  _sheetId: string,
  row: number,
  col: number,
): string | null {
  const cell = ws.viewport.getCellData(row, col);
  if (!cell) return null;
  return displayStringOrNull(cell.displayText ?? null);
}

// =============================================================================
// Component
// =============================================================================

export function SortDialog() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // UI Store state
  const sortDialog = useUIStore((s) => s.sortDialog);
  const closeSortDialog = useUIStore((s) => s.closeSortDialog);
  const setSortDialogHasHeaders = useUIStore((s) => s.setSortDialogHasHeaders);

  const { isOpen, range, hasHeaders, visibleRowsOnly, initialKind } = sortDialog;

  // Local state for sort levels
  const [levels, setLevels] = useState<SortLevelUI[]>([
    { columnIndex: 0, direction: 'asc', sortBy: 'value' },
  ]);

  // E4: Error message state for merge validation
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // Sort orientation state (top to bottom vs left to right)
  const [orientation, setOrientation] = useState<SortOrientation>('topToBottom');
  const [customLists, setCustomLists] = useState<readonly CustomList[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void wb.getCustomLists().then((lists) => {
      if (!cancelled) {
        setCustomLists(lists);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wb, isOpen]);

  const customListOptions = useMemo(
    () =>
      customLists.map((list) => ({
        value: list.id,
        label: list.name,
      })),
    [customLists],
  );

  // Reset levels, error, and orientation when dialog opens with a new range
  useEffect(() => {
    if (isOpen && range) {
      const criterion = initialKind.criterion;
      setLevels([
        {
          columnIndex: criterion.columnIndex,
          direction: criterion.direction,
          sortBy: criterion.sortBy,
          ...(criterion.sortBy === 'cellColor' || criterion.sortBy === 'fontColor'
            ? {
                targetColor: criterion.targetColor,
                colorPosition: criterion.colorPosition,
              }
            : {}),
        },
      ]);
      setErrorMessage(null);
      setIsApplying(false);
      setOrientation('topToBottom');
    }
  }, [isOpen, range, initialKind]);

  // Build column options for dropdown
  const columnOptions = useMemo(() => {
    if (!range) return [];

    const options = [];
    for (let col = range.startCol; col <= range.endCol; col++) {
      const relativeIndex = col - range.startCol;

      // Always use row-0 cell values as column labels for context.
      // hasHeaders only controls whether the first row is excluded from the sort.
      const headerValue = getDisplayValue(ws, activeSheetId, range.startRow, col);
      const label = headerValue ?? `Column ${colToLetter(col)}`;

      options.push({ value: String(relativeIndex), label });
    }

    return options;
  }, [range, hasHeaders, ws, activeSheetId]);

  // Add a new sort level
  const addLevel = useCallback(() => {
    if (!range) return;

    // Find first column not already used
    const usedColumns = new Set(levels.map((l) => l.columnIndex));
    let nextCol = 0;
    for (let i = 0; i <= range.endCol - range.startCol; i++) {
      if (!usedColumns.has(i)) {
        nextCol = i;
        break;
      }
    }

    setLevels([...levels, { columnIndex: nextCol, direction: 'asc', sortBy: 'value' }]);
  }, [levels, range]);

  // Remove a sort level
  const removeLevel = useCallback(
    (index: number) => {
      if (levels.length <= 1) return; // Keep at least one level
      setLevels(levels.filter((_, i) => i !== index));
    },
    [levels],
  );

  // Copy a sort level
  const copyLevel = useCallback(
    (index: number) => {
      if (!range) return;
      // Can't add if all columns are used
      if (levels.length >= range.endCol - range.startCol + 1) return;

      const levelToCopy = levels[index];
      // Insert copy after the original
      const newLevels = [...levels];
      newLevels.splice(index + 1, 0, { ...levelToCopy });
      setLevels(newLevels);
    },
    [levels, range],
  );

  // Move a level up
  const moveLevelUp = useCallback(
    (index: number) => {
      if (index <= 0) return; // Already at top
      const newLevels = [...levels];
      [newLevels[index - 1], newLevels[index]] = [newLevels[index], newLevels[index - 1]];
      setLevels(newLevels);
    },
    [levels],
  );

  // Move a level down
  const moveLevelDown = useCallback(
    (index: number) => {
      if (index >= levels.length - 1) return; // Already at bottom
      const newLevels = [...levels];
      [newLevels[index], newLevels[index + 1]] = [newLevels[index + 1], newLevels[index]];
      setLevels(newLevels);
    },
    [levels],
  );

  // Update a sort level
  const updateLevel = useCallback(
    (index: number, updates: Partial<SortLevelUI>) => {
      setLevels(levels.map((level, i) => (i === index ? { ...level, ...updates } : level)));
    },
    [levels],
  );

  // Handle sort execution via Worksheet API
  const handleSort = useCallback(() => {
    if (!range || isApplying) return;

    void (async () => {
      setIsApplying(true);
      const ws = wb.getSheetById(activeSheetId);

      try {
        // E4: Check for merged cells - Excel refuses to sort ranges with merges
        const merges = await ws.structure.getMergedRegions();
        const hasMerges = merges.some(
          (m) =>
            m.startRow <= range.endRow &&
            m.endRow >= range.startRow &&
            m.startCol <= range.endCol &&
            m.endCol >= range.startCol,
        );

        if (hasMerges) {
          setErrorMessage(
            'This operation requires the merged cells to be identically sized. ' +
              'To sort or filter a range with merged cells, you must unmerge them first.',
          );
          setIsApplying(false);
          return;
        }

        if (levels.length === 0) {
          closeSortDialog();
          return;
        }

        const columns: SortColumn[] = levels.map((level) => {
          const list =
            level.customListId !== undefined
              ? customLists.find((l) => l.id === level.customListId)
              : undefined;
          if (
            (level.sortBy === 'cellColor' || level.sortBy === 'fontColor') &&
            level.targetColor &&
            level.colorPosition
          ) {
            return {
              column: level.columnIndex,
              direction: level.direction as 'asc' | 'desc',
              sortBy: level.sortBy,
              targetColor: level.targetColor,
              colorPosition: level.colorPosition,
            };
          }
          return {
            column: level.columnIndex,
            direction: level.direction as 'asc' | 'desc',
            sortBy: 'value' as const,
            ...(list ? { customList: [...list.values] } : {}),
          };
        });

        // Execute sort through Worksheet API
        const rangeA1 = cellRangeToA1(range);
        await ws.sortRange(rangeA1, { columns, hasHeaders, visibleRowsOnly });

        setErrorMessage(null);
        closeSortDialog();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Sort failed.');
        setIsApplying(false);
      }
    })();
  }, [
    range,
    isApplying,
    levels,
    hasHeaders,
    visibleRowsOnly,
    wb,
    activeSheetId,
    closeSortDialog,
    customLists,
  ]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (isApplying) return;
    closeSortDialog();
  }, [closeSortDialog, isApplying]);

  // Don't render if not open
  if (!isOpen || !range) return null;

  const canAddLevel = levels.length < range.endCol - range.startCol + 1;

  return (
    <Dialog
      onEnterKeyDown={handleSort}
      open={isOpen}
      onClose={handleCancel}
      dialogId="sort-dialog"
      width={560}
    >
      <DialogHeader onClose={isApplying ? undefined : handleCancel}>Sort</DialogHeader>

      <DialogBody>
        <div className="space-y-4">
          {/* E4: Error message for merge validation */}
          {errorMessage && (
            <div className="bg-ss-error-bg border border-ss-error rounded-ss-md p-3 text-ss-error text-body-sm">
              {errorMessage}
            </div>
          )}

          {/* Options Row - Has Headers and Orientation */}
          <div className="flex items-center justify-between">
            {/* Has Headers Checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="sort-has-headers"
                checked={hasHeaders}
                onChange={(checked) => setSortDialogHasHeaders(checked)}
                disabled={isApplying}
                data-testid="sort-has-headers"
              />
              <Label htmlFor="sort-has-headers">My data has headers</Label>
            </div>

            {/* Sort Orientation */}
            <div className="flex items-center gap-2">
              <Label htmlFor="sort-orientation">Options:</Label>
              <Select
                id="sort-orientation"
                size="sm"
                value={orientation}
                onChange={(value) => setOrientation(value as SortOrientation)}
                options={ORIENTATION_OPTIONS}
                disabled={isApplying}
                data-testid="sort-orientation"
              />
            </div>
          </div>

          {/* Column Headers */}
          <div className="grid grid-cols-[1fr_120px_100px_120px] gap-2 text-label text-ss-text-secondary font-medium">
            <span>Column</span>
            <span>Sort On</span>
            <span>Order</span>
            <span>Actions</span>
          </div>

          {/* Sort Levels */}
          <div className="space-y-2">
            {levels.map((level, index) => (
              <div key={index} className="space-y-2">
                <div className="grid grid-cols-[1fr_120px_100px_120px] gap-2 items-center">
                  {/* Column Select */}
                  <Select
                    size="sm"
                    value={String(level.columnIndex)}
                    onChange={(value) => updateLevel(index, { columnIndex: Number(value) })}
                    options={columnOptions}
                    disabled={isApplying}
                    data-testid={`sort-level-${index}-column`}
                  />

                  {/* Sort On Select */}
                  <Select
                    size="sm"
                    value={level.sortBy}
                    onChange={(value) => updateLevel(index, { sortBy: value as SortBy })}
                    options={SORT_BY_OPTIONS}
                    disabled={isApplying}
                    data-testid={`sort-level-${index}-sort-on`}
                  />

                  {/* Order Select — value is derived: when a customListId
 is set we show "custom-list", otherwise the raw direction. */}
                  <Select
                    size="sm"
                    value={level.customListId !== undefined ? 'custom-list' : level.direction}
                    onChange={(next) => {
                      if (next === 'custom-list') {
                        const firstCustomList = customLists[0];
                        if (!firstCustomList) return;
                        // Switching into custom-list mode: default to first
                        // built-in list. Direction stays as 'asc' under the hood.
                        updateLevel(index, {
                          customListId: firstCustomList.id,
                          direction: 'asc',
                        });
                      } else {
                        // Switching back to plain asc/desc — clear customListId.
                        updateLevel(index, {
                          direction: next as SortDirection,
                          customListId: undefined,
                        });
                      }
                    }}
                    options={DIRECTION_OPTIONS}
                    disabled={isApplying}
                    data-testid={`sort-level-${index}-order`}
                  />

                  {/* Action Buttons */}
                  <div className="flex gap-1">
                    {/* Move Up */}
                    <IconButton
                      icon="chevron-up"
                      size="sm"
                      onClick={() => moveLevelUp(index)}
                      disabled={isApplying || index === 0}
                      title="Move level up"
                    />
                    {/* Move Down */}
                    <IconButton
                      icon="chevron-down"
                      size="sm"
                      onClick={() => moveLevelDown(index)}
                      disabled={isApplying || index === levels.length - 1}
                      title="Move level down"
                    />
                    {/* Copy Level */}
                    <IconButton
                      icon="document-list"
                      size="sm"
                      onClick={() => copyLevel(index)}
                      disabled={isApplying || !canAddLevel}
                      title="Copy level"
                    />
                    {/* Remove Button */}
                    <IconButton
                      icon="delete"
                      size="sm"
                      onClick={() => removeLevel(index)}
                      disabled={isApplying || levels.length <= 1}
                      title="Remove sort level"
                    />
                  </div>
                </div>
                {/* Secondary custom-list picker — only shown when this level
 is configured for a custom-list sort. */}
                {level.customListId !== undefined && (
                  <div className="grid grid-cols-[1fr_120px_100px_120px] gap-2 items-center">
                    <span />
                    <span />
                    <Select
                      size="sm"
                      value={level.customListId}
                      onChange={(value) => updateLevel(index, { customListId: value })}
                      options={customListOptions}
                      disabled={isApplying}
                      data-testid={`sort-level-${index}-custom-list`}
                    />
                    <span />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add Level Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={addLevel}
            disabled={isApplying || !canAddLevel}
          >
            + Add Level
          </Button>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={isApplying}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSort}
          disabled={isApplying}
          data-confirm-button="true"
        >
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
