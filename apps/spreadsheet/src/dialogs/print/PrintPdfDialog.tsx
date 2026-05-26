/**
 * PrintPdfDialog Component
 *
 * Dialog for configuring print and PDF export options.
 * Allows users to set:
 * - Paper size and orientation
 * - Fit to page scaling
 * - Margins and centering
 * - Headers and footers (left/center/right sections)
 * - Print titles (repeat rows/columns)
 * - Gridlines and headers visibility
 * - Scale
 *
 * Uses FocusTrap for proper keyboard event isolation.
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import { useCallback, useState } from 'react';

import type { PageOrientation, PageSetup, PaperSize, PrintOptions } from '@mog/print-export';

import { DEFAULT_PAGE_SETUP, DEFAULT_PRINT_OPTIONS } from '@mog/print-export';
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
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

// =============================================================================
// Tab Types
// =============================================================================

type DialogTab = 'page' | 'margins' | 'headerFooter' | 'sheet';

// =============================================================================
// Types
// =============================================================================

export interface PrintPdfDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;

  /** Close the dialog */
  onClose: () => void;

  /** Callback when print is requested */
  onPrint?: (options: PrintOptions, pageSetup: PageSetup) => void;

  /** Callback when PDF export is requested */
  onExportPdf?: (options: PrintOptions, pageSetup: PageSetup, filename: string) => void;

  /** Default filename for PDF export */
  defaultFilename?: string;

  /** Initial print options */
  initialOptions?: Partial<PrintOptions>;

  /** Initial page setup */
  initialPageSetup?: PageSetup;
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert column index to letter (0 -> A, 1 -> B, 25 -> Z, 26 -> AA)
 */
function colToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Convert column letter to index (A -> 0, B -> 1, Z -> 25, AA -> 26)
 */
function letterToCol(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result - 1;
}

/**
 * Parse row range input like "1:3" to [startRow, endRow] (0-indexed)
 */
function parseRowRange(input: string): [number, number] | null {
  const match = input.trim().match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const start = parseInt(match[1], 10) - 1;
  const end = parseInt(match[2], 10) - 1;
  if (start < 0 || end < start) return null;
  return [start, end];
}

/**
 * Parse column range input like "A:C" to [startCol, endCol] (0-indexed)
 */
function parseColRange(input: string): [number, number] | null {
  const match = input
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+):([A-Z]+)$/);
  if (!match) return null;
  const start = letterToCol(match[1]);
  const end = letterToCol(match[2]);
  if (start < 0 || end < start) return null;
  return [start, end];
}

// =============================================================================
// Component
// =============================================================================

