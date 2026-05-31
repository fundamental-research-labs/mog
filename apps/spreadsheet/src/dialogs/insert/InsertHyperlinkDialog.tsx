/**
 * Insert Hyperlink Dialog
 *
 * A dialog for inserting, editing, and removing hyperlinks on cells.
 * Supports URL links with optional display text.
 *
 * Features:
 * - Insert new hyperlinks
 * - Edit existing hyperlinks (pre-populated URL)
 * - Remove hyperlinks
 * - URL validation (http, https, mailto, tel schemes)
 * - Display text (optional - uses URL if blank)
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Input,
} from '@mog/shell';
import { displayStringOrNull } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
// =============================================================================
// Types
// =============================================================================

interface InsertHyperlinkDialogProps {
  /** Called when a hyperlink is saved (insert or update) */
  onSave?: (url: string, displayText?: string) => void;
  /** Called when a hyperlink is removed */
  onRemove?: () => void;
}

// =============================================================================
// URL Validation
// =============================================================================

/**
 * Allowed URL schemes for hyperlinks.
 * Security: Block javascript:, data:, vbscript: to prevent XSS attacks.
 */
const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Validate URL format and security.
 * Returns an error message if invalid, or null if valid.
 */
function validateUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return 'URL is required';
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return 'URL is required';
  }

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_SCHEMES.includes(parsed.protocol.toLowerCase())) {
      return `Invalid URL scheme. Allowed: http, https, mailto, tel`;
    }
    return null; // Valid
  } catch {
    return 'Invalid URL format. Please enter a valid URL starting with http://, https://, mailto:, or tel:';
  }
}

// =============================================================================
// Component
// =============================================================================

export function InsertHyperlinkDialog({ onSave, onRemove }: InsertHyperlinkDialogProps) {
  const hyperlinkDialog = useUIStore((s) => s.hyperlinkDialog);
  const closeDialog = useUIStore((s) => s.closeHyperlinkDialog);
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  const { isOpen, mode, targetRow, targetCol, existingUrl } = hyperlinkDialog;

  // Local state for form values
  const [url, setUrl] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Ref for initial focus (URL input)
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Get current cell value from Worksheet.viewport (sync, O(1))
  const vpCell = ws.viewport.getCellData(targetRow, targetCol);
  const cellValue = displayStringOrNull(vpCell?.displayText ?? null);
  const cellRef = `${colToLetter(targetCol)}${targetRow + 1}`;

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setUrl(existingUrl ?? '');
      setDisplayText(cellValue ?? '');
      setError(null);
    }
  }, [isOpen, existingUrl, cellValue]);

  // Validate URL on change
  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setUrl(newUrl);
      // Clear error when user starts typing
      if (error) {
        setError(null);
      }
    },
    [error],
  );

  // Handle OK button click
  // Worksheet API: setCell (display text) → setHyperlink. The order matters:
  // the kernel's setCell currently rewrites the cell record and would drop a
  // pre-existing hyperlink, so the hyperlink must be applied AFTER the value
  // is in place. We also chain via .then so the hyperlink write isn't queued
  // before the cell write resolves (avoiding a race that nulls the link).
  const handleOk = useCallback(() => {
    const validationError = validateUrl(url);
    if (validationError) {
      setError(validationError);
      return;
    }

    const trimmedUrl = url.trim();
    const trimmedDisplayText = displayText.trim();
    const wsRef = wb.getSheetById(activeSheetId);

    // Sequence the writes: cell value first (if needed), then hyperlink. The
    // hyperlink write is metadata-only and survives because nothing else
    // touches the cell after it.
    void (async () => {
      if (trimmedDisplayText && trimmedDisplayText !== cellValue) {
        await wsRef.setCell(targetRow, targetCol, trimmedDisplayText);
      }
      await wsRef.hyperlinks.set(targetRow, targetCol, trimmedUrl);
      await wsRef.formats.set(targetRow, targetCol, {
        fontColor: '#0563C1',
        underlineType: 'single',
      });
    })();

    // Call callback if provided
    onSave?.(trimmedUrl, trimmedDisplayText || undefined);

    closeDialog();
  }, [url, displayText, wb, activeSheetId, targetRow, targetCol, cellValue, onSave, closeDialog]);

  // Handle Remove button click
  // Worksheet API: removeHyperlink (no recalc needed - metadata only)
  const handleRemove = useCallback(() => {
    void wb.getSheetById(activeSheetId).hyperlinks.remove(targetRow, targetCol);
    onRemove?.();
    closeDialog();
  }, [wb, activeSheetId, targetRow, targetCol, onRemove, closeDialog]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  if (!isOpen) return null;

  const isEditMode = mode === 'edit';

  return (
    <Dialog
      open={isOpen}
      onClose={handleCancel}
      dialogId="hyperlink-dialog"
      width={450}
      initialFocusRef={urlInputRef}
      onEnterKeyDown={handleOk}
    >
      <DialogHeader onClose={handleCancel}>
        {isEditMode ? 'Edit Hyperlink' : 'Insert Hyperlink'}
      </DialogHeader>

      <DialogBody>
        {/* Cell info */}
        <div className="text-body-sm text-ss-text-secondary mb-4 p-3 bg-ss-surface-secondary rounded">
          Cell: <strong>{cellRef}</strong>
          {cellValue && (
            <>
              {' '}
              — Current value: <strong>{String(cellValue)}</strong>
            </>
          )}
        </div>

        {/* URL field */}
        <FormField
          label="URL"
          error={error ?? undefined}
          helpText={!error ? 'Supports: http://, https://, mailto:, tel:' : undefined}
          htmlFor="hyperlink-url"
        >
          <Input
            ref={urlInputRef}
            id="hyperlink-url"
            type="text"
            value={url}
            onChange={handleUrlChange}
            placeholder="https://example.com"
            error={!!error}
          />
        </FormField>

        {/* Display text field */}
        <FormField
          label="Display Text (optional)"
          helpText="Leave empty to keep current cell value or show URL"
          htmlFor="hyperlink-display-text"
        >
          <Input
            id="hyperlink-display-text"
            type="text"
            value={displayText}
            onChange={(e) => setDisplayText(e.target.value)}
            placeholder={cellValue ? String(cellValue) : 'Uses URL if empty'}
          />
        </FormField>
      </DialogBody>

      <DialogFooter className="justify-between">
        <div className="flex-1">
          {isEditMode && (
            <Button
              variant="secondary"
              onClick={handleRemove}
              className="border-ss-error text-ss-error hover:bg-ss-error/5"
            >
              Remove Link
            </Button>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleOk}>
            {isEditMode ? 'Update' : 'OK'}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
