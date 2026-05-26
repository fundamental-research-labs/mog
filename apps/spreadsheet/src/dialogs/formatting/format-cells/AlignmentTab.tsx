/**
 * Alignment Tab for Format Cells Dialog
 *
 * Provides Excel-parity controls for:
 * - Horizontal and vertical text alignment
 * - Text control options (wrap text, shrink to fit, merge cells)
 * - Text orientation/rotation
 * - Indent settings
 * - Reading order (bidirectional text)
 *
 * ARCHITECTURE: Draft + Apply Pattern with forwardRef
 * - Maintains local draft state for all user edits (no dispatch on every change)
 * - Exposes getChanges() ref method for parent dialog to call on Apply/OK
 * - Parent dialog owns ALL dispatch calls - this tab never calls dispatch directly
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Sections 1, 3, 9
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { Checkbox, Input, Label, RadioGroup, SectionLabel, Select } from '@mog/shell';
import type { CellFormat } from '@mog-sdk/contracts/core';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../../infra/context';
// =============================================================================
// Types
// =============================================================================

/**
 * Ref handle exposed by AlignmentTab for parent dialog to call.
 */
export interface AlignmentTabRef {
  /** Get the pending format changes to apply */
  getChanges: () => Partial<CellFormat>;
  /** Check if there are any changes to apply */
  hasChanges: () => boolean;
}

export interface AlignmentTabProps {
  /**
   * Current cell format (for initializing draft state).
   * Undefined values indicate mixed state across selection.
   */
  initialFormat?: Partial<CellFormat>;
}

// Use the exact types from CellFormat
type HorizontalAlign = NonNullable<CellFormat['horizontalAlign']>;
type VerticalAlign = NonNullable<CellFormat['verticalAlign']>;
type ReadingOrder = NonNullable<CellFormat['readingOrder']>;

// =============================================================================
// Constants
// =============================================================================

const HORIZONTAL_ALIGN_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'fill', label: 'Fill' },
  { value: 'justify', label: 'Justify' },
  { value: 'centerContinuous', label: 'Center Across Selection' },
  { value: 'distributed', label: 'Distributed' },
];

const VERTICAL_ALIGN_OPTIONS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'justify', label: 'Justify' },
  { value: 'distributed', label: 'Distributed' },
];

function normalizeVerticalAlignForDraft(
  value: CellFormat['verticalAlign'] | undefined,
): VerticalAlign | undefined {
  return (value as string | undefined) === 'center' ? 'middle' : value;
}

const READING_ORDER_OPTIONS = [
  { value: 'context', label: 'Context' },
  { value: 'ltr', label: 'Left-to-right' },
  { value: 'rtl', label: 'Right-to-left' },
];

// =============================================================================
// Component
// =============================================================================

