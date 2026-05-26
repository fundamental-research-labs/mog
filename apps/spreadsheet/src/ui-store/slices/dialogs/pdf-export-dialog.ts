/**
 * PDF Export Dialog Slice
 *
 * Manages state for the PDF export dialog including options like
 * filename, page range, PDF/A compliance, and export progress.
 *
 */

import type { StateCreator } from 'zustand';

/**
 * Page range options for PDF export
 */
export type PageRangeType = 'all' | 'current' | 'custom';

/**
 * PDF export options configuration
 */
export interface PdfExportOptions {
  /** Filename for the exported PDF (without extension) */
  filename: string;
  /** Page range type: all sheets, current sheet, or custom range */
  pageRangeType: PageRangeType;
  /** Custom page range string (e.g., "1-5,8,10-12") when pageRangeType is 'custom' */
  customPageRange: string;
  /** Whether to include hyperlinks in the PDF */
  includeHyperlinks: boolean;
  /** Whether to use PDF/A compliance for archival */
  pdfACompliance: boolean;
  /** Whether to include document properties */
  includeDocumentProperties: boolean;
  /** Whether to export gridlines */
  exportGridlines: boolean;
  /** Whether to export row and column headings */
  exportHeadings: boolean;
}

/**
 * Export progress state
 */
export interface PdfExportProgress {
  /** Whether export is currently in progress */
  isExporting: boolean;
  /** Current progress (0-100) */
  progress: number;
  /** Status message to display */
  statusMessage: string;
  /** Whether the export can be cancelled */
  cancellable: boolean;
}

/**
 * PDF export dialog state
 */
export interface PdfExportDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Export options */
  options: PdfExportOptions;
  /** Export progress */
  exportProgress: PdfExportProgress;
  /** Error message if export failed */
  errorMessage: string | null;
}

export interface PdfExportDialogSlice {
  pdfExportDialog: PdfExportDialogState;
  openPdfExportDialog: () => void;
  closePdfExportDialog: () => void;
  setPdfExportOptions: (options: Partial<PdfExportOptions>) => void;
  startPdfExport: () => void;
  updatePdfExportProgress: (progress: number, statusMessage: string) => void;
  completePdfExport: () => void;
  cancelPdfExport: () => void;
  setPdfExportError: (message: string | null) => void;
}

const defaultOptions: PdfExportOptions = {
  filename: 'Spreadsheet',
  pageRangeType: 'all',
  customPageRange: '',
  includeHyperlinks: true,
  pdfACompliance: false,
  includeDocumentProperties: true,
  exportGridlines: false,
  exportHeadings: false,
};

const initialProgress: PdfExportProgress = {
  isExporting: false,
  progress: 0,
  statusMessage: '',
  cancellable: true,
};

const initialState: PdfExportDialogState = {
  isOpen: false,
  options: defaultOptions,
  exportProgress: initialProgress,
  errorMessage: null,
};

export const createPdfExportDialogSlice: StateCreator<
  PdfExportDialogSlice,
  [],
  [],
  PdfExportDialogSlice
> = (set) => ({
  pdfExportDialog: initialState,

  openPdfExportDialog: () => {
    set({
      pdfExportDialog: {
        ...initialState,
        isOpen: true,
      },
    });
  },

  closePdfExportDialog: () => {
    set({ pdfExportDialog: initialState });
  },

  setPdfExportOptions: (options: Partial<PdfExportOptions>) => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        options: {
          ...state.pdfExportDialog.options,
          ...options,
        },
      },
    }));
  },

  startPdfExport: () => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        exportProgress: {
          isExporting: true,
          progress: 0,
          statusMessage: 'Preparing export...',
          cancellable: true,
        },
        errorMessage: null,
      },
    }));
  },

  updatePdfExportProgress: (progress: number, statusMessage: string) => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        exportProgress: {
          ...state.pdfExportDialog.exportProgress,
          progress,
          statusMessage,
        },
      },
    }));
  },

  completePdfExport: () => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        exportProgress: {
          isExporting: false,
          progress: 100,
          statusMessage: 'Export complete!',
          cancellable: false,
        },
      },
    }));
  },

  cancelPdfExport: () => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        exportProgress: initialProgress,
      },
    }));
  },

  setPdfExportError: (message: string | null) => {
    set((state) => ({
      pdfExportDialog: {
        ...state.pdfExportDialog,
        exportProgress: initialProgress,
        errorMessage: message,
      },
    }));
  },
});
