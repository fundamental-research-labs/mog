/**
 * Text effects editor component
 *
 * Inline text editor shown when editing a text-effects object.
 * Triggered by double-clicking on a text-effects object or starting text editing mode.
 *
 * ARCHITECTURE:
 * - Reads initial text from FloatingObjectManager via object ID
 * - Uses local state for text input (live preview while typing)
 * - Commits changes via dispatch('COMMIT_TEXT_EFFECT_TEXT', deps, payload)
 * - Cancels via dispatch('CANCEL_TEXT_EFFECT_EDIT', deps)
 * - Uses editingTextEffectId from TextEffect UI slice for visibility
 *
 * KEY BEHAVIORS:
 * - Enter: Commit text changes
 * - Escape: Cancel editing (discard changes)
 * - Blur: Commit text changes (same as Enter)
 *
 * Text Editor Component
 * Text Editing Mode
 */

import type { KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TextBoxObject } from '@mog-sdk/contracts/floating-objects';
import { dispatch } from '../../actions';
import { useFloatingObject } from '../../hooks/objects/use-floating-object';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { PRODUCT_VOCABULARY } from '../../ux/product-vocabulary';
import { Button, Textarea } from '@mog/shell/components/ui';

// =============================================================================
// Types
// =============================================================================

/**
 * Bounds for positioning the editor overlay.
 */
interface EditorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// =============================================================================
// Component
// =============================================================================

/**
 * TextEffect Text Editor
 *
 * Overlay component for editing TextEffect text inline.
 * Positioned over the canvas at the TextEffect object's location.
 *
 * Features:
 * - Appears as a modal overlay when editingTextEffectId is set
 * - Auto-focuses textarea on mount
 * - Enter commits changes, Escape cancels
 * - Blur commits changes (like Excel behavior)
 *
 * @example
 * ```tsx
 * // Render in SpreadsheetLayout alongside other overlays
 * <SpreadsheetLayout>
 * {/* ... canvas ... *\/}
 * <TextBoxEditorOverlay />
 * <TextEffectTextEditor />
 * {/* ... other overlays ... *\/}
 * </SpreadsheetLayout>
 * ```
 */
export function TextEffectTextEditor(): ReactElement | null {
  const deps = useActionDependencies();
  const workbook = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // Get editing state from UIStore
  const editingTextEffectId = useUIStore((s) => s.editingTextEffectId);

  // Reactively subscribe to the floating object being edited
  const obj = useFloatingObject(editingTextEffectId ?? '');

  // Local state for text input
  const [text, setText] = useState('');
  const [bounds, setBounds] = useState<EditorBounds | null>(null);

  // Ref for textarea focus management
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track if we're in the process of committing to prevent double-commit
  const isCommittingRef = useRef(false);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Load initial text and bounds when editing starts
  useEffect(() => {
    if (!editingTextEffectId || !obj || obj.type !== 'textbox') {
      setBounds(null);
      return;
    }

    const textbox = obj as TextBoxObject;

    // Only allow editing TextEffect textboxes
    if (!textbox.textEffects) {
      setBounds(null);
      return;
    }

    // Set initial text
    setText(textbox.text?.content || '');

    // Get object bounds for positioning via the Worksheet API handle
    void (async () => {
      const ws = workbook.getSheetById(activeSheetId);
      const textEffectsHandle = await ws.textEffects.get(editingTextEffectId);
      if (textEffectsHandle) {
        const objectBounds = textEffectsHandle.getBounds();
        if (objectBounds) {
          setBounds({
            x: objectBounds.x,
            y: objectBounds.y,
            width: Math.max(objectBounds.width, 200), // Minimum width for usability
            height: Math.max(objectBounds.height, 60), // Minimum height for usability
          });
        }
      }
    })();

    // Reset committing flag when editing starts
    isCommittingRef.current = false;
  }, [editingTextEffectId, obj, workbook, activeSheetId]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (bounds && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [bounds]);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Handle text change - update local state for live preview.
   */
  const handleChange = useCallback((value: string) => {
    setText(value);
  }, []);

  /**
   * Commit text changes to TextEffect object.
   * Uses dispatch pattern to ensure proper state management.
   */
  const handleCommit = useCallback(() => {
    if (!editingTextEffectId || isCommittingRef.current) return;

    // Prevent double-commit (blur can fire after Enter)
    isCommittingRef.current = true;

    dispatch('COMMIT_TEXT_EFFECT_TEXT', deps, {
      objectId: editingTextEffectId,
      text,
    });
  }, [deps, editingTextEffectId, text]);

  /**
   * Cancel editing without committing changes.
   * Uses dispatch pattern for proper action tracking.
   */
  const handleCancel = useCallback(() => {
    if (isCommittingRef.current) return;

    // Mark as committing to prevent blur from triggering commit
    isCommittingRef.current = true;

    dispatch('CANCEL_TEXT_EFFECT_EDIT', deps);
  }, [deps]);

  /**
   * Handle keyboard events.
   * - Enter: Commit (Shift+Enter for newline)
   * - Escape: Cancel
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Enter without Shift commits (Shift+Enter for newline in multi-line)
        e.preventDefault();
        e.stopPropagation();
        handleCommit();
      }
    },
    [handleCommit, handleCancel],
  );

  /**
   * Handle blur - commit changes when clicking outside.
   * Small delay to allow click events to process first.
   */
  const handleBlur = useCallback(() => {
    // Small delay to allow cancel button clicks to process first
    setTimeout(() => {
      if (!isCommittingRef.current) {
        handleCommit();
      }
    }, 100);
  }, [handleCommit]);

  /**
   * Handle backdrop click - cancel editing.
   */
  const handleBackdropClick = useCallback(() => {
    handleCancel();
  }, [handleCancel]);

  /**
   * Prevent click propagation from editor content.
   */
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // ==========================================================================
  // Render
  // ==========================================================================

  // Don't render if not editing
  if (!editingTextEffectId || !bounds) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-ss-modal flex items-center justify-center bg-ss-overlay-light"
      onClick={handleBackdropClick}
      role="dialog"
      aria-label={`Edit ${PRODUCT_VOCABULARY.textEffects.label.toLowerCase()} text`}
      aria-modal="true"
    >
      <div
        className="bg-ss-surface rounded-ss-lg shadow-ss-dropdown p-4 min-w-[300px] max-w-[600px]"
        onClick={handleContentClick}
        style={{
          // Position near the text-effects object if bounds are available
          // But center in viewport for better UX
          width: Math.min(bounds.width + 48, 600),
        }}
      >
        {/* Header */}
        <label
          htmlFor="text-effects-text-input"
          className="text-body-sm font-medium text-ss-text mb-2 block"
        >
          Edit {PRODUCT_VOCABULARY.textEffects.label} text
        </label>

        {/* Text Input */}
        <Textarea
          id="text-effects-text-input"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="text-section font-bold"
          rows={3}
          resize="none"
          placeholder="Enter text..."
          aria-label={`${PRODUCT_VOCABULARY.textEffects.label} text content`}
        />

        {/* Footer with buttons */}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="secondary" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleCommit}>
            OK
          </Button>
        </div>

        {/* Help text */}
        <p className="text-caption text-ss-text-tertiary mt-2">
          Press Enter to save, Escape to cancel. Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}