/**
 * AlignmentTab - Cell alignment settings.
 *
 * Architecture:
 * - Uses forwardRef to expose getChanges() method to parent
 * - Parent dialog (FormatCellsDialog) owns the dispatch call
 * - Tab does NOT call dispatch - only accumulates changes locally
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */
export const AlignmentTab = forwardRef<AlignmentTabRef, AlignmentTabProps>(function AlignmentTab(
  { initialFormat },
  ref,
) {
  // Merge state derivation — inlined from the deleted use-merge hook
  // (Text formatting dispatch). Reads toolbarRanges (idle-gated) and
  // viewport merges for sync detection. The dialog's "Merge cells" checkbox
  // uses plain MERGE_CELLS (no center alignment) on toggle, matching Excel's
  // Format Cells > Alignment tab semantics.
  const dispatch = useDispatch();
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ranges = useUIStore((s) => s.toolbarRanges);

  const { isMerged, canMerge, canUnmerge, isSingleCell } = useMemo(() => {
    if (!ranges || ranges.length === 0) {
      return {
        isMerged: false,
        canMerge: false,
        canUnmerge: false,
        isSingleCell: true,
      };
    }
    const r = ranges[0];
    const startRow = Math.min(r.startRow, r.endRow);
    const startCol = Math.min(r.startCol, r.endCol);
    const endRow = Math.max(r.startRow, r.endRow);
    const endCol = Math.max(r.startCol, r.endCol);

    const ws = wb.getSheetById(activeSheetId);
    const viewportMerges = ws.viewport.getMerges();
    const findMergeForCell = (row: number, col: number) =>
      viewportMerges.find(
        (m) => row >= m.start_row && row <= m.end_row && col >= m.start_col && col <= m.end_col,
      ) ?? null;

    const single = startRow === endRow && startCol === endCol;
    if (single) {
      const merge = findMergeForCell(startRow, startCol);
      return {
        isMerged: merge !== null,
        canMerge: false,
        canUnmerge: merge !== null,
        isSingleCell: true,
      };
    }

    const originMerge = findMergeForCell(startRow, startCol);
    const exactMerged =
      originMerge !== null &&
      originMerge.start_row === startRow &&
      originMerge.start_col === startCol &&
      originMerge.end_row === endRow &&
      originMerge.end_col === endCol;

    let overlapsMerge = false;
    for (const region of viewportMerges) {
      if (
        region.start_row <= endRow &&
        region.end_row >= startRow &&
        region.start_col <= endCol &&
        region.end_col >= startCol
      ) {
        overlapsMerge = true;
        break;
      }
    }

    return {
      isMerged: exactMerged,
      canMerge: !exactMerged,
      canUnmerge: overlapsMerge,
      isSingleCell: false,
    };
  }, [wb, activeSheetId, ranges]);

  const toggleMerge = useCallback(() => {
    if (isMerged || canUnmerge) {
      dispatch('UNMERGE_CELLS');
    } else if (canMerge) {
      // Format Cells dialog "Merge cells" checkbox is plain merge (no center).
      dispatch('MERGE_CELLS');
    }
  }, [dispatch, isMerged, canUnmerge, canMerge]);

  // Draft state — undefined values must propagate (no `?? defaultValue`) so
  // controls can render mixed-state UI when initialFormat has stripped a key.
  const [draftFormat, setDraftFormat] = useState<Partial<CellFormat>>({
    horizontalAlign: initialFormat?.horizontalAlign,
    verticalAlign: normalizeVerticalAlignForDraft(initialFormat?.verticalAlign),
    indent: initialFormat?.indent,
    textRotation: initialFormat?.textRotation,
    readingOrder: initialFormat?.readingOrder,
  });

  // wrapText / shrinkToFit live as separate tri-state to preserve 'indeterminate'
  // through the checkbox change handler (booleans alone can't represent mixed).
  const [wrapText, setWrapText] = useState<boolean | 'indeterminate'>(() =>
    initialFormat?.wrapText === undefined ? 'indeterminate' : initialFormat.wrapText,
  );
  const [shrinkToFit, setShrinkToFit] = useState<boolean | 'indeterminate'>(() =>
    initialFormat?.shrinkToFit === undefined ? 'indeterminate' : initialFormat.shrinkToFit,
  );

  // Dirty tracking — getChanges() returns ONLY keys the user actually modified,
  // so unchanged mixed-state properties are not overwritten with a default.
  const dirtyRef = useRef(new Set<keyof CellFormat>());
  const markDirty = useCallback((key: keyof CellFormat) => {
    dirtyRef.current.add(key);
  }, []);

  // Indent is only enabled for Left/Right alignment. When horizontalAlign is
  // mixed (undefined), the indent input stays disabled to match Excel.
  const indentEnabled =
    draftFormat.horizontalAlign === 'left' || draftFormat.horizontalAlign === 'right';

  // ===========================================================================
  // Expose ref methods for parent dialog
  // ===========================================================================

  useImperativeHandle(
    ref,
    () => ({
      getChanges: () => {
        const changes: Partial<CellFormat> = {};
        for (const key of dirtyRef.current) {
          if (key === 'wrapText') {
            if (wrapText !== 'indeterminate') changes.wrapText = wrapText;
          } else if (key === 'shrinkToFit') {
            if (shrinkToFit !== 'indeterminate') changes.shrinkToFit = shrinkToFit;
          } else {
            const v = (draftFormat as Record<string, unknown>)[key];
            if (v !== undefined) (changes as Record<string, unknown>)[key] = v;
          }
        }
        return changes;
      },
      hasChanges: () => dirtyRef.current.size > 0,
    }),
    [draftFormat, wrapText, shrinkToFit],
  );

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const handleHorizontalAlignChange = useCallback(
    (value: string) => {
      markDirty('horizontalAlign');
      setDraftFormat((prev) => ({
        ...prev,
        horizontalAlign: value as HorizontalAlign,
      }));
    },
    [markDirty],
  );

  const handleVerticalAlignChange = useCallback(
    (value: string) => {
      markDirty('verticalAlign');
      setDraftFormat((prev) => ({
        ...prev,
        verticalAlign: value as VerticalAlign,
      }));
    },
    [markDirty],
  );

  const handleIndentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        markDirty('indent');
        setDraftFormat((prev) => ({ ...prev, indent: undefined }));
        return;
      }
      const value = parseInt(raw, 10);
      if (!isNaN(value) && value >= 0 && value <= 15) {
        markDirty('indent');
        setDraftFormat((prev) => ({
          ...prev,
          indent: value,
        }));
      }
    },
    [markDirty],
  );

  // Mutual exclusion (wrap XOR shrink): toggling one to true flips the other
  // to false, so BOTH keys must be marked dirty even though the user clicked
  // only one checkbox.
  const handleWrapTextChange = useCallback(
    (checked: boolean) => {
      markDirty('wrapText');
      setWrapText(checked);
      if (checked) {
        markDirty('shrinkToFit');
        setShrinkToFit(false);
      }
    },
    [markDirty],
  );

  const handleShrinkToFitChange = useCallback(
    (checked: boolean) => {
      markDirty('shrinkToFit');
      setShrinkToFit(checked);
      if (checked) {
        markDirty('wrapText');
        setWrapText(false);
      }
    },
    [markDirty],
  );

  const handleTextRotationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      if (raw === '') {
        markDirty('textRotation');
        setDraftFormat((prev) => ({ ...prev, textRotation: undefined }));
        return;
      }
      const value = parseInt(raw, 10);
      if (!isNaN(value)) {
        // Excel allows 0-180 degrees, or 255 for vertical stacking
        if ((value >= 0 && value <= 180) || value === 255) {
          markDirty('textRotation');
          setDraftFormat((prev) => ({
            ...prev,
            textRotation: value,
          }));
        }
      }
    },
    [markDirty],
  );

  const setRotationPreset = useCallback(
    (value: number) => {
      markDirty('textRotation');
      setDraftFormat((prev) => ({ ...prev, textRotation: value }));
    },
    [markDirty],
  );

  const handleReadingOrderChange = useCallback(
    (value: string) => {
      markDirty('readingOrder');
      setDraftFormat((prev) => ({
        ...prev,
        readingOrder: value as ReadingOrder,
      }));
    },
    [markDirty],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  const indentValue = draftFormat.indent === undefined ? '' : draftFormat.indent;
  const rotationValue =
    draftFormat.textRotation === undefined
      ? ''
      : draftFormat.textRotation === 255
        ? 0
        : draftFormat.textRotation;

  return (
    <div className="flex flex-col gap-4">
      {/* Text alignment */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Text alignment</SectionLabel>
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-1 flex-1">
            <Label htmlFor="horizontal-align">Horizontal:</Label>
            <Select
              id="horizontal-align"
              value={draftFormat.horizontalAlign}
              onChange={handleHorizontalAlignChange}
              options={HORIZONTAL_ALIGN_OPTIONS}
              placeholder=" "
            />
          </div>
          <div className="flex flex-col gap-1 w-24">
            <Label htmlFor="indent">Indent:</Label>
            <Input
              id="indent"
              type="number"
              min={0}
              max={15}
              value={indentValue}
              onChange={handleIndentChange}
              disabled={!indentEnabled}
              className="w-full"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="vertical-align">Vertical:</Label>
          <Select
            id="vertical-align"
            value={draftFormat.verticalAlign}
            onChange={handleVerticalAlignChange}
            options={VERTICAL_ALIGN_OPTIONS}
            placeholder=" "
          />
        </div>
      </div>

      {/* Text control */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Text control</SectionLabel>
        <div className="flex flex-col gap-2">
          <Checkbox
            checked={wrapText}
            onChange={(checked) => handleWrapTextChange(checked)}
            label="Wrap text"
          />
          <Checkbox
            checked={shrinkToFit}
            onChange={(checked) => handleShrinkToFitChange(checked)}
            label="Shrink to fit"
          />
          <div
            title={
              isSingleCell && !canUnmerge
                ? 'Select multiple cells to merge'
                : isMerged || canUnmerge
                  ? 'Unmerge cells'
                  : 'Merge selected cells'
            }
          >
            <Checkbox
              checked={isMerged}
              onChange={() => toggleMerge()}
              disabled={isSingleCell && !canUnmerge}
              label="Merge cells"
            />
          </div>
        </div>
      </div>

      {/* Text orientation */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Text orientation</SectionLabel>
        <div className="flex items-center gap-2">
          <Label htmlFor="text-rotation">Degrees:</Label>
          <Input
            id="text-rotation"
            type="number"
            min={0}
            max={180}
            value={rotationValue}
            onChange={handleTextRotationChange}
            className="w-20"
          />
          <span className="text-body-sm text-ss-text-tertiary">
            (0-90: counter-clockwise, 91-180: clockwise, 255: vertical)
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRotationPreset(0)}
            className="px-2 py-1 text-body-sm border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            0°
          </button>
          <button
            type="button"
            onClick={() => setRotationPreset(45)}
            className="px-2 py-1 text-body-sm border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            45°
          </button>
          <button
            type="button"
            onClick={() => setRotationPreset(135)}
            className="px-2 py-1 text-body-sm border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            -45°
          </button>
          <button
            type="button"
            onClick={() => setRotationPreset(90)}
            className="px-2 py-1 text-body-sm border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            90°
          </button>
          <button
            type="button"
            onClick={() => setRotationPreset(255)}
            className="px-2 py-1 text-body-sm border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            Vertical
          </button>
        </div>
      </div>

      {/* Reading order */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Reading order</SectionLabel>
        {/* RadioGroup requires `value: string`; pass '' as workaround for mixed
 state so no option is selected. */}
        <RadioGroup
          name="reading-order"
          value={draftFormat.readingOrder ?? ''}
          onChange={handleReadingOrderChange}
          options={READING_ORDER_OPTIONS}
        />
      </div>
    </div>
  );
});
