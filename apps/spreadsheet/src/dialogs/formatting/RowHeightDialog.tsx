/**
 * Row Height Dialog
 *
 * Sets a custom pixel row height for the selected rows.
 *
 * Self-contained, action-bus driven:
 * - Subscribes to `rowHeightDialogOpen` from UIStore for visibility.
 * - Reads selection ranges and the current row's height itself, so callers
 * only need to dispatch `OPEN_ROW_HEIGHT_DIALOG`.
 * - On OK, dispatches `APPLY_ROW_HEIGHT` so undo/redo and read-only gating
 * flow through the unified action system.
 *
 * Mounted by `chrome/layers/DialogLayer.tsx` via the `RowHeightDialogWrapper`
 * mount-when-open shim, parity with `FormatCellsDialogWrapper`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dispatch,
  useActionDependencies,
  useSelectionRanges,
  useUIStore,
  useWorkbook,
  useActiveSheetId,
} from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
} from '@mog/shell';
import { DEFAULT_ROW_HEIGHT } from '@mog-sdk/contracts/rendering';

const MIN_ROW_HEIGHT = 1;
const MAX_ROW_HEIGHT = 409;

function countSelectedRows(ranges: readonly { startRow: number; endRow: number }[]): number {
  const set = new Set<number>();
  for (const r of ranges) {
    for (let row = r.startRow; row <= r.endRow; row++) set.add(row);
  }
  return set.size;
}

export function RowHeightDialog() {
  const deps = useActionDependencies();
  const isOpen = useUIStore((s) => s.rowHeightDialogOpen);
  const ranges = useSelectionRanges();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();

  const selectedRowCount = countSelectedRows(ranges);
  const firstSelectedRow = ranges[0]?.startRow ?? 0;

  const [heightValue, setHeightValue] = useState<string>(String(DEFAULT_ROW_HEIGHT));
  const [applyToAll, setApplyToAll] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsedHeight = parseFloat(heightValue);
  const isValid =
    !isNaN(parsedHeight) && parsedHeight >= MIN_ROW_HEIGHT && parsedHeight <= MAX_ROW_HEIGHT;
  const hasError = heightValue.trim() !== '' && !isValid;

  // Read the current row height for the first selected row when opening
  // and seed the input with it. Falls back to DEFAULT_ROW_HEIGHT on failure.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setApplyToAll(selectedRowCount > 1);

    (async () => {
      try {
        const ws = workbook.getSheetById(activeSheetId);
        const current = await ws.layout.getRowHeight(firstSelectedRow);
        if (!cancelled) setHeightValue(String(Math.round(current)));
      } catch {
        if (!cancelled) setHeightValue(String(DEFAULT_ROW_HEIGHT));
      }
    })();

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);

    return () => {
      cancelled = true;
    };
  }, [isOpen, firstSelectedRow, selectedRowCount, workbook, activeSheetId]);

  const handleOk = useCallback(() => {
    if (!isValid) return;
    dispatch('APPLY_ROW_HEIGHT', deps, { height: parsedHeight, applyToAll });
    dispatch('CLOSE_ROW_HEIGHT_DIALOG', deps);
  }, [isValid, parsedHeight, applyToAll, deps]);

  const handleCancel = useCallback(() => {
    dispatch('CLOSE_ROW_HEIGHT_DIALOG', deps);
  }, [deps]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setHeightValue(value);
    }
  }, []);

  if (!isOpen) return null;

  const showMultiRowOption = selectedRowCount > 1;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="row-height-dialog"
      width={320}
    >
      <DialogHeader onClose={handleCancel}>Row Height</DialogHeader>

      <DialogBody>
        <div className="flex items-center gap-3 mb-4">
          <Label htmlFor="row-height-input" className="mb-0 whitespace-nowrap">
            Row height:
          </Label>
          <Input
            ref={inputRef}
            id="row-height-input"
            type="text"
            value={heightValue}
            onChange={handleInputChange}
            error={hasError}
            className="w-20 text-right py-2"
            aria-invalid={hasError}
            aria-describedby={hasError ? 'row-height-error' : 'row-height-helper'}
          />
          <span className="text-body-sm text-ss-text-secondary">pixels</span>
        </div>

        {hasError && (
          <div id="row-height-error" className="text-caption text-ss-error mt-1">
            Please enter a value between {MIN_ROW_HEIGHT} and {MAX_ROW_HEIGHT}
          </div>
        )}

        {!hasError && (
          <div id="row-height-helper" className="text-caption text-ss-text-secondary mt-2">
            Valid range: {MIN_ROW_HEIGHT} - {MAX_ROW_HEIGHT} pixels
          </div>
        )}

        {showMultiRowOption && (
          <div className="mt-3">
            <Checkbox
              checked={applyToAll}
              onChange={(checked) => setApplyToAll(checked)}
              label={`Apply to all selected rows (${selectedRowCount} rows)`}
            />
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!isValid}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Wrapper that only mounts RowHeightDialog when it's open.
 * Eliminates unnecessary re-renders when the dialog is closed.
 */
export function RowHeightDialogWrapper() {
  const isOpen = useUIStore((s) => s.rowHeightDialogOpen);
  if (!isOpen) return null;
  return <RowHeightDialog />;
}
