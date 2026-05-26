/**
 * PDF Export Dialog Component
 *
 * Dialog for configuring and executing PDF export operations.
 * Provides options for filename, page range, PDF/A compliance,
 * hyperlinks, and shows progress during export.
 *
 * Features:
 * - Filename configuration
 * - Page range selection (all, current sheet, custom)
 * - PDF/A compliance for archival
 * - Include/exclude hyperlinks
 * - Progress indicator with cancel button
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  SectionLabel,
} from '@mog/shell';
import type { PageRangeType } from '../../ui-store/slices';

// =============================================================================
// Constants
// =============================================================================

const PAGE_RANGE_OPTIONS: Array<{ value: PageRangeType; label: string }> = [
  { value: 'all', label: 'All sheets' },
  { value: 'current', label: 'Current sheet only' },
  { value: 'custom', label: 'Custom page range' },
];

// =============================================================================
// Component
// =============================================================================

export interface PdfExportDialogProps {
  /** Callback to execute the export */
  onExport?: (options: {
    filename: string;
    pageRangeType: PageRangeType;
    customPageRange: string;
    includeHyperlinks: boolean;
    pdfACompliance: boolean;
    includeDocumentProperties: boolean;
    exportGridlines: boolean;
    exportHeadings: boolean;
  }) => Promise<void>;
}

