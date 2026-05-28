/**
 * Format Cells Dialog (Ctrl+1)
 *
 * Main tabbed dialog for cell formatting with 6 tabs:
 * - Number: Number format selection (implemented)
 * - Alignment: Text alignment and orientation (implemented)
 * - Font: Font styling (implemented)
 * - Border: Cell borders (implemented)
 * - Fill: Background colors and patterns (implemented)
 * - Protection: Cell locking (implemented)
 *
 * Architecture:
 * - Uses Draft + Apply pattern: changes stored in UIStore, applied via dispatch()
 * - Dialog managed by UIStore formatCellsDialogOpen state
 * - Each tab exposes getChanges() ref method, parent calls on Apply/OK
 * - Parent dialog owns ALL dispatch calls - tabs never call dispatch directly
 *
 */

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, TabPanel, Tabs } from '@mog/shell';
import type { CellFormat, NumberFormatType } from '@mog-sdk/contracts/core';
import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  dispatch,
  useActionDependencies,
  useActiveCell,
  useUIStore,
  useWorkbook,
} from '../../internal-api';
import { getRecentColors } from '../../infra/styles/recent-colors';
import {
  buildMergedFormat,
  detectMixedProperties,
  MAX_CELLS_FOR_MIXED_SCAN,
  totalCellCount,
  TRACKED_PROPERTIES,
} from './format-cells/mixed-state';
import {
  AlignmentTab,
  BorderTab,
  FillTab,
  FontTab,
  ProtectionTab,
  type AlignmentTabRef,
  type BorderTabRef,
  type FillTabRef,
  type FontTabRef,
  type ProtectionTabRef,
} from './format-cells';
import { NumberFormatPanel } from './NumberFormatPanel';
import type { FormatCellsTabId } from '../../ui-store/slices/core/misc';

// =============================================================================
// Types
// =============================================================================

// No props needed - dialog subscribes to its own open state from UIStore

type TabId = FormatCellsTabId;

// =============================================================================
// Component
// =============================================================================

