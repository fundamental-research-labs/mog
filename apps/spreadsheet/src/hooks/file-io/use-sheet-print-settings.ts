/**
 * usePrintSettings Hook
 *
 * Read-only reactive hook for sheet print settings (gridlines, headings,
 * orientation, paper size, margins, etc.).
 *
 * Page Layout dispatch: pruned the mutating `togglePrintGridlines` /
 * `togglePrintHeadings` methods. Toggles now route through
 * `dispatch('TOGGLE_PRINT_GRIDLINES' | 'TOGGLE_PRINT_HEADINGS')` — the
 * Unified Action System owns the write, this hook owns the read.
 *
 * Consumers (read-only):
 * - `apps/spreadsheet/src/chrome/toolbar/groups/SheetOptionsGroup.tsx`
 * - `apps/spreadsheet/src/chrome/toolbar/backstage/PrintPanel.tsx`
 * - `apps/spreadsheet/src/dialogs/print/PageSetupDialog.tsx`
 */

import { useEffect, useState } from 'react';

import type { PrintSettings, SheetId } from '@mog-sdk/contracts/core';
import { useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UsePrintSettingsReturn {
  /** Current print settings state */
  settings: PrintSettings;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for reading sheet print settings with reactive EventBus subscription.
 *
 * - Sync init from `wb.mirror.getPrintSettings(sheetId)` — the mirror returns
 * the schema default if no `Set` event has populated this field yet.
 * - Reactive updates via `sheet:print-settings-changed` events.
 *
 * Mutations: dispatch `TOGGLE_PRINT_GRIDLINES`, `TOGGLE_PRINT_HEADINGS`,
 * `APPLY_PAGE_SETUP`, `SET_PAGE_ORIENTATION`, etc. — never call writers
 * directly from the UI.
 *
 * @param sheetId - The sheet ID to read print settings for
 * @returns Read-only print settings state
 */
export function usePrintSettings(sheetId: SheetId): UsePrintSettingsReturn {
  const wb = useWorkbook();

  // Sync init from kernel state mirror.
  const [settings, setSettings] = useState<PrintSettings>(() =>
    wb.mirror.getPrintSettings(sheetId),
  );

  // Subscribe to ws.on for print settings changes
  useEffect(() => {
    const ws = wb.getSheetById(sheetId);
    // Re-sync from mirror on sheet change.
    setSettings(wb.mirror.getPrintSettings(sheetId));

    // Subscribe to sheet:print-settings-changed events
    const unsubscribe = ws.on('sheet:print-settings-changed', (event) => {
      setSettings(event.settings);
    });

    return unsubscribe;
  }, [wb, sheetId]);

  return { settings };
}
