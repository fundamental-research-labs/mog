/**
 * PageSetupDialog Component
 *
 * Excel Parity Quickwin A10: Page Setup Dialog
 *
 * Dedicated dialog for configuring page setup options, matching Excel's
 * Page Setup experience. Provides 4 tabs:
 * - Page: Orientation, scaling, paper size
 * - Margins: Page margins and centering
 * - Header/Footer: Header and footer configuration
 * - Sheet: Print titles, gridlines, headings
 *
 * Uses FocusTrap for proper keyboard event isolation.
 * Follows Draft + Apply pattern - changes are applied only when OK is clicked.
 *
 * 15-PRINT-EXPORT: Updated to load/save settings via Sheets domain module
 *
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CollapsibleRangeInput,
  dispatch,
  useActionDependencies,
  useActiveSheetId,
  usePrintSettings,
  useUIStore,
  useWorkbook,
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
  SectionLabel,
  Select,
  TabPanel,
  Tabs,
} from '@mog/shell';
import type { PageOrientation, PaperSize, PrintSettings } from '@mog-sdk/contracts/core';
import type { PrintTitles } from '@mog-sdk/contracts/events';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';
// =============================================================================
// Print Titles Utilities (15-PRINT-EXPORT: Item 15.6)
// =============================================================================

/**
 * Parse a row range string like "$1:$2" or "1:2" into [startRow, endRow].
 * Returns null if invalid.
 */
