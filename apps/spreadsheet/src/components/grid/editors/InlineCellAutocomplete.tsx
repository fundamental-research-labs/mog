/**
 * Inline Cell Autocomplete Component
 *
 * Sibling component to InlineCellEditor that owns the formula autocomplete
 * subscription. Extracted to eliminate the duplicate high-frequency subscription
 * to editor value/cursorPosition that occurred when both useEditorState() and
 * useFormulaAutocomplete() lived in the same component (H6 violation).
 *
 * This component:
 * - Calls useFormulaAutocomplete() (owns the autocomplete state subscription)
 * - Renders FunctionSuggestions popup when appropriate
 * - Exposes a keyboard interceptor via ref for the editor's onKeyDown
 * - Exposes setInputElement for autocomplete positioning
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */

import React, { useCallback, useImperativeHandle, useRef } from 'react';

import type { NameSuggestion } from '../../../domain/editor/name-completion';
import { useFormulaAutocomplete } from '../../../hooks/editing/use-formula-autocomplete';
import { FunctionSuggestions } from '../../editor/FunctionSuggestions';

// =============================================================================
// Types
// =============================================================================

export interface InlineCellAutocompleteHandle {
  /**
   * Keyboard interceptor — call from the editor's onKeyDown.
   * Returns true if the event was handled (suggestions consumed it).
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => boolean;

  /** Set the input element ref for autocomplete positioning */
  setInputElement: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
}

interface InlineCellAutocompleteProps {
  /** Whether the formula bar currently has focus (suppress inline suggestions) */
  isFormulaBarFocused: boolean;

  /** Position for the suggestions popup (below the editing cell) */
  suggestionsPosition: { x: number; y: number };
}

// =============================================================================
// Component
// =============================================================================

export const InlineCellAutocomplete = React.memo(
  React.forwardRef<InlineCellAutocompleteHandle, InlineCellAutocompleteProps>(
    function InlineCellAutocomplete({ isFormulaBarFocused, suggestionsPosition }, ref) {
      const autocomplete = useFormulaAutocomplete();

      // Destructure stable action callbacks for use in handleKeyDown deps (M10 fix).
      // These are useCallback-wrapped in the hook and have stable identity.
      const { navigateSuggestions, acceptCurrentSuggestion, dismissSuggestions, setInputElement } =
        autocomplete;

      // Cache suggestion counts in a ref so handleKeyDown doesn't depend on them.
      // The counts change every render when suggestions change, but handleKeyDown
      // only needs them for a runtime check — not to determine what to render.
      const stateRef = useRef({
        isSuggestionsOpen: false,
        totalSuggestionCount: 0,
        hasFunctionSuggestions: false,
        hasNameSuggestions: false,
      });
      stateRef.current.isSuggestionsOpen = autocomplete.isSuggestionsOpen;
      stateRef.current.totalSuggestionCount = autocomplete.totalSuggestionCount;
      stateRef.current.hasFunctionSuggestions = autocomplete.functionSuggestions.length > 0;
      stateRef.current.hasNameSuggestions = autocomplete.nameSuggestions.length > 0;

      // Stable keyboard interceptor — depends only on stable action callbacks (M10 fix)
      const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
          const {
            isSuggestionsOpen,
            totalSuggestionCount,
            hasFunctionSuggestions,
            hasNameSuggestions,
          } = stateRef.current;

          if (!isSuggestionsOpen || totalSuggestionCount === 0) return false;

          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            navigateSuggestions('down');
            return true;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            navigateSuggestions('up');
            return true;
          }
          if (e.key === 'Tab') {
            // Tab accepts the highlighted suggestion (Excel parity: Enter does NOT accept)
            if (hasFunctionSuggestions || hasNameSuggestions) {
              e.preventDefault();
              e.stopPropagation();
              acceptCurrentSuggestion();
              return true;
            }
          }
          if (e.key === 'Escape') {
            // Two-step Escape behavior (Excel parity):
            // First Escape dismisses the autocomplete dropdown but keeps the
            // editor active with the formula text intact.
            // Second Escape (no suggestions open) cancels the edit.
            // We stop propagation here to prevent the keyboard coordinator from
            // dispatching CANCEL_EDIT on this first press.
            e.preventDefault();
            e.stopPropagation();
            dismissSuggestions();
            return true;
          }

          return false;
        },
        [navigateSuggestions, acceptCurrentSuggestion, dismissSuggestions],
      );

      // Expose handle to parent via ref
      useImperativeHandle(ref, () => ({ handleKeyDown, setInputElement }), [
        handleKeyDown,
        setInputElement,
      ]);

      // Show autocomplete only when editing in-cell (not when formula bar has focus)
      const showInlineSuggestions =
        !isFormulaBarFocused &&
        autocomplete.isSuggestionsOpen &&
        (autocomplete.functionSuggestions.length > 0 || autocomplete.nameSuggestions.length > 0);

      if (!showInlineSuggestions) return null;

      return (
        <FunctionSuggestions
          prefix={autocomplete.formulaContext?.functionPrefix ?? ''}
          allFunctions={autocomplete.functionSuggestions}
          nameSuggestions={autocomplete.nameSuggestions as NameSuggestion[]}
          selectedIndex={autocomplete.selectedSuggestionIndex}
          onSelect={autocomplete.acceptSuggestion}
          onNavigate={autocomplete.navigateSuggestions}
          onDismiss={autocomplete.dismissSuggestions}
          position={suggestionsPosition}
        />
      );
    },
  ),
);
