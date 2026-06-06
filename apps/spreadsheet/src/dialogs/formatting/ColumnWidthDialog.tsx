/**
 * Column Width Dialog
 *
 * Sets a custom pixel column width for the selected columns.
 *
 * Self-contained, action-bus driven — symmetric counterpart to RowHeightDialog.
 * Subscribes to `columnWidthDialogOpen`, reads selection + current pixel width
 * itself, dispatches `APPLY_COLUMN_WIDTH` on OK.
 *
 * Mounted by `chrome/layers/DialogLayer.tsx` via `ColumnWidthDialogWrapper`.
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
import { DEFAULT_COL_WIDTH } from '@mog-sdk/contracts/rendering';

const DEFAULT_COLUMN_WIDTH = DEFAULT_COL_WIDTH;
const MIN_COLUMN_WIDTH = 1;
const MAX_COLUMN_WIDTH = 1000;

function countSelectedColumns(ranges: readonly { startCol: number; endCol: number }[]): number {
  const set = new Set<number>();
  for (const r of ranges) {
    for (let col = r.startCol; col <= r.endCol; col++) set.add(col);
  }
  return set.size;
}

export function ColumnWidthDialog() {
  const deps = useActionDependencies();
  const isOpen = useUIStore((s) => s.columnWidthDialogOpen);
  const ranges = useSelectionRanges();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();

  const selectedColumnCount = countSelectedColumns(ranges);
  const firstSelectedCol = ranges[0]?.startCol ?? 0;

  const [widthValue, setWidthValue] = useState<string>(String(DEFAULT_COLUMN_WIDTH));
  const [applyToAll, setApplyToAll] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsedWidth = parseFloat(widthValue);
  const isValid =
    !isNaN(parsedWidth) && parsedWidth >= MIN_COLUMN_WIDTH && parsedWidth <= MAX_COLUMN_WIDTH;
  const hasError = widthValue.trim() !== '' && !isValid;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setApplyToAll(selectedColumnCount > 1);

    (async () => {
      try {
        const ws = workbook.getSheetById(activeSheetId);
        const current = await ws.layout.getColumnWidth(firstSelectedCol);
        if (!cancelled) setWidthValue(String(Math.round(current)));
      } catch {
        if (!cancelled) setWidthValue(String(DEFAULT_COLUMN_WIDTH));
      }
    })();

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);

    return () => {
      cancelled = true;
    };
  }, [isOpen, firstSelectedCol, selectedColumnCount, workbook, activeSheetId]);

  const handleOk = useCallback(() => {
    if (!isValid) return;
    dispatch('APPLY_COLUMN_WIDTH', deps, { width: parsedWidth, applyToAll });
    dispatch('CLOSE_COLUMN_WIDTH_DIALOG', deps);
  }, [isValid, parsedWidth, applyToAll, deps]);

  const handleCancel = useCallback(() => {
    dispatch('CLOSE_COLUMN_WIDTH_DIALOG', deps);
  }, [deps]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setWidthValue(value);
    }
  }, []);

  if (!isOpen) return null;

  const showMultiColumnOption = selectedColumnCount > 1;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleCancel}
      dialogId="column-width-dialog"
      width={320}
      initialFocusRef={inputRef}
    >
      <DialogHeader onClose={handleCancel}>Column Width</DialogHeader>

      <DialogBody>
        <div className="flex items-center gap-3 mb-4">
          <Label htmlFor="column-width-input" className="mb-0 whitespace-nowrap">
            Column width:
          </Label>
          <Input
            ref={inputRef}
            id="column-width-input"
            type="text"
            value={widthValue}
            onChange={handleInputChange}
            error={hasError}
            className="w-20 text-right py-2"
            aria-invalid={hasError}
            aria-describedby={hasError ? 'column-width-error' : 'column-width-helper'}
          />
          <span className="text-body-sm text-ss-text-secondary">pixels</span>
        </div>

        {hasError && (
          <div id="column-width-error" className="text-caption text-ss-error mt-1">
            Please enter a value between {MIN_COLUMN_WIDTH} and {MAX_COLUMN_WIDTH}
          </div>
        )}

        {!hasError && (
          <div id="column-width-helper" className="text-caption text-ss-text-secondary mt-2">
            Valid range: {MIN_COLUMN_WIDTH} - {MAX_COLUMN_WIDTH} pixels
          </div>
        )}

        {showMultiColumnOption && (
          <div className="mt-3">
            <Checkbox
              checked={applyToAll}
              onChange={(checked) => setApplyToAll(checked)}
              label={`Apply to all selected columns (${selectedColumnCount} columns)`}
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
 * Wrapper that only mounts ColumnWidthDialog when it's open.
 */
export function ColumnWidthDialogWrapper() {
  const isOpen = useUIStore((s) => s.columnWidthDialogOpen);
  if (!isOpen) return null;
  return <ColumnWidthDialog />;
}
