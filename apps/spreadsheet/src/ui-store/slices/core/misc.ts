/**
 * Misc Slice
 *
 * Manages miscellaneous UI state that doesn't warrant its own slice.
 * Includes: recent number formats, calculation mode, page break preview,
 * command palette, paste special, format cells dialog, and protection alert.
 */

import type { StateCreator } from 'zustand';

export const FORMAT_CELLS_TAB_IDS = [
  'number',
  'alignment',
  'font',
  'border',
  'fill',
  'protection',
] as const;

export type FormatCellsTabId = (typeof FORMAT_CELLS_TAB_IDS)[number];

export function isFormatCellsTabId(value: unknown): value is FormatCellsTabId {
  return typeof value === 'string' && (FORMAT_CELLS_TAB_IDS as readonly string[]).includes(value);
}

export interface MiscSlice {
  // Recent number formats (for quick access in number format panel)
  /** Recently used number format codes (most recent first, max 10) */
  recentNumberFormats: string[];
  addRecentNumberFormat: (format: string) => void;

  // Calculation mode
  /** Calculation mode: 'auto' (default) or 'manual' */
  calculationMode: 'auto' | 'manual';
  setCalculationMode: (mode: 'auto' | 'manual') => void;

  // Page break preview mode
  /** Whether page break preview mode is enabled (shows page break lines) */
  pageBreakPreviewMode: boolean;
  togglePageBreakPreviewMode: () => void;
  setPageBreakPreviewMode: (enabled: boolean) => void;

  // Command palette
  /** Whether the command palette is open */
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  // Paste special dialog
  /** Whether the paste special dialog is open */
  pasteSpecialDialogOpen: boolean;
  openPasteSpecialDialog: () => void;
  closePasteSpecialDialog: () => void;

  // Format cells dialog (Context Menu Parity)
  /** Whether the format cells dialog is open */
  formatCellsDialogOpen: boolean;
  /** Initial tab to show when opening format cells dialog */
  formatCellsDialogInitialTab?: FormatCellsTabId;
  openFormatCellsDialog: (initialTab?: FormatCellsTabId) => void;
  closeFormatCellsDialog: () => void;

  // Protection alert dialog
  /** Whether the protection alert dialog is open */
  protectionAlertOpen: boolean;
  /** Custom message for protection alert (optional) */
  protectionAlertMessage: string | undefined;
  /** Show protection alert with optional custom message */
  showProtectionAlert: (message?: string) => void;
  /** Dismiss protection alert */
  dismissProtectionAlert: () => void;

  // Print/PDF dialog
  /** Whether the print/PDF dialog is open */
  printDialogOpen: boolean;
  /** Open the print/PDF dialog */
  openPrintDialog: () => void;
  /** Close the print/PDF dialog */
  closePrintDialog: () => void;

  // Page Setup dialog (Excel parity quickwin A10)
  /** Whether the page setup dialog is open */
  pageSetupDialogOpen: boolean;
  /** Initial tab to show when opening page setup dialog */
  pageSetupDialogInitialTab?: 'page' | 'margins' | 'headerFooter' | 'sheet';
  /** Open the page setup dialog */
  openPageSetupDialog: (initialTab?: 'page' | 'margins' | 'headerFooter' | 'sheet') => void;
  /** Close the page setup dialog */
  closePageSetupDialog: () => void;

  // Font warning (Fonts/Typography)
  /** Warning message when a font is not available on the system */
  fontWarningMessage: string | null;
  /** Show font warning with the unavailable font name */
  showFontWarning: (fontName: string) => void;
  /** Dismiss font warning */
  dismissFontWarning: () => void;

  // Font preview on hover
  /**
   * Preview font that is temporarily applied to selected cells on hover.
   * When set, cells should render with this font instead of their actual font.
   * When null, cells render with their actual font.
   */
  previewFont: string | null;
  /** Set preview font (on hover) */
  setPreviewFont: (fontFamily: string | null) => void;
  /** Clear preview font (on mouse leave) */
  clearPreviewFont: () => void;

  // Scroll Lock Mode
  /**
   * Whether scroll lock mode is enabled.
   * When enabled, arrow keys scroll the viewport without moving the selection.
   * This emulates Excel's Scroll Lock key behavior.
   *
   * Note: Browser support for the physical Scroll Lock key is unreliable,
   * so we provide a toggle button and keyboard shortcut (Ctrl+Alt+L) as alternatives.
   */
  scrollLockEnabled: boolean;
  /** Toggle scroll lock mode */
  toggleScrollLock: () => void;
  /** Set scroll lock mode explicitly */
  setScrollLock: (enabled: boolean) => void;

