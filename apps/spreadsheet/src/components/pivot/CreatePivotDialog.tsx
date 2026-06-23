/**
 * CreatePivotDialog Component
 *
 * Simplified dialog for creating a new pivot table.
 * Only collects name and source range - field configuration
 * is done via the PivotFieldPanel after creation (Excel-style UX).
 *
 * This dialog subscribes to its own open state from UIStore to prevent
 * parent components from re-rendering when the dialog opens/closes.
 * (Render isolation per ARCHITECTURE-CHECKLIST.md Section 14)
 *
 * Location Selection (
 * - New Worksheet (default): Creates a dedicated sheet for the pivot table
 * - Existing Worksheet: User specifies sheet and cell reference for placement
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { PivotField } from '@mog-sdk/contracts/pivot';
import { parseCellAddress, parseCellRange } from '@mog/spreadsheet-utils/a1';
import { usePivotEditorActions } from '../../hooks/data/use-pivot-editor-actions';
import { useCoordinator } from '../../hooks/shared/use-coordinator';
import {
  useActiveSheetId,
  useIsPivotDialogOpen,
  useUIStore,
  useWorkbook,
} from '../../infra/context';
import type { PivotLocationMode } from '../../ui-store/slices/dialogs/pivot-dialog';
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
  RadioGroup,
  Select,
} from '@mog/shell/components/ui';
import { CollapsibleRangeInput } from '../ui/CollapsibleRangeInput';
import { MinimizableDialog } from '../ui/radix/MinimizableDialog';

// =============================================================================
// Types
// =============================================================================

// No props needed - dialog subscribes to its own state from UIStore

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse a cell reference like "A1" to row/col (0-indexed)
 */
export function parseCellRef(ref: string): { row: number; col: number } | null {
  const parsed = parseCellAddress(ref.trim());
  if (parsed?.sheetName) return null;
  if (!parsed || parsed.row < 0 || parsed.col < 0) return null;
  return parsed ? { row: parsed.row, col: parsed.col } : null;
}

/**
 * Parse a range string like "A1:D10" to CellRange
 */
export function parseRange(rangeStr: string): CellRange | null {
  const parsed = parseCellRange(rangeStr.trim());
  if (!parsed || parsed.isFullColumn || parsed.isFullRow) return null;
  if (parsed.startRow < 0 || parsed.startCol < 0 || parsed.endRow < 0 || parsed.endCol < 0) {
    return null;
  }

  return {
    startRow: Math.min(parsed.startRow, parsed.endRow),
    startCol: Math.min(parsed.startCol, parsed.endCol),
    endRow: Math.max(parsed.startRow, parsed.endRow),
    endCol: Math.max(parsed.startCol, parsed.endCol),
  };
}

function scrollCellIntoRenderedViewport(
  coordinator: ReturnType<typeof useCoordinator>,
  cell: { row: number; col: number },
): void {
  const geometry = coordinator.renderer.getGeometry();
  const viewport = coordinator.renderer.getViewport();
  const scrollPosition = viewport?.getScrollPosition();
  if (!geometry || !viewport || !scrollPosition) {
    coordinator.renderer.scrollToActiveCell(cell);
    return;
  }

  const dimensions = geometry.getPositionDimensions();
  const containerRect = geometry.getContainerRect();
  const cellAreaOffset = geometry.getCellAreaOffset();
  const visibleWidth = Math.max(0, containerRect.width - cellAreaOffset.x);
  const visibleHeight = Math.max(0, containerRect.height - cellAreaOffset.y);
  const cellLeft = dimensions.getColLeft(cell.col);
  const cellRight = cellLeft + dimensions.getColWidth(cell.col);
  const cellTop = dimensions.getRowTop(cell.row);
  const cellBottom = cellTop + dimensions.getRowHeight(cell.row);
  const nextX =
    cellRight > scrollPosition.x + visibleWidth
      ? Math.max(0, cellRight - visibleWidth)
      : cellLeft < scrollPosition.x
        ? cellLeft
        : scrollPosition.x;
  const nextY =
    cellBottom > scrollPosition.y + visibleHeight
      ? Math.max(0, cellBottom - visibleHeight)
      : cellTop < scrollPosition.y
        ? cellTop
        : scrollPosition.y;
  coordinator.input.inputCoordinator.scrollTo(nextX, nextY);
}

