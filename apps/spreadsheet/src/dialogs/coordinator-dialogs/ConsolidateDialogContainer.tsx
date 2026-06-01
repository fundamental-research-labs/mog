/**
 * ConsolidateDialogContainer
 *
 * Wrapper that only mounts ConsolidateDialog when the dialog is open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 */

import { useUIStore } from '../../internal-api';
import { ConsolidateDialog } from '../data/ConsolidateDialog';

export function ConsolidateDialogContainerWrapper() {
  const isOpen = useUIStore((s) => s.consolidateDialog.isOpen);
  if (!isOpen) return null;
  return <ConsolidateDialog />;
}