  // Backstage Print View - Print Scope & Page Range
  /**
   * Print scope: what to print (active sheet, entire workbook, or selection).
   * Used by the Backstage Print View "Print What" dropdown.
   */
  printScope: 'active_sheet' | 'workbook' | 'selection';
  /** Set the print scope */
  setPrintScope: (scope: 'active_sheet' | 'workbook' | 'selection') => void;

  /**
   * Print page range. If undefined, print all pages.
   * Used by the Backstage Print View page range inputs.
   */
  printPageRange: { from?: number; to?: number } | undefined;
  /** Set the print page range (from/to are 1-indexed) */
  setPrintPageRange: (range: { from?: number; to?: number } | undefined) => void;

  /**
   * Trigger a quick print operation (bypass print dialog).
   * This callback should be implemented by the UI layer to call window.print().
   */
  triggerQuickPrint: () => void;
  /**
   * Quick print callback - set by the UI layer.
   * The triggerQuickPrint method calls this callback when set.
   */
  _quickPrintCallback?: () => void;
  /** Set the quick print callback (called by UI layer to register handler) */
  setQuickPrintCallback: (callback: () => void) => void;

  // Thesaurus Dialog (Review Tab Proofing)
  /** Whether the thesaurus dialog is open */
  thesaurusDialogOpen: boolean;
  /** Word to look up in the thesaurus (from selected text or cell value) */
  thesaurusWord: string | null;
  /** Error message when thesaurus lookup fails */
  thesaurusError: string | null;
  /** Open the thesaurus dialog with optional initial word */
  openThesaurusDialog: (word?: string | null) => void;
  /** Close the thesaurus dialog */
  closeThesaurusDialog: () => void;
  /** Set thesaurus error message */
  setThesaurusError: (error: string | null) => void;

  // Macro Recording (View Tab Macros)
  /** Macro recording state */
  macroRecording: {
    /** Whether macro recording is currently active */
    isRecording: boolean;
  };
  /** Toggle macro recording on/off */
  toggleMacroRecording: () => void;
  /** Stop macro recording (sets isRecording to false) */
  stopMacroRecording: () => void;

  // Workbook Statistics Dialog (Review Tab Proofing)
  /** Whether the workbook statistics dialog is open */
  workbookStatisticsDialogOpen: boolean;
  /** Open the workbook statistics dialog */
  openWorkbookStatisticsDialog: () => void;
  /** Close the workbook statistics dialog */
  closeWorkbookStatisticsDialog: () => void;
}