export function PdfExportDialog({ onExport }: PdfExportDialogProps) {
  const filenameInputRef = useRef<HTMLInputElement>(null);

  // Get dialog state from UIStore
  const dialogState = useUIStore((s) => s.pdfExportDialog);
  const setPdfExportOptions = useUIStore((s) => s.setPdfExportOptions);
  const closePdfExportDialog = useUIStore((s) => s.closePdfExportDialog);
  const startPdfExport = useUIStore((s) => s.startPdfExport);
  const completePdfExport = useUIStore((s) => s.completePdfExport);
  const cancelPdfExport = useUIStore((s) => s.cancelPdfExport);
  const setPdfExportError = useUIStore((s) => s.setPdfExportError);

  // Local validation state
  const [filenameError, setFilenameError] = useState<string | null>(null);
  const [pageRangeError, setPageRangeError] = useState<string | null>(null);

  const { isOpen, options, exportProgress, errorMessage } = dialogState;

  // Focus filename input when dialog opens
  useEffect(() => {
    if (isOpen && !exportProgress.isExporting) {
      setTimeout(() => {
        filenameInputRef.current?.focus();
        filenameInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, exportProgress.isExporting]);

  // Validate filename
  const validateFilename = useCallback((filename: string): boolean => {
    if (!filename.trim()) {
      setFilenameError('Filename is required');
      return false;
    }
    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(filename)) {
      setFilenameError('Filename contains invalid characters');
      return false;
    }
    setFilenameError(null);
    return true;
  }, []);

  // Validate page range
  const validatePageRange = useCallback(
    (pageRangeType: PageRangeType, customRange: string): boolean => {
      if (pageRangeType !== 'custom') {
        setPageRangeError(null);
        return true;
      }
      if (!customRange.trim()) {
        setPageRangeError('Page range is required');
        return false;
      }
      // Validate format: numbers, commas, and dashes (e.g., "1-5,8,10-12")
      const validFormat = /^(\d+(-\d+)?)(,\d+(-\d+)?)*$/;
      if (!validFormat.test(customRange.replace(/\s/g, ''))) {
        setPageRangeError('Invalid format. Use: 1-5,8,10-12');
        return false;
      }
      setPageRangeError(null);
      return true;
    },
    [],
  );

  // Handle filename change
  const handleFilenameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setPdfExportOptions({ filename: value });
      validateFilename(value);
    },
    [setPdfExportOptions, validateFilename],
  );

  // Handle page range type change
  const handlePageRangeTypeChange = useCallback(
    (type: PageRangeType) => {
      setPdfExportOptions({ pageRangeType: type });
      validatePageRange(type, options.customPageRange);
    },
    [setPdfExportOptions, validatePageRange, options.customPageRange],
  );

  // Handle custom page range change
  const handleCustomPageRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setPdfExportOptions({ customPageRange: value });
      validatePageRange(options.pageRangeType, value);
    },
    [setPdfExportOptions, validatePageRange, options.pageRangeType],
  );

  // Handle export button click
  const handleExport = useCallback(async () => {
    // Validate all inputs
    const isFilenameValid = validateFilename(options.filename);
    const isPageRangeValid = validatePageRange(options.pageRangeType, options.customPageRange);

    if (!isFilenameValid || !isPageRangeValid) {
      return;
    }

    // Start export
    startPdfExport();

    try {
      if (onExport) {
        await onExport(options);
      } else {
        // Simulate export for demo purposes
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      completePdfExport();
      // Auto-close after a short delay on success
      setTimeout(() => {
        closePdfExportDialog();
      }, 1000);
    } catch (error) {
      setPdfExportError(error instanceof Error ? error.message : 'Export failed');
    }
  }, [
    options,
    validateFilename,
    validatePageRange,
    startPdfExport,
    completePdfExport,
    closePdfExportDialog,
    setPdfExportError,
    onExport,
  ]);

  // Handle cancel during export
  const handleCancelExport = useCallback(() => {
    cancelPdfExport();
  }, [cancelPdfExport]);

  // Handle dialog close
  const handleClose = useCallback(() => {
    if (exportProgress.isExporting) {
      cancelPdfExport();
    }
    closePdfExportDialog();
  }, [exportProgress.isExporting, cancelPdfExport, closePdfExportDialog]);

  if (!isOpen) return null;

  const isExporting = exportProgress.isExporting;

  return (
    <Dialog
      onEnterKeyDown={handleExport}
      open={isOpen}
      onClose={handleClose}
      dialogId="pdf-export-dialog"
      width={480}
    >
      <DialogHeader onClose={handleClose}>Export to PDF</DialogHeader>

      <DialogBody>
        {/* Export Progress Overlay */}
        {isExporting && (
          <div className="absolute inset-0 bg-ss-surface/80 flex flex-col items-center justify-center z-ss-overlay rounded-ss-lg">
            <div className="w-64 mb-4">
              <div className="h-2 bg-ss-surface-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-ss-primary transition-all duration-ss-slow ease-out"
                  style={{ width: `${exportProgress.progress}%` }}
                />
              </div>
            </div>
            <div className="text-body text-ss-text-secondary mb-4">
              {exportProgress.statusMessage}
            </div>
            {exportProgress.cancellable && (
              <Button variant="secondary" size="sm" onClick={handleCancelExport}>
                Cancel
              </Button>
            )}
          </div>
        )}

        {/* Error Message */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-ss-error/10 border border-ss-error rounded-ss-md">
            <span className="text-ss-error text-body">{errorMessage}</span>
          </div>
        )}

        {/* Filename Section */}
        <div className="mb-5">
          <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
            File Name
          </SectionLabel>
          <div className="flex items-center gap-2">
            <Input
              ref={filenameInputRef}
              type="text"
              value={options.filename}
              onChange={handleFilenameChange}
              error={!!filenameError}
              disabled={isExporting}
              className="flex-1"
              placeholder="Enter filename"
            />
            <span className="text-body-sm text-ss-text-secondary">.pdf</span>
          </div>
          {filenameError && <div className="text-caption text-ss-error mt-1">{filenameError}</div>}
        </div>

        {/* Page Range Section */}
        <div className="mb-5">
          <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
            Page Range
          </SectionLabel>
          <div className="flex flex-col gap-2">
            {PAGE_RANGE_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pageRange"
                  value={option.value}
                  checked={options.pageRangeType === option.value}
                  onChange={() => handlePageRangeTypeChange(option.value)}
                  disabled={isExporting}
                  className="w-4 h-4 cursor-pointer accent-ss-primary"
                />
                <span className="text-body text-ss-text">{option.label}</span>
              </label>
            ))}
          </div>

          {options.pageRangeType === 'custom' && (
            <div className="mt-2 ml-6">
              <Input
                type="text"
                value={options.customPageRange}
                onChange={handleCustomPageRangeChange}
                error={!!pageRangeError}
                disabled={isExporting}
                className="w-48"
                placeholder="e.g., 1-5,8,10-12"
              />
              {pageRangeError && (
                <div className="text-caption text-ss-error mt-1">{pageRangeError}</div>
              )}
            </div>
          )}
        </div>

        {/* PDF Options Section */}
        <div className="mb-5">
          <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
            PDF Options
          </SectionLabel>
          <div className="flex flex-col gap-3">
            <Checkbox
              checked={options.includeHyperlinks}
              onChange={(checked) => setPdfExportOptions({ includeHyperlinks: checked })}
              label="Include hyperlinks"
              disabled={isExporting}
            />
            <Checkbox
              checked={options.pdfACompliance}
              onChange={(checked) => setPdfExportOptions({ pdfACompliance: checked })}
              label="PDF/A compliance (for archival)"
              disabled={isExporting}
            />
            <Checkbox
              checked={options.includeDocumentProperties}
              onChange={(checked) => setPdfExportOptions({ includeDocumentProperties: checked })}
              label="Include document properties"
              disabled={isExporting}
            />
          </div>
        </div>

        {/* Print Options Section */}
        <div className="mb-5">
          <SectionLabel size="sm" className="mb-3 font-semibold text-text-ss-primary">
            Print Options
          </SectionLabel>
          <div className="flex flex-col gap-3">
            <Checkbox
              checked={options.exportGridlines}
              onChange={(checked) => setPdfExportOptions({ exportGridlines: checked })}
              label="Export gridlines"
              disabled={isExporting}
            />
            <Checkbox
              checked={options.exportHeadings}
              onChange={(checked) => setPdfExportOptions({ exportHeadings: checked })}
              label="Export row and column headings"
              disabled={isExporting}
            />
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleExport}
          disabled={isExporting || !!filenameError || !!pageRangeError}
        >
          {isExporting ? 'Exporting...' : 'Export'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
