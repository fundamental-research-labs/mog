/**
 * Text Box Editor Overlay
 *
 * Renders a text editing UI when a text box is being edited.
 * Follows the same pattern as the in-cell editor overlay.
 *
 * Text Box Dialog
 *
 * Architecture:
 * - Positioned absolutely over the text box using FloatingObject position data
 * - Reads initial content from FloatingObject (via Zustand cache)
 * - Writes updated content on commit via ws.objects.update()
 * - Uses object-interaction-machine for state management (editingObjectId)
 *
 * WYSIWYG NOTE:
 * Unlike InlineCellEditor which uses computeTextPosition() for exact WYSIWYG positioning,
 * TextBoxEditorOverlay uses CSS-based layout. Full WYSIWYG for text boxes would require:
 * 1. Reading the text box's font settings from FloatingObject
 * 2. Extending computeTextPosition() to handle text box-specific settings
 * 3. Applying the same positioning logic as the canvas text box renderer
 * This is deferred. Current approach: Position at object bounds,
 * use CSS for internal text layout.
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveSheetId } from '../../internal-api';
import { useFloatingObject } from '../../hooks/objects/use-floating-object';
import { useObjectInteraction } from '../../hooks/objects/use-object-interaction';
import { useWorksheet } from '../../infra/context';

// =============================================================================
// Styles (using design tokens via Tailwind classes where possible)
// =============================================================================

// Position styles must remain dynamic (set via inline style)
// but we use z-ss-modal token instead of hardcoded z-index

// =============================================================================
// Component
// =============================================================================

export function TextBoxEditorOverlay() {
  const activeSheetId = useActiveSheetId();
  const objectInteraction = useObjectInteraction();
  const ws = useWorksheet();

  const { editingObjectId, commitText, cancelText } = objectInteraction;

  const obj = useFloatingObject(editingObjectId ?? '');

  const [text, setText] = useState('');
  const [bounds, setBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get the object being edited and its bounds
  useEffect(() => {
    if (!editingObjectId || !obj || obj.type !== 'textbox') {
      setBounds(null);
      return;
    }

    // Get initial text content
    setText(obj.text?.content ?? '');

    // Read position data directly from the FloatingObject
    const pos = obj.position;
    if (pos.x != null && pos.y != null && pos.width != null && pos.height != null) {
      setBounds({
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      });
    }
  }, [editingObjectId, obj, activeSheetId]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (bounds && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [bounds]);

  // Handle text change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  }, []);

  // Handle commit (blur or Enter)
  const handleCommit = useCallback(() => {
    if (!editingObjectId) return;

    // Update the text box content via the worksheet objects API
    void ws.objects.update(editingObjectId, { text: { content: text } });

    // Signal state machine to exit editing
    commitText(text);
  }, [editingObjectId, ws.objects, text, commitText]);

  // Handle cancel (Escape)
  const handleCancel = useCallback(() => {
    cancelText();
  }, [cancelText]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Enter without Shift commits (Shift+Enter for newline)
        e.preventDefault();
        e.stopPropagation();
        handleCommit();
      }
    },
    [handleCommit, handleCancel],
  );

  // Handle blur
  const handleBlur = useCallback(() => {
    // Small delay to allow click events on other elements to process first
    setTimeout(() => {
      handleCommit();
    }, 100);
  }, [handleCommit]);

  // Don't render if not editing or no bounds
  if (!editingObjectId || !bounds) {
    return null;
  }

  return (
    <div
      className="absolute z-ss-modal box-border"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="w-full h-full border-2 border-ss-primary rounded-ss-sm p-1 text-ribbon font-ss-sans resize-none outline-none bg-ss-surface box-border"
        aria-label="Edit text box content"
      />
    </div>
  );
}
