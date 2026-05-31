/**
 * Editor Machine Autocomplete Actions
 *
 * Actions for handling autocomplete functionality in the editor including:
 * - Formula function autocomplete
 * - Suggestion navigation and selection
 * - Autocomplete menu management
 * - Suggestion insertion
 *
 * Extracted from editor-machine.ts
 */

import { assign } from 'xstate';

import { analyzeFormulaContext } from '../../../shared/utils';
import type { EditorContext, EditorEvent } from './types';

// =============================================================================
// AUTOCOMPLETE ACTIONS
// =============================================================================

/**
 * Compute formula context from current value and cursor position.
 * Called on every INPUT event to update autocomplete state.
 */
export const computeFormulaContext = assign(({ context }: { context: EditorContext }) => {
  // Non-formula values don't have formula context
  if (!context.value.startsWith('=')) {
    return {
      formulaContext: null,
      isSuggestionsOpen: false,
      isArgumentHintOpen: false,
    };
  }

  // Compute context using pure function
  const formulaContext = analyzeFormulaContext(context.value, context.cursorPosition);

  return {
    formulaContext,
    isSuggestionsOpen: formulaContext.shouldShowSuggestions,
    isArgumentHintOpen: formulaContext.shouldShowArgumentHint,
    // Reset selection when suggestions change (new prefix = new list)
    selectedSuggestionIndex: formulaContext.shouldShowSuggestions
      ? 0
      : context.selectedSuggestionIndex,
  };
});

/**
 * Navigate suggestion list up or down.
 * Note: Actual wrap-around is handled in component based on list length.
 * Here we just track the intent.
 */
export const navigateSuggestion = assign(
  ({ context, event }: { context: EditorContext; event: EditorEvent }) => {
    if (event.type !== 'NAVIGATE_SUGGESTION') return {};
    const delta = event.direction === 'up' ? -1 : 1;
    return {
      selectedSuggestionIndex: Math.max(0, context.selectedSuggestionIndex + delta),
    };
  },
);

/** Select a specific suggestion by index */
export const selectSuggestion = assign(({ event }: { event: EditorEvent }) => {
  if (event.type !== 'SELECT_SUGGESTION') return {};
  return {
    selectedSuggestionIndex: event.index,
  };
});

/** Show suggestions popup */
export const showSuggestions = assign({
  isSuggestionsOpen: true,
  selectedSuggestionIndex: 0,
});

/** Hide suggestions popup */
export const hideSuggestions = assign({
  isSuggestionsOpen: false,
  selectedSuggestionIndex: 0,
});

/**
 * Accept a suggestion - insert function name at cursor position.
 * Replaces the current function prefix with the selected function name.
 */
export const acceptSuggestion = assign(
  ({ context, event }: { context: EditorContext; event: EditorEvent }) => {
    if (event.type !== 'ACCEPT_SUGGESTION') return {};

    const functionName = event.name;
    const insertedText = `${functionName}${event.appendOpeningParen === false ? '' : '('}`;
    const prefix = context.formulaContext?.functionPrefix ?? '';

    if (!prefix) {
      // No prefix to replace - just insert at cursor
      const before = context.value.slice(0, context.cursorPosition);
      const after = context.value.slice(context.cursorPosition);
      const newValue = before + insertedText + after;
      return {
        value: newValue,
        cursorPosition: before.length + insertedText.length,
        isSuggestionsOpen: false,
        selectedSuggestionIndex: 0,
      };
    }

    // Find the prefix position and replace it
    // The prefix is at the end of what we've typed before cursor
    const beforeCursor = context.value.slice(0, context.cursorPosition);
    const prefixStart = beforeCursor.length - prefix.length;
    const before = context.value.slice(0, prefixStart);
    const after = context.value.slice(context.cursorPosition);
    const newValue = before + insertedText + after;
    const cursorPosition = before.length + insertedText.length;

    return {
      value: newValue,
      cursorPosition,
      isSuggestionsOpen: false,
      selectedSuggestionIndex: 0,
      // Recompute formula context after accepting
      formulaContext: analyzeFormulaContext(newValue, cursorPosition),
    };
  },
);

/**
 * Reset autocomplete state to initial values.
 * Called when exiting formula editing or canceling.
 */
export const resetAutocompleteState = assign({
  formulaContext: null,
  isSuggestionsOpen: false,
  selectedSuggestionIndex: 0,
  isArgumentHintOpen: false,
});

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Export all autocomplete actions as an object for machine config.
 */
export const autocompleteActions = {
  computeFormulaContext,
  showSuggestions,
  hideSuggestions,
  selectSuggestion,
  navigateSuggestion,
  acceptSuggestion,
  resetAutocompleteState,
};
