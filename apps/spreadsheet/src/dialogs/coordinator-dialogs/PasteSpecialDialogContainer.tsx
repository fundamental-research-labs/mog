/**
 * PasteSpecialDialogContainer
 *
 * Container component that wires PasteSpecialDialog to the clipboard state machine.
 * Must be rendered inside SpreadsheetCoordinatorProvider to access coordinator hooks.
 */

import { useCallback } from 'react';
import { useActiveCell, useClipboard, useUIStore } from '../../internal-api';
import { PasteSpecialDialog } from '../paste/PasteSpecialDialog';

export function PasteSpecialDialogContainer() {
  const { pasteSpecial } = useClipboard();
  const { activeCell } = useActiveCell();

  const handlePaste = useCallback(
    (options: import('../../systems/shared/types').PasteSpecialOptions) => {
      if (activeCell) {
        pasteSpecial(activeCell, options);
      }
    },
    [activeCell, pasteSpecial],
  );

  // Always enabled - unifiedPaste handles empty clipboard gracefully (Excel behavior)
  return <PasteSpecialDialog onPaste={handlePaste} />;
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts PasteSpecialDialogContainer when the dialog is open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 *
 */
export function PasteSpecialDialogContainerWrapper() {
  const isOpen = useUIStore((s) => s.pasteSpecialDialogOpen);
  if (!isOpen) return null;
  return <PasteSpecialDialogContainer />;
}
