/**
 * ProtectionDialogs Component
 *
 * Renders protection-related dialogs for handling protected cell access.
 * Currently only contains the Protection Alert Dialog.
 *
 * Editor & Protection
 * @see STREAM-H-EDITOR-PROTECTION.md
 */

import { ProtectionAlertDialog } from '../../../dialogs/protection/ProtectionAlertDialog';

export interface ProtectionDialogsProps {
  protectionAlertOpen: boolean;
  protectionAlertMessage: string | undefined;
  onDismiss: () => void;
}

/**
 * ProtectionDialogs - Renders protection alert dialog
 *
 * Protection Alert Dialog:
 * - Shown when user tries to edit a protected cell (Excel-parity)
 * - Displays informative message about why the edit was blocked
 * - User can dismiss to return to normal state
 */
export function ProtectionDialogs({
  protectionAlertOpen,
  protectionAlertMessage,
  onDismiss,
}: ProtectionDialogsProps) {
  return (
    <ProtectionAlertDialog
      state={{ open: protectionAlertOpen, message: protectionAlertMessage }}
      onDismiss={onDismiss}
    />
  );
}