function parseRowRange(input: string): [number, number] | null {
  if (!input.trim()) return null;

  // Remove $ signs and whitespace
  const cleaned = input.replace(/\$/g, '').trim();

  // Match pattern like "1:2" or "1" (single row)
  const match = cleaned.match(/^(\d+)(?::(\d+))?$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;

  // Validate (rows are 1-indexed in Excel notation, convert to 0-indexed)
  if (start < 1 || end < 1 || start > end || start > 1048576 || end > 1048576) return null;

  return [start - 1, end - 1]; // Convert to 0-indexed
}

/**
 * Parse a column range string like "$A:$B" or "A:B" into [startCol, endCol].
 * Returns null if invalid.
 */
function parseColRange(input: string): [number, number] | null {
  if (!input.trim()) return null;

  // Remove $ signs and whitespace
  const cleaned = input.replace(/\$/g, '').trim().toUpperCase();

  // Match pattern like "A:B" or "A" (single column)
  const match = cleaned.match(/^([A-Z]+)(?::([A-Z]+))?$/);
  if (!match) return null;

  const startCol = colLetterToIndex(match[1]);
  const endCol = match[2] ? colLetterToIndex(match[2]) : startCol;

  // Validate
  if (startCol < 0 || endCol < 0 || startCol > endCol || startCol > 16383 || endCol > 16383) {
    return null;
  }

  return [startCol, endCol];
}

/**
 * Convert column letter(s) to 0-indexed column number.
 * A=0, B=1, ..., Z=25, AA=26, AB=27, ...
 */
function colLetterToIndex(letters: string): number {
  let result = 0;
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1; // Convert to 0-indexed
}

/**
 * Convert 0-indexed column number to column letter(s).
 * 0=A, 1=B, ..., 25=Z, 26=AA, 27=AB, ...
 */
function colIndexToLetter(index: number): string {
  let result = '';
  let n = index + 1; // Convert to 1-indexed
  while (n > 0) {
    n--;
    result = String.fromCharCode('A'.charCodeAt(0) + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Format print titles to display in input fields.
 */
function formatPrintTitles(titles: PrintTitles | undefined): {
  rows: string;
  cols: string;
} {
  let rows = '';
  let cols = '';

  if (titles?.repeatRows) {
    const [start, end] = titles.repeatRows;
    // Convert to 1-indexed for display
    rows = start === end ? `$${start + 1}:$${start + 1}` : `$${start + 1}:$${end + 1}`;
  }

  if (titles?.repeatCols) {
    const [start, end] = titles.repeatCols;
    const startLetter = colIndexToLetter(start);
    const endLetter = colIndexToLetter(end);
    cols = start === end ? `$${startLetter}:$${startLetter}` : `$${startLetter}:$${endLetter}`;
  }

  return { rows, cols };
}

// =============================================================================
// Tab Types
// =============================================================================

type DialogTab = 'page' | 'margins' | 'headerFooter' | 'sheet';

// =============================================================================
// Types
// =============================================================================

export interface PageSetupDialogProps {
  /** Initial tab to display (optional - dialog subscribes to own open state) */
  initialTab?: DialogTab;
}

// =============================================================================
// Constants
// =============================================================================

const PAPER_SIZES: Array<{ value: PaperSize; label: string }> = [
  { value: 'letter', label: 'Letter (8.5" x 11")' },
  { value: 'legal', label: 'Legal (8.5" x 14")' },
  { value: 'a4', label: 'A4 (210mm x 297mm)' },
  { value: 'a3', label: 'A3 (297mm x 420mm)' },
];

const ORIENTATIONS: Array<{ value: PageOrientation; label: string }> = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const SCALE_OPTIONS = [50, 75, 100, 125, 150, 200];

const TABS: Array<{ id: DialogTab; label: string }> = [
  { id: 'page', label: 'Page' },
  { id: 'margins', label: 'Margins' },
  { id: 'headerFooter', label: 'Header/Footer' },
  { id: 'sheet', label: 'Sheet' },
];

const FIT_TO_OPTIONS = [
  { value: '', label: 'Automatic' },
  { value: '1', label: '1 page' },
  { value: '2', label: '2 pages' },
  { value: '3', label: '3 pages' },
  { value: '4', label: '4 pages' },
  { value: '5', label: '5 pages' },
];

// Header/Footer preset options
const HEADER_PRESETS: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'page', label: 'Page &[Page]' },
  { value: 'page_of_pages', label: 'Page &[Page] of &[Pages]' },
  { value: 'sheet', label: '&[Sheet]' },
  { value: 'file', label: '&[File]' },
  { value: 'date', label: '&[Date]' },
  { value: 'date_time', label: '&[Date] &[Time]' },
  { value: 'confidential', label: 'Confidential, &[Date], Page &[Page]' },
  { value: 'prepared_by', label: 'Prepared by &[User], &[Date]' },
];

const FOOTER_PRESETS: Array<{ value: string; label: string }> = [
  { value: '', label: '(none)' },
  { value: 'page', label: 'Page &[Page]' },
  { value: 'page_of_pages', label: 'Page &[Page] of &[Pages]' },
  { value: 'sheet', label: '&[Sheet]' },
  { value: 'file', label: '&[File]' },
  { value: 'date', label: '&[Date]' },
  { value: 'date_time', label: '&[Date] &[Time]' },
];

// Format code buttons for header/footer
const FORMAT_CODES: Array<{ code: string; label: string; tooltip: string }> = [
  { code: '&[Page]', label: 'Page', tooltip: 'Insert page number' },
  { code: '&[Pages]', label: 'Pages', tooltip: 'Insert total pages' },
  { code: '&[Date]', label: 'Date', tooltip: 'Insert current date' },
  { code: '&[Time]', label: 'Time', tooltip: 'Insert current time' },
  { code: '&[Sheet]', label: 'Sheet', tooltip: 'Insert sheet name' },
  { code: '&[File]', label: 'File', tooltip: 'Insert filename' },
];

type PrintCommentsOption = 'none' | 'atEnd' | 'asDisplayed';
type PrintErrorsOption = 'displayed' | 'blank' | 'dash' | 'NA';
type PageOrderOption = 'downThenOver' | 'overThenDown';

// Cell errors display options
const CELL_ERRORS_OPTIONS: Array<{ value: PrintErrorsOption; label: string }> = [
  { value: 'displayed', label: 'displayed' },
  { value: 'blank', label: '<blank>' },
  { value: 'dash', label: '--' },
  { value: 'NA', label: '#N/A' },
];

// Comments display options
const COMMENTS_OPTIONS: Array<{ value: PrintCommentsOption; label: string }> = [
  { value: 'none', label: '(None)' },
  { value: 'atEnd', label: 'At end of sheet' },
  { value: 'asDisplayed', label: 'As displayed on sheet' },
];

// Page order options
const PAGE_ORDER_OPTIONS: Array<{ value: PageOrderOption; label: string }> = [
  { value: 'downThenOver', label: 'Down, then over' },
  { value: 'overThenDown', label: 'Over, then down' },
];

function toPrintCommentsOption(value: string | null): PrintCommentsOption {
  return value === 'atEnd' || value === 'asDisplayed' ? value : 'none';
}

function toPrintErrorsOption(value: string | null): PrintErrorsOption {
  return value === 'blank' || value === 'dash' || value === 'NA' ? value : 'displayed';
}

function toPageOrderOption(value: string | null): PageOrderOption {
  return value === 'overThenDown' ? value : 'downThenOver';
}

function isPrintCommentsOption(value: string): value is PrintCommentsOption {
  return COMMENTS_OPTIONS.some((option) => option.value === value);
}

function isPrintErrorsOption(value: string): value is PrintErrorsOption {
  return CELL_ERRORS_OPTIONS.some((option) => option.value === value);
}

function isPageOrderOption(value: string): value is PageOrderOption {
  return PAGE_ORDER_OPTIONS.some((option) => option.value === value);
}

// =============================================================================
// Component
// =============================================================================

export function PageSetupDialog({ initialTab }: PageSetupDialogProps) {
  // Dialog subscribes to its own open state - prevents SpreadsheetContent from re-rendering
  // when this dialog opens/closes (render isolation per ARCHITECTURE-CHECKLIST.md Section 14)
  const isOpen = useUIStore((s) => s.pageSetupDialogOpen);
  const storeInitialTab = useUIStore((s) => s.pageSetupDialogInitialTab);
  const rangeSelectionMode = useUIStore((s) => s.rangeSelectionMode);
  const effectiveInitialTab = initialTab ?? storeInitialTab;

  // Get action dependencies for dispatch()
  const deps = useActionDependencies();
  const workbook = useWorkbook();

  // Get active sheet ID and current print settings
  const activeSheetId = useActiveSheetId();
  const { settings: currentSettings } = usePrintSettings(activeSheetId ?? '');

  // Tab state
  const [activeTab, setActiveTab] = useState<DialogTab>(effectiveInitialTab ?? 'page');

  // State for print options (Page tab)
  const [paperSize, setPaperSize] = useState<PaperSize>('letter');
  const [orientation, setOrientation] = useState<PageOrientation>('portrait');
  const [scale, setScale] = useState(100);
  const [fitToEnabled, setFitToEnabled] = useState(false);
  const [fitToWidth, setFitToWidth] = useState<string>('');
  const [fitToHeight, setFitToHeight] = useState<string>('');

  // State for margins (Margins tab)
  const [margins, setMargins] = useState({
    top: 0.75,
    right: 0.7,
    bottom: 0.75,
    left: 0.7,
  });
  const [centerHorizontal, setCenterHorizontal] = useState(false);
  const [centerVertical, setCenterVertical] = useState(false);

  // State for headers/footers (Header/Footer tab)
  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('');
  const [headerRight, setHeaderRight] = useState('');
  const [footerLeft, setFooterLeft] = useState('');
  const [footerCenter, setFooterCenter] = useState('');
  const [footerRight, setFooterRight] = useState('');

  // State for sheet options (Sheet tab)
  const [repeatRowsInput, setRepeatRowsInput] = useState('');
  const [repeatColsInput, setRepeatColsInput] = useState('');
  const [showGridlines, setShowGridlines] = useState(() => currentSettings.gridlines);
  const [showHeaders, setShowHeaders] = useState(() => currentSettings.headings);

  // Additional Sheet tab options
  const [blackAndWhite, setBlackAndWhite] = useState(() => currentSettings.blackAndWhite);
  const [draftQuality, setDraftQuality] = useState(() => currentSettings.draft);
  const [commentsOption, setCommentsOption] = useState<PrintCommentsOption>(() =>
    toPrintCommentsOption(currentSettings.printComments),
  );
  const [cellErrorsAs, setCellErrorsAs] = useState<PrintErrorsOption>(() =>
    toPrintErrorsOption(currentSettings.printErrors),
  );
  const [pageOrder, setPageOrder] = useState<PageOrderOption>(() =>
    toPageOrderOption(currentSettings.pageOrder),
  );

  // State for focused header/footer input (for format code insertion)
  const [focusedHeaderFooterInput, setFocusedHeaderFooterInput] = useState<string | null>(null);

  // Load settings from current sheet when dialog opens
  useEffect(() => {
    if (isOpen && currentSettings) {
      // Page tab - map OOXML paper size code to PaperSize string
      const paperSizeMap: Record<number, PaperSize> = { 1: 'letter', 5: 'legal', 9: 'a4', 8: 'a3' };
      setPaperSize(paperSizeMap[currentSettings.paperSize ?? 1] ?? 'letter');
      setOrientation((currentSettings.orientation as PageOrientation) ?? 'portrait');
      setScale(currentSettings.scale ?? 100);
      if (currentSettings.fitToWidth != null || currentSettings.fitToHeight != null) {
        setFitToEnabled(true);
        setFitToWidth(currentSettings.fitToWidth?.toString() ?? '');
        setFitToHeight(currentSettings.fitToHeight?.toString() ?? '');
      } else {
        setFitToEnabled(false);
        setFitToWidth('');
        setFitToHeight('');
      }

      // Margins tab
      const m = currentSettings.margins;
      if (m) {
        setMargins({ top: m.top, right: m.right, bottom: m.bottom, left: m.left });
      }
      setCenterHorizontal(currentSettings.hCentered);
      setCenterVertical(currentSettings.vCentered);

      // Header/Footer tab
      const hf = currentSettings.headerFooter;
      // OOXML stores header/footer as single strings; UI splits into left/center/right
      setHeaderLeft('');
      setHeaderCenter(hf?.oddHeader ?? '');
      setHeaderRight('');
      setFooterLeft('');
      setFooterCenter(hf?.oddFooter ?? '');
      setFooterRight('');

      // Sheet tab
      setShowGridlines(currentSettings.gridlines);
      setShowHeaders(currentSettings.headings);
      setBlackAndWhite(currentSettings.blackAndWhite);
      setDraftQuality(currentSettings.draft);
      setCommentsOption(toPrintCommentsOption(currentSettings.printComments));
      setCellErrorsAs(toPrintErrorsOption(currentSettings.printErrors));
      setPageOrder(toPageOrderOption(currentSettings.pageOrder));

      const printTitles = activeSheetId
        ? formatPrintTitles(workbook.mirror.getPrintTitles(activeSheetId))
        : { rows: '', cols: '' };
      setRepeatRowsInput(printTitles.rows);
      setRepeatColsInput(printTitles.cols);
    }
  }, [isOpen, currentSettings, workbook, activeSheetId]);

  // Reset tab when dialog opens with different initial tab
  useEffect(() => {
    if (isOpen) {
      setActiveTab(effectiveInitialTab ?? 'page');
    }
  }, [isOpen, effectiveInitialTab]);

  // Handle margin change
  const handleMarginChange = useCallback(
    (side: 'top' | 'right' | 'bottom' | 'left', value: string) => {
      const num = parseFloat(value);
      if (!isNaN(num) && num >= 0) {
        setMargins((prev) => ({ ...prev, [side]: num }));
      }
    },
    [],
  );

  // Handle header preset selection
  const handleHeaderPresetChange = useCallback((preset: string) => {
    // Find the preset value
    const presetOption = HEADER_PRESETS.find((p) => p.value === preset);
    if (!presetOption) return;

    // Clear all header fields first
    setHeaderLeft('');
    setHeaderCenter('');
    setHeaderRight('');

    // Apply preset to center by default
    if (preset !== '') {
      setHeaderCenter(presetOption.label);
    }
  }, []);

  // Handle footer preset selection
  const handleFooterPresetChange = useCallback((preset: string) => {
    const presetOption = FOOTER_PRESETS.find((p) => p.value === preset);
    if (!presetOption) return;

    setFooterLeft('');
    setFooterCenter('');
    setFooterRight('');

    if (preset !== '') {
      setFooterCenter(presetOption.label);
    }
  }, []);

  // Insert format code into the currently focused header/footer field
  const handleInsertFormatCode = useCallback(
    (code: string) => {
      if (!focusedHeaderFooterInput) return;

      const setters: Record<string, React.Dispatch<React.SetStateAction<string>>> = {
        headerLeft: setHeaderLeft,
        headerCenter: setHeaderCenter,
        headerRight: setHeaderRight,
        footerLeft: setFooterLeft,
        footerCenter: setFooterCenter,
        footerRight: setFooterRight,
      };

      const setter = setters[focusedHeaderFooterInput];
      if (setter) {
        setter((prev) => prev + code);
      }
    },
    [focusedHeaderFooterInput],
  );

  // Handle OK button - build settings, persist, and close
  const handleOK = useCallback(() => {
    // Build the settings payload
    // Map PaperSize string to OOXML numeric code
    const paperSizeCodeMap: Record<PaperSize, number> = {
      letter: 1,
      legal: 5,
      a4: 9,
      a3: 8,
      custom: 0,
    };
    const repeatRows = parseRowRange(repeatRowsInput);
    const repeatCols = parseColRange(repeatColsInput);
    const settings: Partial<PrintSettings> & { printTitles: PrintTitles } = {
      // Page tab
      paperSize: paperSizeCodeMap[paperSize] ?? 1,
      orientation,
      scale,
      fitToWidth: fitToEnabled && fitToWidth ? parseInt(fitToWidth, 10) : null,
      fitToHeight: fitToEnabled && fitToHeight ? parseInt(fitToHeight, 10) : null,

      // Margins tab
      margins: {
        ...margins,
        header: 0.3,
        footer: 0.3,
      },
      hCentered: centerHorizontal,
      vCentered: centerVertical,

      // Header/Footer tab
      headerFooter: {
        oddHeader: headerCenter || null,
        oddFooter: footerCenter || null,
        evenHeader: null,
        evenFooter: null,
        firstHeader: null,
        firstFooter: null,
        differentOddEven: false,
        differentFirst: false,
        scaleWithDoc: true,
        alignWithMargins: true,
      },

      // Sheet tab
      gridlines: showGridlines,
      headings: showHeaders,
      blackAndWhite,
      draft: draftQuality,
      printComments: commentsOption,
      printErrors: cellErrorsAs,
      pageOrder,
      printTitles: {
        repeatRows: repeatRowsInput.trim() === '' ? undefined : (repeatRows ?? undefined),
        repeatCols: repeatColsInput.trim() === '' ? undefined : (repeatCols ?? undefined),
      },
    };

    // Persist via Unified Action System with payload
    dispatch('APPLY_PAGE_SETUP', deps, settings);
  }, [
    deps,
    paperSize,
    orientation,
    scale,
    fitToEnabled,
    fitToWidth,
    fitToHeight,
    margins,
    centerHorizontal,
    centerVertical,
    headerLeft,
    headerCenter,
    headerRight,
    footerLeft,
    footerCenter,
    footerRight,
    showGridlines,
    showHeaders,
    blackAndWhite,
    draftQuality,
    commentsOption,
    cellErrorsAs,
    pageOrder,
    repeatRowsInput,
    repeatColsInput,
  ]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_PAGE_SETUP_DIALOG', deps);
  }, [deps]);

  const guardedEnter = useRangeSelectionEnterGuard(handleOK);
  const isPickingPrintTitleRange =
    rangeSelectionMode.active &&
    rangeSelectionMode.sourceDialogId === 'page-setup-dialog' &&
    (rangeSelectionMode.sourceInputId === 'repeat-rows' ||
      rangeSelectionMode.sourceInputId === 'repeat-cols');

  // Early return if not open - prevents expensive rendering
  // All hooks must be called before this point (rules of hooks)
  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={isOpen}
      onClose={handleCancel}
      dialogId="page-setup-dialog"
      width={480}
      closeOnOverlayClick={!isPickingPrintTitleRange}
      allowPointerEventsBehind={isPickingPrintTitleRange}
    >
      <DialogHeader onClose={handleCancel}>Page Setup</DialogHeader>

      <DialogBody>
        {/* Tab Bar + Panels - TabPanel must be children of Tabs (Radix requirement) */}
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as DialogTab)}
          className="mb-4"
        >
          {/* Page Tab */}
          <TabPanel tabId="page">
            {/* Orientation Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Orientation
              </SectionLabel>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[100px] flex-shrink-0 mb-0">Orientation</Label>
                <Select
                  className="flex-1"
                  size="sm"
                  options={ORIENTATIONS}
                  value={orientation}
                  onChange={(value) => setOrientation(value as PageOrientation)}
                />
              </div>
            </div>

            {/* Scaling Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Scaling
              </SectionLabel>

              <div className="flex items-center gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer text-body text-text">
                  <input
                    type="radio"
                    name="scaling"
                    className="w-4 h-4 cursor-pointer accent-primary"
                    checked={!fitToEnabled}
                    onChange={() => setFitToEnabled(false)}
                  />
                  Adjust to:
                </label>
                <Select
                  className="w-[100px]"
                  size="sm"
                  options={SCALE_OPTIONS.map((s) => ({ value: String(s), label: `${s}%` }))}
                  value={String(scale)}
                  onChange={(value) => setScale(Number(value))}
                  disabled={fitToEnabled}
                />
              </div>

              <div className="flex items-center gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer text-body text-text">
                  <input
                    type="radio"
                    name="scaling"
                    className="w-4 h-4 cursor-pointer accent-primary"
                    checked={fitToEnabled}
                    onChange={() => setFitToEnabled(true)}
                  />
                  Fit to:
                </label>
              </div>

              {fitToEnabled && (
                <div className="flex items-center gap-2 mt-2 ml-6">
                  <Select
                    className="w-[100px]"
                    size="sm"
                    options={FIT_TO_OPTIONS}
                    value={fitToWidth}
                    onChange={(value) => setFitToWidth(value)}
                  />
                  <span className="text-body-sm text-ss-text-secondary">wide by</span>
                  <Select
                    className="w-[100px]"
                    size="sm"
                    options={FIT_TO_OPTIONS}
                    value={fitToHeight}
                    onChange={(value) => setFitToHeight(value)}
                  />
                  <span className="text-body-sm text-ss-text-secondary">tall</span>
                </div>
              )}
            </div>

            {/* Paper Size Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Paper
              </SectionLabel>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[100px] flex-shrink-0 mb-0">Paper Size</Label>
                <Select
                  className="flex-1"
                  size="sm"
                  options={PAPER_SIZES}
                  value={paperSize}
                  onChange={(value) => setPaperSize(value as PaperSize)}
                />
              </div>
            </div>
          </TabPanel>

          {/* Margins Tab */}
          <TabPanel tabId="margins">
            {/* Margins Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Margins (inches)
              </SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-caption text-ss-text-secondary w-[50px]">Top</span>
                  <Input
                    type="number"
                    aria-label="Top"
                    className="w-[60px] h-8 px-2 py-0 text-center"
                    value={margins.top}
                    onChange={(e) => handleMarginChange('top', e.target.value)}
                    step={0.1}
                    min={0}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-caption text-ss-text-secondary w-[50px]">Bottom</span>
                  <Input
                    type="number"
                    aria-label="Bottom"
                    className="w-[60px] h-8 px-2 py-0 text-center"
                    value={margins.bottom}
                    onChange={(e) => handleMarginChange('bottom', e.target.value)}
                    step={0.1}
                    min={0}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-caption text-ss-text-secondary w-[50px]">Left</span>
                  <Input
                    type="number"
                    aria-label="Left"
                    className="w-[60px] h-8 px-2 py-0 text-center"
                    value={margins.left}
                    onChange={(e) => handleMarginChange('left', e.target.value)}
                    step={0.1}
                    min={0}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-caption text-ss-text-secondary w-[50px]">Right</span>
                  <Input
                    type="number"
                    aria-label="Right"
                    className="w-[60px] h-8 px-2 py-0 text-center"
                    value={margins.right}
                    onChange={(e) => handleMarginChange('right', e.target.value)}
                    step={0.1}
                    min={0}
                  />
                </div>
              </div>
            </div>

            {/* Center on Page Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Center on Page
              </SectionLabel>
              <div className="flex gap-6 mt-2">
                <Checkbox
                  checked={centerHorizontal}
                  onChange={(checked) => setCenterHorizontal(checked)}
                  label="Horizontally"
                />
                <Checkbox
                  checked={centerVertical}
                  onChange={(checked) => setCenterVertical(checked)}
                  label="Vertically"
                />
              </div>
            </div>
          </TabPanel>

          {/* Header/Footer Tab */}
          <TabPanel tabId="headerFooter">
            {/* Header Preset Dropdown */}
            <div className="mb-4">
              <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                Header Preset
              </SectionLabel>
              <Select
                className="w-full"
                size="sm"
                options={HEADER_PRESETS}
                value=""
                onChange={(value) => handleHeaderPresetChange(value)}
              />
            </div>

            {/* Footer Preset Dropdown */}
            <div className="mb-4">
              <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                Footer Preset
              </SectionLabel>
              <Select
                className="w-full"
                size="sm"
                options={FOOTER_PRESETS}
                value=""
                onChange={(value) => handleFooterPresetChange(value)}
              />
            </div>

            {/* Format Code Insertion Buttons */}
            <div className="mb-4">
              <SectionLabel size="sm" className="mb-2 font-semibold text-text-ss-primary">
                Insert Format Code
              </SectionLabel>
              <div className="flex flex-wrap gap-2">
                {FORMAT_CODES.map(({ code, label, tooltip }) => (
                  <Button
                    key={code}
                    variant="secondary"
                    size="sm"
                    onClick={() => handleInsertFormatCode(code)}
                    disabled={!focusedHeaderFooterInput}
                    title={tooltip}
                    className="px-2 py-1 text-caption"
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="text-hint text-ss-text-secondary mt-1">
                Click a field below, then click a button to insert the code.
              </div>
            </div>

            {/* Custom Header/Footer Sections */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Custom Header & Footer
              </SectionLabel>

              {/* Column labels */}
              <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 items-center">
                <div></div>
                <div className="text-caption text-ss-text-secondary text-center pb-1">Left</div>
                <div className="text-caption text-ss-text-secondary text-center pb-1">Center</div>
                <div className="text-caption text-ss-text-secondary text-center pb-1">Right</div>
              </div>

              {/* Header row */}
              <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 items-center">
                <span className="text-caption text-ss-text-secondary font-medium">Header</span>
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={headerLeft}
                  onChange={(e) => setHeaderLeft(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('headerLeft')}
                  placeholder="Left"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={headerCenter}
                  onChange={(e) => setHeaderCenter(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('headerCenter')}
                  placeholder="Center"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={headerRight}
                  onChange={(e) => setHeaderRight(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('headerRight')}
                  placeholder="Right"
                />
              </div>

              {/* Footer row */}
              <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-2 items-center mt-2">
                <span className="text-caption text-ss-text-secondary font-medium">Footer</span>
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={footerLeft}
                  onChange={(e) => setFooterLeft(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('footerLeft')}
                  placeholder="Left"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={footerCenter}
                  onChange={(e) => setFooterCenter(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('footerCenter')}
                  placeholder="Center"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={footerRight}
                  onChange={(e) => setFooterRight(e.target.value)}
                  onFocus={() => setFocusedHeaderFooterInput('footerRight')}
                  placeholder="Right"
                />
              </div>
            </div>
          </TabPanel>

          {/* Sheet Tab */}
          <TabPanel tabId="sheet">
            {/* Print Titles Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Print Titles
              </SectionLabel>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[140px] flex-shrink-0 mb-0">Rows to repeat at top</Label>
                <CollapsibleRangeInput
                  value={repeatRowsInput}
                  onChange={setRepeatRowsInput}
                  dialogId="page-setup-dialog"
                  inputId="repeat-rows"
                  placeholder="e.g., $1:$2"
                  label="Rows to repeat at top"
                  className="flex-1"
                />
              </div>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[140px] flex-shrink-0 mb-0">Columns to repeat at left</Label>
                <CollapsibleRangeInput
                  value={repeatColsInput}
                  onChange={setRepeatColsInput}
                  dialogId="page-setup-dialog"
                  inputId="repeat-cols"
                  placeholder="e.g., $A:$B"
                  label="Columns to repeat at left"
                  className="flex-1"
                />
              </div>

              <div className="text-caption text-ss-text-secondary mt-2">
                These rows/columns will appear on every printed page.
              </div>
            </div>

            {/* Print Options Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Print
              </SectionLabel>

              <div className="flex flex-col gap-3">
                <Checkbox
                  checked={showGridlines}
                  onChange={(checked) => setShowGridlines(checked)}
                  label="Gridlines"
                />
                <Checkbox
                  checked={showHeaders}
                  onChange={(checked) => setShowHeaders(checked)}
                  label="Row and column headings"
                />
                <Checkbox
                  checked={blackAndWhite}
                  onChange={(checked) => setBlackAndWhite(checked)}
                  label="Black and white"
                />
                <Checkbox
                  checked={draftQuality}
                  onChange={(checked) => setDraftQuality(checked)}
                  label="Draft quality"
                />
              </div>
            </div>

            {/* Comments and Errors Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Comments and Errors
              </SectionLabel>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[100px] flex-shrink-0 mb-0">Comments</Label>
                <Select
                  className="flex-1"
                  size="sm"
                  options={COMMENTS_OPTIONS}
                  value={commentsOption}
                  onChange={(value) => {
                    if (isPrintCommentsOption(value)) {
                      setCommentsOption(value);
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[100px] flex-shrink-0 mb-0">Cell errors as</Label>
                <Select
                  className="flex-1"
                  size="sm"
                  options={CELL_ERRORS_OPTIONS}
                  value={cellErrorsAs}
                  onChange={(value) => {
                    if (isPrintErrorsOption(value)) {
                      setCellErrorsAs(value);
                    }
                  }}
                />
              </div>
            </div>

            {/* Page Order Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Page Order
              </SectionLabel>

              <div className="flex flex-col gap-2">
                {PAGE_ORDER_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pageOrder"
                      value={option.value}
                      checked={pageOrder === option.value}
                      onChange={(e) => {
                        if (isPageOrderOption(e.target.value)) {
                          setPageOrder(e.target.value);
                        }
                      }}
                      className="w-4 h-4 cursor-pointer accent-primary"
                    />
                    <span className="text-body text-text">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </TabPanel>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOK}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
