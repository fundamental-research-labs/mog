/**
 * DeleteConfirmDialog - Confirmation dialog for file/folder deletion
 *
 * Shows a confirmation dialog before deleting files or folders.
 * Files are moved to system trash by default (recoverable).
 *
 * Copied from client/desktop/src/components/project/DeleteConfirmDialog.tsx
 * Adapted to use shell's Dialog component instead of AlertDialog.
 */

import { usePlatformInfo } from '../../hooks/use-platform-info';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/radix/Dialog';

export interface DeleteConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Name of the file or folder being deleted */
  name: string;
  /** Whether this is a directory (affects messaging) */
  isDirectory: boolean;
  /** Called when user confirms deletion */
  onConfirm: () => void;
  /** Whether delete is in progress (disables buttons) */
  isDeleting?: boolean;
}

/**
 * DeleteConfirmDialog shows a confirmation before deleting files or folders.
 *
 * The dialog informs users that:
 * - Files will be moved to system trash (recoverable)
 * - For folders, all contents will be deleted
 */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  name,
  isDirectory,
  onConfirm,
  isDeleting = false,
}: DeleteConfirmDialogProps) {
  const { isMacOS } = usePlatformInfo();
  const trashName = isMacOS ? 'Trash' : 'Recycle Bin';
  const itemType = isDirectory ? 'folder' : 'file';

  const handleConfirm = () => {
    onConfirm();
    // Dialog will close via onOpenChange after the operation completes
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog
      onEnterKeyDown={isDeleting ? undefined : handleConfirm}
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Delete {itemType}?</DialogHeader>
      <DialogBody>
        <div className="space-y-2">
          <p>
            Are you sure you want to delete <span className="font-medium break-all">{name}</span>?
          </p>
          {isDirectory && (
            <p className="text-amber-600">
              This will delete all files and subfolders inside this folder.
            </p>
          )}
          <p className="text-ss-text-secondary">
            This will delete the {itemType} from your computer. It will be moved to {trashName}{' '}
            where you can recover it.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={isDeleting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={isDeleting}>
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
