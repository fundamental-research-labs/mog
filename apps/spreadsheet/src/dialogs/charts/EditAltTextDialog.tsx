/**
 * Edit Alt Text Dialog
 *
 * A dialog that allows users to edit the alt text (alternative text) for
 * accessibility on picture objects. Alt text helps screen readers describe
 * images to users with visual impairments.
 *
 * Matches Excel's Edit Alt Text dialog for familiarity.
 *
 * Architecture notes:
 * - Reads picture data directly from FloatingObjectManager (reads are OK)
 * - Writes picture updates via dispatch('UPDATE_PICTURE') for Unified Action System compliance
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Unified Action System pattern
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Label,
  Textarea,
} from '@mog/shell';
import type { PictureObject } from '@mog-sdk/contracts/floating-objects';
import { useFloatingObject } from '../../hooks/objects/use-floating-object';

// =============================================================================
// Component
// =============================================================================

export function EditAltTextDialog() {
  const editAltTextDialog = useUIStore((s) => s.editAltTextDialog);
  const closeDialog = useUIStore((s) => s.closeEditAltTextDialog);
  const deps = useActionDependencies();

  // Local state
  const [altText, setAltText] = useState<string>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { isOpen, targetObjectId } = editAltTextDialog;

  // Get the picture object
  const obj = useFloatingObject(targetObjectId ?? '');
  const picture = obj?.type === 'picture' ? (obj as PictureObject) : undefined;

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen && picture) {
      setAltText(picture.altText ?? '');
      // Focus the textarea after a short delay to ensure the dialog is rendered
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 50);
    }
  }, [isOpen, picture]);

  // Handle OK button click - uses dispatch() for Unified Action System compliance
  const handleOk = useCallback(() => {
    if (!targetObjectId) return;

    // Update the picture with new alt text via dispatch()
    dispatch('UPDATE_PICTURE', deps, {
      objectId: targetObjectId,
      updates: { altText: altText.trim() || undefined },
    });

    closeDialog();
  }, [deps, targetObjectId, altText, closeDialog]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Handle Enter key to submit (Ctrl+Enter in textarea)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleOk();
      }
    },
    [handleOk],
  );

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onClose={closeDialog} dialogId="edit-alt-text-dialog" width={480}>
      <DialogHeader onClose={handleCancel}>Edit Alt Text</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-3">
          <Label htmlFor="alt-text-input" className="text-body-sm font-medium">
            Alternative Text
          </Label>
          <Textarea
            ref={textareaRef}
            id="alt-text-input"
            value={altText}
            onChange={setAltText}
            onKeyDown={handleKeyDown}
            rows={4}
            className="w-full"
            placeholder="Describe this image for screen readers..."
            aria-label="Alternative text for image"
            aria-describedby="alt-text-helper"
          />
          <div id="alt-text-helper" className="text-caption text-ss-text-secondary">
            Alt text helps screen readers describe images to users with visual impairments.
            <br />
            Press Ctrl+Enter to save.
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