// =============================================================================
// Main Component
// =============================================================================

export function CreatePivotDialog() {
  // Dialog subscribes to its own open state - prevents SpreadsheetContent from re-rendering
  const isOpen = useIsPivotDialogOpen();
  const closePivotDialog = useUIStore((s) => s.closePivotDialog);
  const initialSourceRange = useUIStore((s) => s.pivot.initialSourceRange);
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const coordinator = useCoordinator();

  // Location selection state from UIStore
  const locationMode = useUIStore((s) => s.pivot.locationMode);
  const destinationSheetId = useUIStore((s) => s.pivot.destinationSheetId);
  const destinationCellRef = useUIStore((s) => s.pivot.destinationCellRef);
  const setLocationMode = useUIStore((s) => s.setLocationMode);
  const setDestinationSheet = useUIStore((s) => s.setDestinationSheet);
  const setDestinationCell = useUIStore((s) => s.setDestinationCell);
  const updatePivotDialogDraft = useUIStore((s) => s.updatePivotDialogDraft);

  // Get pivot editor actions - these are now internal to this component
  const { createPivotTable, detectFields, startEditingPivot } = usePivotEditorActions();

  // Build sheet options for dropdown via Workbook API (async)
  const [sheetOptions, setSheetOptions] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    async function loadSheetOptions() {
      const count = wb.sheetCount;
      const options: Array<{ value: string; label: string }> = [];
      for (let i = 0; i < count; i++) {
        const ws = await wb.getSheetByIndex(i);
        options.push({ value: ws.getSheetId(), label: await ws.getName() });
      }
      if (!cancelled) setSheetOptions(options);
    }
    loadSheetOptions();
    return () => {
      cancelled = true;
    };
  }, [wb]);

  // Get the display name for the selected destination sheet via Workbook API.
  const [destinationSheetName, setDestinationSheetName] = useState('');
  useEffect(() => {
    if (!destinationSheetId) {
      setDestinationSheetName('');
      return;
    }
    let cancelled = false;
    async function loadDestinationSheetName() {
      try {
        const ws = wb.getSheetById(destinationSheetId);
        const sheetName = await ws.getName();
        if (!cancelled) setDestinationSheetName(sheetName);
      } catch {
        if (!cancelled) setDestinationSheetName('');
      }
    }
    void loadDestinationSheetName();
    return () => {
      cancelled = true;
    };
  }, [wb, destinationSheetId]);

  // Form state - simplified to just name and range
  const [name, setName] = useState('PivotTable1');
  const [rangeStr, setRangeStr] = useState('');
  const [fields, setFields] = useState<PivotField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cellRefError, setCellRefError] = useState<string | null>(null);
  const destinationCellInputRef = useRef<HTMLInputElement>(null);

  const resolveSourceSheetId = useCallback(
    async (value: string) => {
      const sheetName = parseCellRange(value.trim())?.sheetName;
      if (!sheetName) return activeSheetId;
      const sourceSheet = await wb.getSheet(sheetName);
      return sourceSheet.sheetId;
    },
    [activeSheetId, wb],
  );

  // Initialize when opened, reset when closed
  useEffect(() => {
    if (isOpen) {
      // Initialize with selection range when dialog opens
      if (initialSourceRange) {
        setRangeStr(initialSourceRange);
        const range = parseRange(initialSourceRange);
        if (range) {
          void resolveSourceSheetId(initialSourceRange)
            .then((sourceSheetId) => detectFields(range, sourceSheetId))
            .then((detectedFields) => {
              setFields(detectedFields);
            });
        }
      }
      // Set initial destination sheet to active sheet when dialog opens
      if (!destinationSheetId && sheetOptions.length > 0) {
        // Default to active sheet for existing worksheet option
        setDestinationSheet(activeSheetId);
      }
    } else {
      // Reset when closed
      setName('PivotTable1');
      setRangeStr('');
      setFields([]);
      setError(null);
      setCellRefError(null);
    }
  }, [
    isOpen,
    initialSourceRange,
    detectFields,
    resolveSourceSheetId,
    destinationSheetId,
    sheetOptions.length,
    activeSheetId,
    setDestinationSheet,
  ]);

  // Handle range change
  const handleRangeChange = useCallback(
    (value: string) => {
      setRangeStr(value);
      updatePivotDialogDraft({ sourceRange: value });
      setError(null);

      const range = parseRange(value);
      if (range) {
        void resolveSourceSheetId(value)
          .then((sourceSheetId) => detectFields(range, sourceSheetId))
          .then((detectedFields) => {
            setFields(detectedFields);
          });
      } else if (value.includes(':')) {
        setError('Invalid range format. Use format like A1:D10');
        setFields([]);
      }
    },
    [detectFields, resolveSourceSheetId, updatePivotDialogDraft],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      updatePivotDialogDraft({ name: value });
    },
    [updatePivotDialogDraft],
  );

  // Handle location mode change
  const handleLocationModeChange = useCallback(
    (mode: string) => {
      setLocationMode(mode as PivotLocationMode);
      setCellRefError(null);
    },
    [setLocationMode],
  );

  // Handle destination cell reference change with validation
  const handleCellRefChange = useCallback(
    (value: string) => {
      const uppercaseValue = value.toUpperCase();
      setDestinationCell(uppercaseValue);

      // Validate the cell reference
      if (uppercaseValue.trim()) {
        const parsed = parseCellRef(uppercaseValue.trim());
        if (!parsed) {
          setCellRefError('Invalid cell reference. Use format like A1');
        } else {
          setCellRefError(null);
        }
      } else {
        setCellRefError(null);
      }
    },
    [setDestinationCell],
  );

  // Handle destination sheet change
  const handleSheetChange = useCallback(
    (value: string) => {
      setDestinationSheet(value);
    },
    [setDestinationSheet],
  );

  useLayoutEffect(() => {
    if (!isOpen || locationMode !== 'existingWorksheet') return;
    const input = destinationCellInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isOpen, locationMode]);

  // Handle create - creates pivot table and starts editing
  const handleCreate = useCallback(async () => {
    const range = parseRange(rangeStr);
    if (!range) {
      setError('Please enter a valid source range');
      return;
    }

    if (fields.length === 0) {
      setError('No fields detected in the selected range');
      return;
    }

    // Build output location based on selected mode
    const outputLocation =
      locationMode === 'newWorksheet'
        ? { mode: 'newWorksheet' as const }
        : {
            mode: 'existingWorksheet' as const,
            sheetId: destinationSheetId ?? activeSheetId,
            cell: parseCellRef(destinationCellRef.trim()) ?? { row: 0, col: 0 },
          };
    const sourceSheetId = await resolveSourceSheetId(rangeStr);

    // Create pivot table with location selection
    // For "New Worksheet" mode, this atomically creates both the sheet AND the pivot
    // in a single Yjs transaction for proper undo behavior
    const { config, outputSheetId } = await createPivotTable(
      name,
      range,
      sourceSheetId,
      outputLocation,
    );

    // Start editing the newly created pivot
    startEditingPivot(config.id);
    closePivotDialog();
    if (outputSheetId === activeSheetId) {
      const followCell = {
        row: config.outputLocation.row,
        col: config.outputLocation.col + 3,
      };
      scrollCellIntoRenderedViewport(coordinator, followCell);
      window.requestAnimationFrame(() => scrollCellIntoRenderedViewport(coordinator, followCell));
    }
  }, [
    name,
    rangeStr,
    fields,
    locationMode,
    destinationSheetId,
    destinationCellRef,
    createPivotTable,
    activeSheetId,
    coordinator,
    resolveSourceSheetId,
    startEditingPivot,
    closePivotDialog,
  ]);

  // Handle close
  const handleClose = useCallback(() => {
    closePivotDialog();
  }, [closePivotDialog]);

  // Handle Ctrl+Enter to submit (Escape is handled by Dialog's FocusTrap)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        void handleCreate();
      }
    },
    [handleCreate],
  );

  // Early return if not open - prevents expensive rendering
  // All hooks must be called before this point (rules of hooks)
  if (!isOpen) return null;

  const isExistingWorksheetLocation = locationMode === 'existingWorksheet';

  // Validate location for existing worksheet mode
  const isLocationValid =
    locationMode === 'newWorksheet' ||
    (isExistingWorksheetLocation &&
      destinationSheetId &&
      destinationCellRef.trim() &&
      !cellRefError);

  const canCreate =
    name.trim() && rangeStr.trim() && fields.length > 0 && !error && isLocationValid;

  // Build the combined location display (e.g., "Sheet2!A1")
  const locationDisplay =
    isExistingWorksheetLocation && destinationSheetName && destinationCellRef
      ? `${destinationSheetName}!${destinationCellRef}`
      : '';

  return (
    <MinimizableDialog
      open={isOpen}
      onClose={handleClose}
      dialogId="create-pivot-dialog"
      title="Create Pivot Table"
      width={560}
    >
      <DialogHeader onClose={handleClose}>Create Pivot Table</DialogHeader>

      <DialogBody className="p-6">
        {/* Keyboard handler wrapper for Ctrl+Enter submit */}
        <div onKeyDown={handleKeyDown}>
          {/* Name */}
          <div className="mb-6">
            <Label className="mb-2">Name</Label>
            <Input
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter pivot table name"
              data-pivot-target="dialog-input"
              data-pivot-input="name"
            />
          </div>

          {/* Source Range */}
          <div className="mb-6">
            <Label className="mb-2">Source Data Range</Label>
            <CollapsibleRangeInput
              value={rangeStr}
              onChange={handleRangeChange}
              dialogId="create-pivot-dialog"
              inputId="source-range"
              label="Source Data Range"
              placeholder="e.g., Data!B2:E100"
              error={!!error}
              data-pivot-target="dialog-input"
              data-pivot-input="source-range"
            />
            {error && <div className="mt-1 text-body text-ss-error">{error}</div>}
            {fields.length > 0 && (
              <div className="mt-2 p-3 bg-ss-surface-secondary rounded text-body text-ss-text-secondary">
                Detected <span className="font-medium text-ss-text">{fields.length}</span> fields:{' '}
                {fields.map((f) => f.name).join(', ')}
              </div>
            )}
          </div>

          {/* Location Selection */}
          <div className="mb-6">
            <Label className="mb-3">Choose where to place the pivot table report</Label>

            <RadioGroup
              name="pivot-location"
              value={locationMode}
              onChange={handleLocationModeChange}
              options={[
                { value: 'newWorksheet', label: 'New Worksheet' },
                { value: 'existingWorksheet', label: 'Existing Worksheet' },
              ]}
              aria-label="Pivot table location"
            />

            <fieldset
              disabled={!isExistingWorksheetLocation}
              aria-disabled={!isExistingWorksheetLocation}
              className={`mt-3 ml-6 space-y-3 ${isExistingWorksheetLocation ? '' : 'opacity-60'}`}
            >
              {/* Sheet Selection */}
              <div className="flex items-center gap-3">
                <Label className="w-16 shrink-0">Sheet:</Label>
                <Select
                  options={sheetOptions}
                  value={destinationSheetId ?? ''}
                  onChange={handleSheetChange}
                  disabled={!isExistingWorksheetLocation}
                  className="flex-1"
                  size="sm"
                />
              </div>

              {/* Cell Reference Input */}
              <div className="flex items-center gap-3">
                <Label className="w-16 shrink-0">Cell:</Label>
                <CollapsibleRangeInput
                  ref={destinationCellInputRef}
                  value={destinationCellRef}
                  onChange={(value) => handleCellRefChange(value)}
                  dialogId="create-pivot-dialog"
                  inputId="destination-cell"
                  label="Destination cell"
                  placeholder="e.g., A1"
                  error={!!cellRefError}
                  disabled={!isExistingWorksheetLocation}
                  className="flex-1"
                  data-pivot-target="dialog-input"
                  data-pivot-input="destination-cell"
                />
              </div>

              {/* Cell Reference Error */}
              {cellRefError && (
                <div className="ml-[76px] text-body text-ss-error">{cellRefError}</div>
              )}

              {/* Combined Location Display */}
              {locationDisplay && !cellRefError && (
                <div className="ml-[76px] text-body text-ss-text-secondary">
                  Location: <span className="font-medium text-ss-text">{locationDisplay}</span>
                </div>
              )}
            </fieldset>
          </div>

          {/* Guidance */}
          {fields.length > 0 && (
            <div className="p-3 bg-ss-surface-secondary rounded text-body text-ss-text-secondary">
              After creating, use the Field Panel to configure rows, columns, and values.
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate} disabled={!canCreate}>
          Create Pivot Table
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}
