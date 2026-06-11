/**
 * Insert Table Dialog
 *
 * A dialog for creating/inserting tables with:
 * - Range selection (auto-populated from current selection)
 * - "My table has headers" checkbox
 * - Table style selection with preview
 * - Range preview highlight on sheet
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useActiveSheetId,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import { getTableStyleColors } from '@mog/grid-renderer';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';
// (B3a): TablesCore.getTableAtCell and createTable replaced with Worksheet API.
// PERFORMANCE: Use granular hooks instead of useSelection() to avoid re-renders
// on every mouse move during selection drag. Dialogs only need selection data
// when opened, not real-time updates during drag operations.
import {
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Label,
} from '@mog/shell';
import { scheduleDialogAction } from './dialog-action-scheduler';

// =============================================================================
// Types
// =============================================================================

interface InsertTableDialogProps {
  /** Called when a table is created */
  onInsertTable?: (options: {
    range: { startRow: number; startCol: number; endRow: number; endCol: number };
    hasHeaders: boolean;
    stylePreset: TableStylePreset;
  }) => void;
}

// =============================================================================
// Style Presets for Preview
// =============================================================================

const STYLE_PRESETS: { name: TableStylePreset; label: string }[] = [
  { name: 'light2', label: 'Blue Light' },
  { name: 'light3', label: 'Orange Light' },
  { name: 'light7', label: 'Green Light' },
  { name: 'medium2', label: 'Blue Medium' },
  { name: 'medium3', label: 'Orange Medium' },
  { name: 'medium7', label: 'Green Medium' },
  { name: 'dark2', label: 'Blue Dark' },
  { name: 'dark3', label: 'Orange Dark' },
  { name: 'dark7', label: 'Green Dark' },
];

// =============================================================================
// Range Validation
// =============================================================================

/**
 * Parse an A1-style range reference (e.g., "A1:D10").
 * Returns null if invalid.
 */
function parseA1Range(
  ref: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const rangeMatch = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!rangeMatch) return null;

  const [, startColStr, startRowStr, endColStr, endRowStr] = rangeMatch;

  const letterToCol = (s: string): number => {
    let col = 0;
    for (let i = 0; i < s.length; i++) {
      col = col * 26 + (s.charCodeAt(i) - 64);
    }
    return col - 1; // 0-indexed
  };

  const startCol = letterToCol(startColStr.toUpperCase());
  const startRow = parseInt(startRowStr, 10) - 1; // 0-indexed
  const endCol = letterToCol(endColStr.toUpperCase());
  const endRow = parseInt(endRowStr, 10) - 1;

  if (startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) {
    return null;
  }

  return { startRow, startCol, endRow, endCol };
}

/**
 * Format a range as A1 notation.
 */
function formatA1Range(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  return `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${range.endRow + 1}`;
}

function formatOptionalA1Range(
  range: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null,
): string {
  return range ? formatA1Range(range) : '';
}

// =============================================================================
// Style Preview Component
// =============================================================================

