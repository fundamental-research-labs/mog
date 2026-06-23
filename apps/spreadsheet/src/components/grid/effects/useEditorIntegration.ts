/**
 * useEditorIntegration Effect Hook
 *
 * Wires up the editor checkbox cell toggle integration using the feature module pattern.
 *
 * Note: Editor-Yjs and Editor-Schema integrations are now handled at
 * SheetCoordinator construction time via config.editorDependencies.
 *
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import { useEffect } from 'react';

import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import { useWorkbook } from '../../../infra/context';

/**
 * Options for the useEditorIntegration hook.
 */
export interface UseEditorIntegrationOptions {
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
}

/**
 * Sets up editor integration for the coordinator.
 *
 * This hook wires up checkbox cell toggle integration using the feature module pattern.
 * Checkbox cells bypass the editor state machine entirely.
 *
 * @param options - Configuration options
 */
export function useEditorIntegration(options: UseEditorIntegrationOptions): void {
  const { coordinator } = options;
  const wb = useWorkbook();

  // Set Checkbox Toggle Integration using feature module pattern
  // Issue 2: Cell Dropdowns / In-Cell Pickers
  // Wires up the coordinator to toggle checkbox cells directly.
  // Checkbox cells bypass the editor state machine entirely.
  useEffect(() => {
    coordinator.grid.setCheckboxCoordination({
      getCellValue: (sheetId, row, col) => {
        // Use ViewportReader for viewport cells (sync, fast)
        const vpCell = wb.getSheetById(toSheetId(sheetId)).viewport.getCellData(row, col);
        return vpCell?.value ?? null;
      },
      setCellValue: (sheetId, row, col, value) => {
        // Convert boolean to uppercase string for Excel compatibility (TRUE/FALSE)
        const stringValue =
          typeof value === 'boolean' ? String(value).toUpperCase() : String(value);
        void wb.getSheetById(toSheetId(sheetId)).setCell(row, col, stringValue);
      },
      isCheckboxCell: (sheetId, row, col) => {
        // Check ViewportReader for schema/validation data indicating boolean type
        const vpCell = wb.getSheetById(toSheetId(sheetId)).viewport.getCellData(row, col);
        return vpCell?.schema_type === 'boolean';
      },
      setPendingUndoDescription: (description) => wb.setPendingUndoDescription(description),
    });
  }, [coordinator, wb]);
}