export function FormatCellsDialog() {
  // Dialog subscribes to its own open state - prevents SpreadsheetContent from re-rendering
  // when this dialog opens/closes (render isolation per ARCHITECTURE-CHECKLIST.md Section 14)
  const open = useUIStore((s) => s.formatCellsDialogOpen);
  const initialTab = useUIStore((s) => s.formatCellsDialogInitialTab);
  const deps = useActionDependencies();
  const wb = useWorkbook();
  const recentFormats = useUIStore((s) => s.recentNumberFormats);
  const setPendingNumberFormat = useUIStore((s) => s.setPendingNumberFormat);
  const setPendingAlignmentFormat = useUIStore((s) => s.setPendingAlignmentFormat);
  const setPendingFontFormat = useUIStore((s) => s.setPendingFontFormat);
  const setPendingBorderFormat = useUIStore((s) => s.setPendingBorderFormat);
  const setPendingBorderPreset = useUIStore((s) => s.setPendingBorderPreset);
  const setPendingFillFormat = useUIStore((s) => s.setPendingFillFormat);
  const setPendingProtectionFormat = useUIStore((s) => s.setPendingProtectionFormat);

  const effectiveInitialTab = initialTab ?? 'number';
  const [activeTab, setActiveTab] = useState<TabId>(effectiveInitialTab);

  // Recent colors from localStorage for color pickers
  const [recentFontColors, setRecentFontColors] = useState(() => getRecentColors('font'));
  const [recentFillColors, setRecentFillColors] = useState(() => getRecentColors('fill'));
  const [recentBorderColors, setRecentBorderColors] = useState(() => getRecentColors('border'));

  // Handlers for immediate color tracking when colors are picked (before Apply)
  const handleFontColorSelect = useCallback(
    (color: string) => {
      dispatch('TRACK_RECENT_COLOR', deps, { type: 'font', color });
      setRecentFontColors(getRecentColors('font'));
    },
    [deps],
  );

  const handleFillColorSelect = useCallback(
    (color: string) => {
      dispatch('TRACK_RECENT_COLOR', deps, { type: 'fill', color });
      setRecentFillColors(getRecentColors('fill'));
    },
    [deps],
  );

  const handleBorderColorSelect = useCallback(
    (color: string) => {
      dispatch('TRACK_RECENT_COLOR', deps, { type: 'border', color });
      setRecentBorderColors(getRecentColors('border'));
    },
    [deps],
  );

  // Async format preview using unified Worksheet API
  const formatPreviewFn = useCallback(
    async (formatCode: string, value: number) => {
      const ws = wb.activeSheet;
      const entries = [{ value: { type: 'Number' as const, value }, formatCode }];
      const results = await ws.formatValues(entries);
      return results[0] ?? String(value);
    },
    [wb],
  );

  // Refs for tab components to get their changes on Apply/OK
  const alignmentTabRef = useRef<AlignmentTabRef>(null);
  const fontTabRef = useRef<FontTabRef>(null);
  const borderTabRef = useRef<BorderTabRef>(null);
  const fillTabRef = useRef<FillTabRef>(null);
  const protectionTabRef = useRef<ProtectionTabRef>(null);

  // The dialog opens with focus on the Number tab's category listbox so
  // ArrowDown immediately walks the list. Without this Radix lands focus
  // on the header close button, swallowing the first arrow keystroke.
  const numberCategoryListboxRef = useRef<HTMLDivElement | null>(null);

  const pendingNumberFormatRef = useRef<{ format: string; type: NumberFormatType } | null>(null);
  const [pendingNumberFormat, setPendingNumberFormatDraft] = useState<{
    format: string;
    type: NumberFormatType;
  } | null>(null);

  // Get current selection for initial format values
  // PERFORMANCE: Use granular hook - only subscribe to activeCell, not full selection
  const { activeCell } = useActiveCell();
  const toolbarRanges = useUIStore((s) => s.toolbarRanges);

  // Async fetch of active cell format + multi-cell merge for mixed-state detection.
  // - `cellFormat` is the merged Partial<CellFormat>: agreed properties keep
  // the active cell's resolved value; properties that disagree across the
  // selection are stripped to undefined so tabs render indeterminate /
  // placeholder for them.
  // - For a single 1x1 selection (the common case) we skip the multi-cell scan
  // entirely and pass the resolved format through unchanged.
  const [cellFormat, setCellFormat] = useState<Partial<CellFormat> | undefined>(undefined);
  const [sampleValue, setSampleValue] = useState<number>(1234.5);

  useEffect(() => {
    if (open) {
      setActiveTab(effectiveInitialTab);
      pendingNumberFormatRef.current = null;
      setPendingNumberFormatDraft(null);
    }
  }, [open, effectiveInitialTab]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const ws = wb.activeSheet;

    const fetchFormat = async (): Promise<{
      merged: Partial<CellFormat>;
      sample: number;
    }> => {
      const [base, cellData] = await Promise.all([
        ws.formats.get(activeCell.row, activeCell.col),
        ws.getCell(activeCell.row, activeCell.col),
      ]);
      const val = cellData?.value;
      const sample = typeof val === 'number' ? val : 1234.5;

      const ranges = toolbarRanges ?? [];
      const cellCount = totalCellCount(ranges);
      const isSingleCell =
        ranges.length === 1 &&
        ranges[0].startRow === ranges[0].endRow &&
        ranges[0].startCol === ranges[0].endCol;

      if (isSingleCell || ranges.length === 0) {
        // Strip nulls (ResolvedCellFormat uses null for absent fields) so tabs
        // see only `undefined` for "not set", consistent with multi-cell mode.
        const merged: Partial<CellFormat> = {};
        for (const [k, v] of Object.entries(base ?? {})) {
          if (v !== null && v !== undefined) {
            (merged as Record<string, unknown>)[k] = v;
          }
        }
        return { merged, sample };
      }

      if (cellCount > MAX_CELLS_FOR_MIXED_SCAN) {
        // Selection exceeds the kernel's 10K cell guard. Treat ALL tracked
        // properties as mixed; dirty tracking ensures we only write what the
        // user actually changes.
        const allMixed = new Set<keyof CellFormat>(TRACKED_PROPERTIES);
        const merged = buildMergedFormat((base ?? {}) as Partial<CellFormat>, allMixed);
        return { merged, sample };
      }

      // Multi-cell scan: fetch resolved per-cell formats for each range.
      const cellGrids = await Promise.all(
        ranges.map((r: { startRow: number; startCol: number; endRow: number; endCol: number }) =>
          ws.formats.getCellProperties(
            Math.min(r.startRow, r.endRow),
            Math.min(r.startCol, r.endCol),
            Math.max(r.startRow, r.endRow),
            Math.max(r.startCol, r.endCol),
          ),
        ),
      );
      const allCells: (CellFormat | null)[] = [];
      for (const grid of cellGrids) {
        for (const row of grid) {
          for (const cell of row) {
            allCells.push(cell);
          }
        }
      }

      const baseFormat = (base ?? {}) as Partial<CellFormat>;
      const mixed = detectMixedProperties(baseFormat, allCells);
      const merged = buildMergedFormat(baseFormat, mixed);
      return { merged, sample };
    };

    fetchFormat().then(({ merged, sample }) => {
      if (cancelled) return;
      setCellFormat(merged);
      setSampleValue(sample);
    });
    return () => {
      cancelled = true;
    };
  }, [open, wb, activeCell.row, activeCell.col, toolbarRanges]);

  const currentNumberFormat = cellFormat?.numberFormat || 'General';
  const currentNumberFormatType = detectFormatType(currentNumberFormat);

  // Early return if not open - prevents expensive computations and child rendering
  // All hooks must be called before this point (rules of hooks)
  if (!open) return null;

  // =========================================================================
  // Apply Logic
  // =========================================================================

  /**
   * Apply changes from the active tab.
   * Each tab exposes getChanges() via ref, we call it and dispatch the action.
   */
  const applyActiveTabChanges = async (): Promise<boolean> => {
    switch (activeTab) {
      case 'number': {
        const draft = pendingNumberFormatRef.current ?? pendingNumberFormat;
        if (draft && draft.format !== currentNumberFormat) {
          setPendingNumberFormat(draft.format);
          const result = await dispatch('APPLY_NUMBER_FORMAT', deps);
          if (result.handled === false) return false;
        }
        break;
      }
      case 'alignment': {
        const changes = alignmentTabRef.current?.getChanges();
        if (changes && Object.keys(changes).length > 0) {
          setPendingAlignmentFormat(changes);
          const result = await dispatch('APPLY_ALIGNMENT_FORMAT', deps);
          if (result.handled === false) return false;
        }
        break;
      }
      case 'font': {
        const changes = fontTabRef.current?.getChanges();
        if (changes && Object.keys(changes).length > 0) {
          setPendingFontFormat(changes);
          const result = await dispatch('APPLY_FONT_FORMAT', deps);
          if (result.handled === false) return false;
          // Track font color if changed
          if (changes.fontColor) {
            dispatch('TRACK_RECENT_COLOR', deps, { type: 'font', color: changes.fontColor });
            setRecentFontColors(getRecentColors('font'));
          }
        }
        break;
      }
      case 'border': {
        const changes = borderTabRef.current?.getChanges();
        if (changes) {
          setPendingBorderFormat(changes.borders);
          setPendingBorderPreset(changes.preset);
          const result = await dispatch('APPLY_BORDERS', deps);
          if (result.handled === false) return false;
          // Track border color if present
          if (changes.borders) {
            const borderColor =
              changes.borders.top?.color ||
              changes.borders.bottom?.color ||
              changes.borders.left?.color ||
              changes.borders.right?.color;
            if (borderColor) {
              dispatch('TRACK_RECENT_COLOR', deps, { type: 'border', color: borderColor });
              setRecentBorderColors(getRecentColors('border'));
            }
          }
        }
        break;
      }
      case 'fill': {
        const changes = fillTabRef.current?.getChanges();
        if (changes && Object.keys(changes).length > 0) {
          setPendingFillFormat(changes);
          const result = await dispatch('APPLY_FILL_FORMAT', deps);
          if (result.handled === false) return false;
          // Track fill color if changed
          if (changes.backgroundColor) {
            dispatch('TRACK_RECENT_COLOR', deps, { type: 'fill', color: changes.backgroundColor });
            setRecentFillColors(getRecentColors('fill'));
          }
        }
        break;
      }
      case 'protection': {
        const changes = protectionTabRef.current?.getChanges();
        if (changes && Object.keys(changes).length > 0) {
          setPendingProtectionFormat(changes);
          const result = await dispatch('APPLY_PROTECTION_FORMAT', deps);
          if (result.handled === false) return false;
        }
        break;
      }
    }
    return true;
  };

  // =========================================================================
  // Event Handlers
  // =========================================================================

  /**
   * Handle Number tab format change (stores pending format for later apply).
   */
  const handleNumberFormatChange = useCallback(
    (formatCode: string, formatType: NumberFormatType) => {
      const draft = { format: formatCode, type: formatType };
      pendingNumberFormatRef.current = draft;
      setPendingNumberFormatDraft(draft);
    },
    [],
  );

  /**
   * Handle Apply button click.
   * Applies changes from active tab but keeps dialog open.
   */
  const handleApply = () => {
    void applyActiveTabChanges();
  };

  /**
   * Handle OK button click.
   * Applies changes from active tab and closes dialog.
   */
  const handleOK = async () => {
    const applied = await applyActiveTabChanges();
    if (applied) {
      dispatch('CLOSE_FORMAT_CELLS_DIALOG', deps);
    }
  };

  /**
   * Handle Cancel button click.
   * Discards all changes and closes dialog.
   */
  const handleCancel = () => {
    dispatch('CLOSE_FORMAT_CELLS_DIALOG', deps);
  };

  const tabs = [
    { id: 'number', label: 'Number' },
    { id: 'alignment', label: 'Alignment' },
    { id: 'font', label: 'Font' },
    { id: 'border', label: 'Border' },
    { id: 'fill', label: 'Fill' },
    { id: 'protection', label: 'Protection' },
  ];

  return (
    <Dialog
      open={open}
      onClose={handleCancel}
      dialogId="format-cells"
      width={600}
      initialFocusRef={activeTab === 'number' ? numberCategoryListboxRef : undefined}
      onEnterKeyDown={() => {
        void handleOK();
      }}
    >
      <DialogHeader onClose={handleCancel}>Format Cells</DialogHeader>

      {/* Enter-to-commit is handled by Dialog's onEnterKeyDown prop. The
 primitive's guard suppresses Enter on textareas/contenteditable/most
 buttons, but allows it on listbox-option buttons — so pressing Enter
 on a Number-format category both selects the category (button click)
 and commits the dialog (Excel parity). Action buttons in the footer
 are type="button" so Enter never accidentally submits. */}
      <DialogBody noPadding>
        {/* Tab strip + panels must live inside <Tabs> so Radix Root context wraps both.
 Tab panels are gated on cellFormat being loaded — tabs initialize their
 draft state via useState(initialFormat?.x ?? default), which only runs once
 on mount. Mounting them with cellFormat=undefined would lock them to
 defaults even after the async fetch completes. */}
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
          className="border-b border-ss-border-default px-4"
        >
          <div className="px-4 py-4">
            {!cellFormat ? (
              <div className="h-32" aria-busy="true" />
            ) : (
              <>
                <TabPanel tabId="number">
                  <NumberFormatPanel
                    variant="embedded"
                    currentFormat={currentNumberFormat}
                    currentType={currentNumberFormatType}
                    sampleValue={sampleValue}
                    recentFormats={recentFormats}
                    onApply={handleNumberFormatChange}
                    onDraftChange={handleNumberFormatChange}
                    onClose={handleCancel}
                    formatPreviewFn={formatPreviewFn}
                    categoryListboxRef={numberCategoryListboxRef}
                  />
                </TabPanel>

                <TabPanel tabId="alignment">
                  <AlignmentTab ref={alignmentTabRef} initialFormat={cellFormat} />
                </TabPanel>

                <TabPanel tabId="font">
                  <FontTab
                    ref={fontTabRef}
                    initialFormat={cellFormat}
                    recentColors={recentFontColors}
                    onColorSelect={handleFontColorSelect}
                  />
                </TabPanel>

                <TabPanel tabId="border">
                  <BorderTab
                    ref={borderTabRef}
                    initialBorders={cellFormat?.borders}
                    recentColors={recentBorderColors}
                    onColorSelect={handleBorderColorSelect}
                  />
                </TabPanel>

                <TabPanel tabId="fill">
                  <FillTab
                    ref={fillTabRef}
                    initialFormat={cellFormat}
                    recentColors={recentFillColors}
                    onColorSelect={handleFillColorSelect}
                  />
                </TabPanel>

                <TabPanel tabId="protection">
                  <ProtectionTab ref={protectionTabRef} initialFormat={cellFormat} />
                </TabPanel>
              </>
            )}
          </div>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" onClick={handleApply}>
          Apply
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            void handleOK();
          }}
        >
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts FormatCellsDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function FormatCellsDialogWrapper() {
  const isOpen = useUIStore((s) => s.formatCellsDialogOpen);
  if (!isOpen) return null;
  return <FormatCellsDialog />;
}