function StylePreview({
  preset,
  label,
  selected,
  onClick,
}: {
  preset: TableStylePreset;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const colors = getTableStyleColors(preset);

  return (
    <div
      className={`border-2 rounded p-1 cursor-pointer transition-colors ${
        selected ? 'border-ss-primary' : 'border-transparent hover:border-ss-border'
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="w-full h-12 rounded-ss-sm flex flex-col overflow-hidden">
        <div
          className="flex-1 flex items-center justify-center text-hint font-semibold"
          style={{
            backgroundColor: colors.headerBackground,
            color: colors.headerText,
          }}
        >
          Header
        </div>
        <div
          className="flex-1 flex items-center justify-center text-hint"
          style={{
            backgroundColor: colors.rowBackground1,
            color: colors.dataText,
          }}
        >
          Data
        </div>
        <div
          className="flex-1 flex items-center justify-center text-hint"
          style={{
            backgroundColor: colors.rowBackground2,
            color: colors.dataText,
          }}
        >
          Data
        </div>
      </div>
      <div className="text-caption text-center mt-1 text-ss-text-secondary">{label}</div>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function InsertTableDialog({ onInsertTable }: InsertTableDialogProps) {
  // State
  const isOpen = useUIStore((s) => s.insertTableDialogOpen);
  const closeDialog = useUIStore((s) => s.closeInsertTableDialog);
  // Preview range setter
  const setTablePreviewRange = useUIStore((s) => s.setTablePreviewRange);
  // Range pre-seeded by the INSERT_TABLE action handler (Excel current-region
  // auto-expansion). When set, takes precedence over the live selection so the
  // dialog opens with the expanded data block instead of just the active cell.
  const initialRange = useUIStore((s) => s.insertTableInitialRange);
  const initialHasHeaders = useUIStore((s) => s.insertTableInitialHasHeaders);
  const initialStylePreset = useUIStore((s) => s.insertTableInitialStylePreset);
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const initialRangeInput = formatOptionalA1Range(initialRange);

  // Form state
  const [rangeInput, setRangeInput] = useState(() => initialRangeInput);
  const [hasHeaders, setHasHeaders] = useState(() => initialHasHeaders);
  const [selectedStyle, setSelectedStyle] = useState<TableStylePreset>(
    () => initialStylePreset ?? 'medium2',
  );
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Initialize range when dialog opens from the action-captured snapshot.
  useEffect(() => {
    if (!isOpen) return;
    const seedRange = initialRange;
    if (!seedRange) return;
    const formatted = formatA1Range({
      startRow: seedRange.startRow,
      startCol: seedRange.startCol,
      endRow: seedRange.endRow,
      endCol: seedRange.endCol,
    });
    setRangeInput(formatted);
    setRangeError(null);
    setTablePreviewRange({
      startRow: seedRange.startRow,
      startCol: seedRange.startCol,
      endRow: seedRange.endRow,
      endCol: seedRange.endCol,
    });
    setHasHeaders(initialHasHeaders);
    setSelectedStyle(initialStylePreset ?? 'medium2');
  }, [isOpen, initialRange, initialHasHeaders, initialStylePreset, setTablePreviewRange]);

  // Validate range input
  const validateRange = useCallback((value: string): string | null => {
    if (!value.trim()) {
      return 'Range is required';
    }
    const parsed = parseA1Range(value.trim());
    if (!parsed) {
      return 'Invalid range format. Use format like A1:D10';
    }
    // Check minimum size for table
    const rows = parsed.endRow - parsed.startRow + 1;
    const cols = parsed.endCol - parsed.startCol + 1;
    if (rows < 1 || cols < 1) {
      return 'Table must have at least 1 row and 1 column';
    }
    return null;
  }, []);

  // Handle range input change
  // Also update preview range when user types
  const handleRangeChange = useCallback(
    (value: string) => {
      const upperValue = value.toUpperCase();
      setRangeInput(upperValue);
      setRangeError(validateRange(upperValue));

      // Update preview range as user edits
      const parsed = parseA1Range(upperValue);
      if (parsed) {
        setTablePreviewRange(parsed);
      }
    },
    [validateRange, setTablePreviewRange],
  );

  // Parse current range
  const parsedRange = useMemo(() => parseA1Range(rangeInput), [rangeInput]);

  // Handle OK click
  const handleOk = useCallback(() => {
    const error = validateRange(rangeInput);
    if (error || !parsedRange) {
      setRangeError(error || 'Invalid range');
      return;
    }

    closeDialog();
    scheduleDialogAction(() => {
      // Create the table
      if (onInsertTable) {
        return onInsertTable({
          range: parsedRange,
          hasHeaders,
          stylePreset: selectedStyle,
        });
      }

      // Wrap table creation in an undo group so Cmd+Z reverts the entire
      // operation (table creation + style) in a single step.
      const ws = wb.getSheetById(activeSheetId);
      const rangeA1 = formatA1Range(parsedRange);
      return wb
        .undoGroup(async () => {
          await ws.tables.add(rangeA1, { hasHeaders, style: selectedStyle });
        })
        .catch((err: unknown) => {
          console.error('Failed to create table:', err);
        });
    });
  }, [
    rangeInput,
    parsedRange,
    hasHeaders,
    selectedStyle,
    validateRange,
    onInsertTable,
    wb,
    activeSheetId,
    closeDialog,
  ]);

  // Handle Cancel/Close
  const handleClose = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  if (!isOpen) return null;

  return (
    <MinimizableDialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleClose}
      dialogId="insert-table-dialog"
      title="Create Table"
      width="md"
    >
      <DialogHeader onClose={handleClose}>Create Table</DialogHeader>

      <DialogBody>
        {/* Range Input */}
        <FormField
          label="Where is the data for your table?"
          htmlFor="table-range"
          error={rangeError ?? undefined}
        >
          <CollapsibleRangeInput
            value={rangeInput}
            onChange={handleRangeChange}
            dialogId="insert-table-dialog"
            inputId="table-range"
            placeholder="e.g., A1:D10"
            label="Table range"
            error={!!rangeError}
            autoFocus
          />
        </FormField>

        {/* Has Headers Checkbox */}
        <div className="mb-4">
          <Checkbox
            checked={hasHeaders}
            onChange={(checked) => setHasHeaders(checked)}
            label="My table has headers"
            data-testid="insert-table-has-headers"
          />
        </div>

        {/* Style Selection */}
        <div className="mt-4">
          <Label className="mb-2">Table Style</Label>
          <div className="grid grid-cols-3 gap-2">
            {STYLE_PRESETS.map((preset) => (
              <StylePreview
                key={preset.name}
                preset={preset.name}
                label={preset.label}
                selected={selectedStyle === preset.name}
                onClick={() => setSelectedStyle(preset.name)}
              />
            ))}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleOk}
          disabled={!!rangeError}
          data-testid="insert-table-ok"
        >
          OK
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts InsertTableDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function InsertTableDialogWrapper() {
  const isOpen = useUIStore((s) => s.insertTableDialogOpen);
  if (!isOpen) return null;
  return <InsertTableDialog />;
}