export const createMiscSlice: StateCreator<MiscSlice, [], [], MiscSlice> = (set) => ({
  // Recent number formats
  recentNumberFormats: [],

  addRecentNumberFormat: (format: string) => {
    // Don't add General or empty formats
    if (!format || format === 'General') return;

    set((s) => {
      const existing = s.recentNumberFormats;
      // Remove if already exists (will re-add at front)
      const filtered = existing.filter((f) => f !== format);
      // Add to front, limit to 10
      const updated = [format, ...filtered].slice(0, 10);
      return { recentNumberFormats: updated };
    });
  },

  // Calculation mode
  calculationMode: 'auto',

  setCalculationMode: (mode: 'auto' | 'manual') => {
    set({ calculationMode: mode });
  },

  // Page break preview mode
  pageBreakPreviewMode: false,

  togglePageBreakPreviewMode: () => {
    set((s) => ({ pageBreakPreviewMode: !s.pageBreakPreviewMode }));
  },

  setPageBreakPreviewMode: (enabled: boolean) => {
    set({ pageBreakPreviewMode: enabled });
  },

  // Command palette
  commandPaletteOpen: false,

  openCommandPalette: () => {
    set({ commandPaletteOpen: true });
  },

  closeCommandPalette: () => {
    set({ commandPaletteOpen: false });
  },

  // Paste special dialog
  pasteSpecialDialogOpen: false,

  openPasteSpecialDialog: () => {
    set({ pasteSpecialDialogOpen: true });
  },

  closePasteSpecialDialog: () => {
    set({ pasteSpecialDialogOpen: false });
  },

  // Format cells dialog
  formatCellsDialogOpen: false,
  formatCellsDialogInitialTab: undefined,

  openFormatCellsDialog: (initialTab?: FormatCellsTabId) => {
    set({ formatCellsDialogOpen: true, formatCellsDialogInitialTab: initialTab });
  },

  closeFormatCellsDialog: () => {
    set({ formatCellsDialogOpen: false, formatCellsDialogInitialTab: undefined });
  },

  // Protection alert dialog
  protectionAlertOpen: false,
  protectionAlertMessage: undefined,

  showProtectionAlert: (message?: string) => {
    set({ protectionAlertOpen: true, protectionAlertMessage: message });
  },

  dismissProtectionAlert: () => {
    set({ protectionAlertOpen: false, protectionAlertMessage: undefined });
  },

  // Print/PDF dialog
  printDialogOpen: false,

  openPrintDialog: () => {
    set({ printDialogOpen: true });
  },

  closePrintDialog: () => {
    set({ printDialogOpen: false });
  },

  // Page Setup dialog (Excel parity quickwin A10)
  pageSetupDialogOpen: false,
  pageSetupDialogInitialTab: undefined,

  openPageSetupDialog: (initialTab?: 'page' | 'margins' | 'headerFooter' | 'sheet') => {
    set({ pageSetupDialogOpen: true, pageSetupDialogInitialTab: initialTab });
  },

  closePageSetupDialog: () => {
    set({ pageSetupDialogOpen: false, pageSetupDialogInitialTab: undefined });
  },

  // Font warning (Fonts/Typography)
  fontWarningMessage: null,

  showFontWarning: (fontName: string) => {
    set({
      fontWarningMessage: `"${fontName}" is not installed. Text will display in a fallback font.`,
    });
  },

  dismissFontWarning: () => {
    set({ fontWarningMessage: null });
  },

  // Font preview on hover
  previewFont: null,

  setPreviewFont: (fontFamily: string | null) => {
    set({ previewFont: fontFamily });
  },

  clearPreviewFont: () => {
    set({ previewFont: null });
  },

  // Scroll Lock Mode
  scrollLockEnabled: false,

  toggleScrollLock: () => {
    set((s) => ({ scrollLockEnabled: !s.scrollLockEnabled }));
  },

  setScrollLock: (enabled: boolean) => {
    set({ scrollLockEnabled: enabled });
  },

  // Backstage Print View - Print Scope & Page Range
  printScope: 'active_sheet',

  setPrintScope: (scope: 'active_sheet' | 'workbook' | 'selection') => {
    set({ printScope: scope });
  },

  printPageRange: undefined,

  setPrintPageRange: (range: { from?: number; to?: number } | undefined) => {
    set({ printPageRange: range });
  },

  _quickPrintCallback: undefined,

  triggerQuickPrint: () => {
    // Get the callback from the store state and invoke it
    set((state) => {
      if (state._quickPrintCallback) {
        state._quickPrintCallback();
      } else {
        // Fallback: use window.print() if callback not registered
        if (typeof window !== 'undefined' && window.print) {
          window.print();
        }
      }
      return {};
    });
  },

  setQuickPrintCallback: (callback: () => void) => {
    set({ _quickPrintCallback: callback });
  },

  // Thesaurus Dialog (Review Tab Proofing)
  thesaurusDialogOpen: false,
  thesaurusWord: null,
  thesaurusError: null,

  openThesaurusDialog: (word?: string | null) => {
    set({ thesaurusDialogOpen: true, thesaurusWord: word ?? null, thesaurusError: null });
  },

  closeThesaurusDialog: () => {
    set({ thesaurusDialogOpen: false, thesaurusWord: null, thesaurusError: null });
  },

  setThesaurusError: (error: string | null) => {
    set({ thesaurusError: error });
  },

  // Macro Recording (View Tab Macros)
  macroRecording: {
    isRecording: false,
  },

  toggleMacroRecording: () => {
    set((s) => ({
      macroRecording: {
        ...s.macroRecording,
        isRecording: !s.macroRecording.isRecording,
      },
    }));
  },

  stopMacroRecording: () => {
    set((s) => ({
      macroRecording: {
        ...s.macroRecording,
        isRecording: false,
      },
    }));
  },

  // Workbook Statistics Dialog (Review Tab Proofing)
  workbookStatisticsDialogOpen: false,

  openWorkbookStatisticsDialog: () => {
    set({ workbookStatisticsDialogOpen: true });
  },

  closeWorkbookStatisticsDialog: () => {
    set({ workbookStatisticsDialogOpen: false });
  },
});