export function PrintPdfDialog({
  isOpen,
  onClose,
  onPrint,
  onExportPdf,
  defaultFilename = 'spreadsheet',
  initialOptions,
  initialPageSetup,
}: PrintPdfDialogProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<DialogTab>('page');

  // State for print options
  const [paperSize, setPaperSize] = useState<PaperSize>(
    initialOptions?.paperSize ?? DEFAULT_PRINT_OPTIONS.paperSize,
  );
  const [orientation, setOrientation] = useState<PageOrientation>(
    initialOptions?.orientation ?? DEFAULT_PRINT_OPTIONS.orientation,
  );
  const [scale, setScale] = useState(
    Math.round((initialOptions?.scale ?? DEFAULT_PRINT_OPTIONS.scale) * 100),
  );
  const [showGridlines, setShowGridlines] = useState(
    initialOptions?.showGridlines ?? DEFAULT_PRINT_OPTIONS.showGridlines,
  );
  const [showHeaders, setShowHeaders] = useState(
    initialOptions?.showHeaders ?? DEFAULT_PRINT_OPTIONS.showHeaders,
  );
  const [margins, setMargins] = useState({
    top: initialOptions?.margins?.top ?? DEFAULT_PRINT_OPTIONS.margins.top,
    right: initialOptions?.margins?.right ?? DEFAULT_PRINT_OPTIONS.margins.right,
    bottom: initialOptions?.margins?.bottom ?? DEFAULT_PRINT_OPTIONS.margins.bottom,
    left: initialOptions?.margins?.left ?? DEFAULT_PRINT_OPTIONS.margins.left,
  });

  // Fit to page state
  const [fitToEnabled, setFitToEnabled] = useState(initialOptions?.fitTo !== undefined);
  const [fitToWidth, setFitToWidth] = useState<string>(
    initialOptions?.fitTo?.width?.toString() ?? '',
  );
  const [fitToHeight, setFitToHeight] = useState<string>(
    initialOptions?.fitTo?.height?.toString() ?? '',
  );

  // Center on page state
  const [centerHorizontal, setCenterHorizontal] = useState(
    initialOptions?.center?.horizontal ?? DEFAULT_PRINT_OPTIONS.center.horizontal,
  );
  const [centerVertical, setCenterVertical] = useState(
    initialOptions?.center?.vertical ?? DEFAULT_PRINT_OPTIONS.center.vertical,
  );

  // State for page setup - headers (left/center/right)
  const [headerLeft, setHeaderLeft] = useState(initialPageSetup?.header?.left ?? '');
  const [headerCenter, setHeaderCenter] = useState(
    initialPageSetup?.header?.center ?? DEFAULT_PAGE_SETUP.header?.center ?? '',
  );
  const [headerRight, setHeaderRight] = useState(initialPageSetup?.header?.right ?? '');

  // State for page setup - footers (left/center/right)
  const [footerLeft, setFooterLeft] = useState(initialPageSetup?.footer?.left ?? '');
  const [footerCenter, setFooterCenter] = useState(
    initialPageSetup?.footer?.center ?? DEFAULT_PAGE_SETUP.footer?.center ?? '',
  );
  const [footerRight, setFooterRight] = useState(initialPageSetup?.footer?.right ?? '');

  // Print titles state (repeat rows/columns)
  const [repeatRowsInput, setRepeatRowsInput] = useState(
    initialPageSetup?.repeatRows
      ? `${initialPageSetup.repeatRows[0] + 1}:${initialPageSetup.repeatRows[1] + 1}`
      : '',
  );
  const [repeatColsInput, setRepeatColsInput] = useState(
    initialPageSetup?.repeatCols
      ? `${colToLetter(initialPageSetup.repeatCols[0])}:${colToLetter(initialPageSetup.repeatCols[1])}`
      : '',
  );

  // State for filename
  const [filename, setFilename] = useState(defaultFilename);

  // Build options object
  const buildOptions = useCallback((): PrintOptions => {
    const options: PrintOptions = {
      paperSize,
      orientation,
      scale: scale / 100,
      showGridlines,
      showHeaders,
      margins,
      center: { horizontal: centerHorizontal, vertical: centerVertical },
    };

    // Add fitTo if enabled
    if (fitToEnabled) {
      const width = fitToWidth ? parseInt(fitToWidth, 10) : undefined;
      const height = fitToHeight ? parseInt(fitToHeight, 10) : undefined;
      if (width || height) {
        options.fitTo = { width, height };
      }
    }

    return options;
  }, [
    paperSize,
    orientation,
    scale,
    showGridlines,
    showHeaders,
    margins,
    centerHorizontal,
    centerVertical,
    fitToEnabled,
    fitToWidth,
    fitToHeight,
  ]);

  // Build page setup object
  const buildPageSetup = useCallback((): PageSetup => {
    const pageSetup: PageSetup = {};

    // Build header if any section has content
    if (headerLeft || headerCenter || headerRight) {
      pageSetup.header = {
        left: headerLeft || undefined,
        center: headerCenter || undefined,
        right: headerRight || undefined,
      };
    }

    // Build footer if any section has content
    if (footerLeft || footerCenter || footerRight) {
      pageSetup.footer = {
        left: footerLeft || undefined,
        center: footerCenter || undefined,
        right: footerRight || undefined,
      };
    }

    // Parse and add repeat rows
    const repeatRows = parseRowRange(repeatRowsInput);
    if (repeatRows) {
      pageSetup.repeatRows = repeatRows;
    }

    // Parse and add repeat columns
    const repeatCols = parseColRange(repeatColsInput);
    if (repeatCols) {
      pageSetup.repeatCols = repeatCols;
    }

    return pageSetup;
  }, [
    headerLeft,
    headerCenter,
    headerRight,
    footerLeft,
    footerCenter,
    footerRight,
    repeatRowsInput,
    repeatColsInput,
  ]);

  // Handle print
  const handlePrint = useCallback(() => {
    onPrint?.(buildOptions(), buildPageSetup());
    onClose();
  }, [onPrint, buildOptions, buildPageSetup, onClose]);

  // Handle PDF export
  const handleExportPdf = useCallback(() => {
    onExportPdf?.(buildOptions(), buildPageSetup(), filename);
    onClose();
  }, [onExportPdf, buildOptions, buildPageSetup, filename, onClose]);

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

  return (
    <Dialog
      onEnterKeyDown={onPrint ? handlePrint : onExportPdf ? handleExportPdf : undefined}
      open={isOpen}
      onClose={onClose}
      dialogId="print-pdf-dialog"
      width={480}
    >
      <DialogHeader onClose={onClose}>Print / Export PDF</DialogHeader>

      <DialogBody>
        {/* Tab Bar */}
        <Tabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as DialogTab)}
          className="mb-4"
        >
          {/* Page Tab */}
          <TabPanel tabId="page">
            {/* Page Setup Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Page Setup
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
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Header & Footer Sections
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
                  placeholder="Left"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={headerCenter}
                  onChange={(e) => setHeaderCenter(e.target.value)}
                  placeholder="Center"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={headerRight}
                  onChange={(e) => setHeaderRight(e.target.value)}
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
                  placeholder="Left"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={footerCenter}
                  onChange={(e) => setFooterCenter(e.target.value)}
                  placeholder="Center"
                />
                <Input
                  type="text"
                  className="h-7 px-2 py-0"
                  value={footerRight}
                  onChange={(e) => setFooterRight(e.target.value)}
                  placeholder="Right"
                />
              </div>

              <div className="text-hint text-ss-text-secondary mt-2 leading-relaxed">
                Available placeholders: &[Page], &[Pages], &[Date], &[Time], &[Sheet], &[File]
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
                <Label className="w-[100px] flex-shrink-0 mb-0">Rows to repeat at top</Label>
                <Input
                  type="text"
                  className="flex-1 h-8 px-2 py-0"
                  value={repeatRowsInput}
                  onChange={(e) => setRepeatRowsInput(e.target.value)}
                  placeholder="e.g., 1:2"
                />
              </div>

              <div className="flex items-center gap-4 mb-3">
                <Label className="w-[100px] flex-shrink-0 mb-0">Columns to repeat at left</Label>
                <Input
                  type="text"
                  className="flex-1 h-8 px-2 py-0"
                  value={repeatColsInput}
                  onChange={(e) => setRepeatColsInput(e.target.value)}
                  placeholder="e.g., A:B"
                />
              </div>

              <div className="text-caption text-ss-text-secondary mt-2">
                These rows/columns will appear on every printed page.
              </div>
            </div>

            {/* Print Options Section */}
            <div className="mb-5">
              <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                Print Options
              </SectionLabel>

              <div className="flex flex-col gap-3">
                <Checkbox
                  checked={showGridlines}
                  onChange={(checked) => setShowGridlines(checked)}
                  label="Print gridlines"
                />
                <Checkbox
                  checked={showHeaders}
                  onChange={(checked) => setShowHeaders(checked)}
                  label="Print row and column headings"
                />
              </div>
            </div>

            {/* Filename Section (for PDF) */}
            {onExportPdf && (
              <div className="mb-5">
                <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
                  PDF Filename
                </SectionLabel>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    className="flex-1 h-8 px-2 py-0"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="Enter filename"
                  />
                  <span className="text-body text-ss-text-secondary">.pdf</span>
                </div>
              </div>
            )}
          </TabPanel>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {onPrint && (
          <Button variant="primary" onClick={handlePrint}>
            Print
          </Button>
        )}
        {onExportPdf && (
          <Button variant="danger" onClick={handleExportPdf}>
            Export PDF
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

export function PrintPdfDialogWrapper() {
  const isOpen = useUIStore((s) => s.printDialogOpen);
  const deps = useActionDependencies();

  const handleClose = useCallback(() => {
    dispatch('CLOSE_PRINT_PDF_DIALOG', deps);
  }, [deps]);

  const handlePrint = useCallback(() => {
    dispatch('QUICK_PRINT', deps);
  }, [deps]);

  const handleExportPdf = useCallback(() => {
    dispatch('EXPORT_PDF', deps, { openDialog: false });
  }, [deps]);

  if (!isOpen) return null;

  return (
    <PrintPdfDialog
      isOpen={isOpen}
      onClose={handleClose}
      onPrint={handlePrint}
      onExportPdf={handleExportPdf}
    />
  );
}
