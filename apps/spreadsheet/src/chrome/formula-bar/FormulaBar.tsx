/**
 * FormulaBar Component
 *
 * Displays the current cell address and allows editing cell values/formulas.
 * Implements FormulaBarProps contract from contracts/index.ts
 *
 *.2: Name box now uses NameBoxDropdown for interactive navigation.
 * Added confirm/cancel buttons for Excel parity.
 * Added syntax highlighting for formulas with parentheses matching.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import { CheckmarkSvg, CloseSvg } from '@mog/icons';
import { Input, Textarea } from '@mog/shell';
import { FormulaHighlighter } from '../../components/editor/FormulaHighlighter';
import type { FormulaBarProps } from '../../internal-api';
import { RibbonVisibilityPathItem } from '../toolbar/visibility/RibbonVisibilityContext';
import { NameBoxDropdown } from './NameBoxDropdown';

// =============================================================================
// Component
// =============================================================================

export function FormulaBar({
  cellAddress: _cellAddress, // Now handled by NameBoxDropdown internally
  value,
  isEditing,
  onChange,
  onCommit,
  onCancel,
  onFocus,
  onFxClick,
  onKeyDown: externalOnKeyDown,
  inputRef: externalInputRef,
  onContextMenu,
  // Formula Bar Expand/Collapse (Ctrl+Shift+U)
  isExpanded = false,
  onToggleExpand,
  // IME composition handlers
  onCompositionStart,
  onCompositionUpdate,
  onCompositionEnd,
  // Excel parity: Formula range color highlighting
  referenceColors,
  readOnly = false,
  // Chrome-symmetry contract: panel close handler. When invoked, the
  // formula bar is hidden and the View ribbon "Show formula bar" reopen
  // affordance becomes the visible path back. See plans for issue #116.
  onClosePanel,
  nlBarVisible,
  onToggleNLBar,
}: FormulaBarProps & {
  onClosePanel?: () => void;
  nlBarVisible?: boolean;
  onToggleNLBar?: () => void;
}) {
  // Support both input and textarea refs (textarea when expanded or multiline content)
  const internalInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Track cursor position for parentheses matching
  const [cursorPosition, setCursorPosition] = useState(0);

  // D.2: Use textarea when expanded or when content has newlines
  const isMultiLine = isExpanded || value.includes('\n');

  // Combine internal and external refs
  const setInputRef = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement | null) => {
      (
        internalInputRef as React.MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>
      ).current = el;
      // Only pass HTMLInputElement to external ref for backward compatibility
      externalInputRef?.(el as HTMLInputElement | null);
    },
    [externalInputRef],
  );

  // Focus input when editing starts from formula bar
  useEffect(() => {
    if (
      isEditing &&
      internalInputRef.current &&
      document.activeElement !== internalInputRef.current
    ) {
      // Only auto-focus if editing was started from formula bar
      // Cell-based editing should not steal focus
    }
  }, [isEditing]);

  // Track cursor position for syntax highlighting
  const handleSelect = useCallback(() => {
    const input = internalInputRef.current;
    if (input && typeof input.selectionStart === 'number') {
      setCursorPosition(input.selectionStart);
    }
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Mirror the DOM caret to the editor machine — see
      onChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    [onChange],
  );

  // D.1/D.2: Simplified onChange handler for Textarea component.
  // The wrapped `Textarea` component only forwards the new string, so we read
  // the caret from `internalInputRef`, which points at the same DOM node.
  const handleTextareaChange = useCallback(
    (newValue: string) => {
      const caret = internalInputRef.current?.selectionStart ?? newValue.length;
      onChange(newValue, caret);
    },
    [onChange],
  );

  /**
   * KEYBOARD CONTRACT: Navigation keys (Enter, Tab, Escape) are handled by
   * KeyboardCoordinator at document level. This component only handles:
   * - External handler passthrough (autocomplete)
   * - Ctrl+Enter for newline insertion (formula bar specific)
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Let external handler (autocomplete) handle first
      // Cast to input type for compatibility with external handler
      externalOnKeyDown?.(e as KeyboardEvent<HTMLInputElement>);
      if (e.defaultPrevented) return;

      // D.1: Ctrl+Enter in formula bar inserts line break (actual newline character)
      // This is formula bar specific behavior, not navigation
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Insert newline at cursor position
        const input = internalInputRef.current;
        if (input) {
          const start = input.selectionStart ?? value.length;
          const end = input.selectionEnd ?? value.length;
          const newValue = value.slice(0, start) + '\n' + value.slice(end);
          // Pass the post-newline caret (start + 1) to keep the machine in
          // sync with the DOM update we issue below. Without the explicit
          // cursor, the machine falls back to end-of-string and races the
          // setSelectionRange call here. See
          onChange(newValue, start + 1);
          // Set cursor position after the newline (async to allow React to update)
          setTimeout(() => {
            input.setSelectionRange(start + 1, start + 1);
          }, 0);
        }
      }
      // Enter, Tab, Escape navigation handled by KeyboardCoordinator
    },
    [externalOnKeyDown, onChange, value],
  );

  /**
   * A.1: Handle focus with cursor position from click.
   * When user clicks in formula bar, we calculate cursor position
   * from the click event and pass it to onFocus.
   */
  const handleFocus = useCallback(() => {
    // If focus comes from Tab or programmatic focus, there's no click position
    // In that case, the cursor will be at the end (default Edit Mode behavior)
    onFocus?.();
  }, [onFocus]);

  /**
   * A.1: Handle click to get cursor position.
   * The native input sets selectionStart based on click position.
   * We read it after the click and pass it to onFocus if editing isn't already started.
   */
  const handleClick = useCallback(
    (e: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = e.target as HTMLInputElement | HTMLTextAreaElement;
      // Get cursor position from native selection
      const clickPosition = input.selectionStart ?? 0;

      // If we're not editing yet, this click will start editing
      // Pass the cursor position so editing starts with cursor at click position
      if (!isEditing) {
        onFocus?.(clickPosition);
      } else {
        // Already editing - just update cursor position for syntax highlighting
        setCursorPosition(clickPosition);
      }
    },
    [isEditing, onFocus],
  );

  const isFormula = value.startsWith('=');

  // Height changes based on expanded state
  // Excel shows ~3 lines when expanded (~84px), single line when collapsed (~22px)
  const expandedHeight = 84;
  const collapsedHeight = 22;

  return (
    <div
      data-formula-bar
      data-testid="formula-bar"
      className={`flex px-2 bg-ss-surface text-ss-text gap-2 ${isExpanded ? 'items-start py-1' : 'items-center h-7'}`}
    >
      {/* Cell Address / Name Box -.2: Interactive dropdown */}
      <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'nameBox']}>
        <NameBoxDropdown />
      </RibbonVisibilityPathItem>

      {/* Formula Bar Confirm/Cancel Buttons (Excel parity) */}
      {/* Hidden in read-only mode — no editing affordances */}
      {!readOnly && (
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Cancel Button (X) - visible only when editing */}
          <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'cancelEdit']}>
            <button
              type="button"
              onClick={onCancel}
              className={`w-[22px] h-[22px] flex items-center justify-center rounded transition-colors ${
                isEditing
                  ? 'text-ss-error hover:bg-ss-error/10 cursor-pointer'
                  : 'text-ss-text-disabled cursor-default pointer-events-none opacity-50'
              }`}
              title="Cancel (Escape)"
              aria-label="Cancel edit"
              tabIndex={isEditing ? 0 : -1}
              disabled={!isEditing}
            >
              <CloseSvg className="w-4 h-4" />
            </button>
          </RibbonVisibilityPathItem>

          {/* Confirm Button (Checkmark) - visible only when editing */}
          <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'confirmEdit']}>
            <button
              type="button"
              onClick={onCommit}
              className={`w-[22px] h-[22px] flex items-center justify-center rounded transition-colors ${
                isEditing
                  ? 'text-ss-success hover:bg-ss-success/10 cursor-pointer'
                  : 'text-ss-text-disabled cursor-default pointer-events-none opacity-50'
              }`}
              title="Confirm (Enter)"
              aria-label="Confirm edit"
              tabIndex={isEditing ? 0 : -1}
              disabled={!isEditing}
            >
              <CheckmarkSvg className="w-4 h-4" />
            </button>
          </RibbonVisibilityPathItem>
        </div>
      )}

      {/* Function Icon - clickable (Excel parity quickwin A8) */}
      {/* Hidden in read-only mode */}
      {!readOnly && (
        <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'insertFunction']}>
          <button
            type="button"
            onClick={onFxClick}
            className="w-[22px] h-[22px] flex items-center justify-center text-ss-text-secondary text-body-lg italic shrink-0 hover:bg-ss-surface-hover rounded cursor-pointer transition-colors"
            title="Insert Function"
          >
            <span className="font-serif">fx</span>
          </button>
        </RibbonVisibilityPathItem>
      )}

      {/* Value/Formula Input with Syntax Highlighting Overlay */}
      {/* D.2: Uses Textarea when expanded to enable word wrapping for long formulas */}
      {/* ARCHITECTURE: Font metrics on parent so both overlay and Input inherit.
       * This ensures cursor alignment - both render text with identical metrics.
       * - text-ribbon: 11px font-size
       * - leading-none: line-height 1 (inputs and spans have different defaults)
       */}
      <div
        className="flex-1 relative text-ribbon leading-none"
        style={{ height: isExpanded ? expandedHeight : collapsedHeight }}
      >
        {/* Syntax highlighting overlay for formulas */}
        {isFormula && !isMultiLine && (
          <div
            className="absolute inset-0 pointer-events-none overflow-hidden flex items-center rounded-ss"
            style={{
              // Match Input padding and styling
              padding: '0 8px', // px-2 = 8px
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              // Add border/ring spacing to align with input
              border: '1px solid transparent',
            }}
            aria-hidden="true"
          >
            <FormulaHighlighter
              formula={value}
              cursorPosition={cursorPosition}
              isEditing={isEditing}
              referenceColors={referenceColors}
            />
          </div>
        )}
        {/* D.2: Render Textarea when expanded or content has newlines */}
        {isMultiLine ? (
          <Textarea
            ref={setInputRef as React.Ref<HTMLTextAreaElement>}
            value={value}
            size="ribbon"
            readOnly={readOnly}
            onChange={readOnly ? undefined : handleTextareaChange}
            onKeyDown={readOnly ? undefined : handleKeyDown}
            onFocus={readOnly ? undefined : handleFocus}
            onSelect={readOnly ? undefined : handleSelect}
            onClick={readOnly ? undefined : handleClick}
            onContextMenu={
              readOnly ? undefined : (onContextMenu as React.MouseEventHandler<HTMLTextAreaElement>)
            }
            // IME composition events
            onCompositionStart={() => onCompositionStart?.()}
            onCompositionUpdate={(e) => onCompositionUpdate?.(e.data)}
            onCompositionEnd={(e) => onCompositionEnd?.(e.data)}
            resize="none"
            rows={isExpanded ? 3 : 1}
            className={`h-full min-h-0 ${
              isEditing ? 'border-ss-primary ring-2 ring-ss-primary/20' : ''
            } ${isFormula ? 'text-transparent' : ''}`}
            style={{
              // D.2: Enable word wrapping for long formulas
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'pre-wrap',
              // Keep caret visible when text is transparent for syntax highlighting overlay
              ...(isFormula ? { caretColor: 'var(--color-ss-text)' } : {}),
            }}
            spellCheck={false}
            autoComplete="off"
          />
        ) : (
          <Input
            ref={setInputRef as React.Ref<HTMLInputElement>}
            type="text"
            value={value}
            size="ribbon"
            readOnly={readOnly}
            onChange={readOnly ? undefined : handleChange}
            onKeyDown={readOnly ? undefined : handleKeyDown}
            onFocus={readOnly ? undefined : handleFocus}
            onSelect={readOnly ? undefined : handleSelect}
            // A.1: Use handleClick to get cursor position for Edit Mode entry
            onClick={readOnly ? undefined : handleClick}
            onContextMenu={readOnly ? undefined : onContextMenu}
            // IME composition events
            // These events are critical for CJK input (Chinese, Japanese, Korean).
            // Composition events fire BEFORE the 'input' event during IME composition.
            // The editor machine transitions to imeComposing state to:
            // 1. Prevent shortcuts from firing during composition (Layer 2 defense)
            // 2. Track composition text for cross-browser consistency
            onCompositionStart={() => onCompositionStart?.()}
            onCompositionUpdate={(e) => onCompositionUpdate?.(e.data)}
            onCompositionEnd={(e) => onCompositionEnd?.(e.data)}
            className={`h-full ${
              isEditing ? 'border-ss-primary ring-2 ring-ss-primary/20' : ''
            } ${isFormula ? 'text-transparent' : ''}`}
            // Keep caret visible when text is transparent for syntax highlighting overlay
            style={isFormula ? { caretColor: 'var(--color-ss-text)' } : undefined}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </div>

      {/* Chrome-symmetry: hide the formula bar. Reopen via View ribbon
 "Show formula bar" toggle (data-action="open-panel-formula-bar"). */}
      {onClosePanel && (
        <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'hideFormulaBar']}>
          <button
            type="button"
            onClick={onClosePanel}
            data-testid="panel-formula-bar-close"
            className="w-[22px] h-[22px] flex items-center justify-center text-ss-text-secondary shrink-0 hover:bg-ss-surface-hover rounded cursor-pointer transition-colors"
            title="Hide formula bar"
            aria-label="Hide formula bar"
          >
            <CloseSvg className="w-3 h-3" />
          </button>
        </RibbonVisibilityPathItem>
      )}

      {/* AI Formula Bar Toggle (Ctrl+Shift+I) */}
      {onToggleNLBar && (
        <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'toggleAiFormulaBar']}>
          <button
            type="button"
            onClick={onToggleNLBar}
            className={`w-[22px] h-[22px] flex items-center justify-center shrink-0 rounded cursor-pointer transition-colors ${
              nlBarVisible
                ? 'text-ss-accent bg-ss-accent/10'
                : 'text-ss-text-secondary hover:bg-ss-surface-hover'
            }`}
            title="Toggle AI Formula Bar (Ctrl+Shift+I)"
            aria-label="Toggle AI formula bar"
            data-testid="toggle-nl-formula-bar"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11 6.5 7.5 3 6l3.5-1.5L8 1z"
                fill="currentColor"
              />
              <path
                d="M12 9l.75 1.75L14.5 11.5l-1.75.75L12 14l-.75-1.75L9.5 11.5l1.75-.75L12 9z"
                fill="currentColor"
                opacity="0.6"
              />
            </svg>
          </button>
        </RibbonVisibilityPathItem>
      )}

      {/* Expand/Collapse Toggle Button (Ctrl+Shift+U) */}
      <RibbonVisibilityPathItem path={['formulaBar', 'controls', 'expandCollapse']}>
        <button
          type="button"
          onClick={onToggleExpand}
          className="w-[22px] h-[22px] flex items-center justify-center text-ss-text-secondary shrink-0 hover:bg-ss-surface-hover rounded cursor-pointer transition-colors"
          title={
            isExpanded ? 'Collapse Formula Bar (Ctrl+Shift+U)' : 'Expand Formula Bar (Ctrl+Shift+U)'
          }
        >
          {/* Chevron icon: up when expanded, down when collapsed */}
          <svg
            className={`w-3 h-3 transition-transform ${isExpanded ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </RibbonVisibilityPathItem>
    </div>
  );
}
