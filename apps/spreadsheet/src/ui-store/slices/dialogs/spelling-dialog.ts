/**
 * Spelling Dialog Slice
 *
 * Manages state for the Spelling dialog, which provides spell checking
 * functionality for cell content.
 *
 * Features:
 * - Display misspelled words
 * - Suggest corrections
 * - Ignore/Ignore All options
 * - Add to dictionary
 * - Change/Change All options
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Spelling check status
 */
export type SpellingStatus = 'idle' | 'checking' | 'completed' | 'no-errors';

/**
 * Information about a spelling error
 */
export interface SpellingError {
  /** The misspelled word */
  word: string;
  /** Suggested corrections */
  suggestions: string[];
  /** Sheet ID where error was found */
  sheetId: string;
  /** Row where error was found */
  row: number;
  /** Column where error was found */
  col: number;
  /** Position within cell text */
  startIndex: number;
  /** Length of misspelled word */
  length: number;
}

/**
 * Spelling dialog state
 */
export interface SpellingDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current spelling check status */
  status: SpellingStatus;
  /** Current spelling error being displayed */
  currentError: SpellingError | null;
  /** Index of current error in the errors list */
  currentErrorIndex: number;
  /** All found spelling errors */
  errors: SpellingError[];
  /** Selected suggestion index */
  selectedSuggestionIndex: number;
  /** Custom replacement text (when editing suggestion) */
  customReplacement: string;
  /** Words to ignore for this session */
  ignoredWords: Set<string>;
  /** Count of changes made */
  changesCount: number;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SpellingDialogSlice {
  /** Spelling dialog state */
  spellingDialog: SpellingDialogState;

  /** Open the Spelling dialog and start checking */
  openSpellingDialog: () => void;

  /** Close the Spelling dialog */
  closeSpellingDialog: () => void;

  /** Set the spelling check status */
  setSpellingStatus: (status: SpellingStatus) => void;

  /** Set the list of spelling errors found */
  setSpellingErrors: (errors: SpellingError[]) => void;

  /** Move to the next spelling error */
  nextSpellingError: () => void;

  /** Select a suggestion by index */
  selectSpellingSuggestion: (index: number) => void;

  /** Set custom replacement text */
  setSpellingCustomReplacement: (text: string) => void;

  /** Add current word to ignored list */
  ignoreSpellingWord: () => void;

  /** Add word to ignored list for all occurrences */
  ignoreAllSpellingWord: () => void;

  /** Increment changes count after a change is applied */
  incrementSpellingChangesCount: () => void;

  /** Mark current error as resolved and move to next */
  resolveCurrentSpellingError: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSpellingDialogState: SpellingDialogState = {
  isOpen: false,
  status: 'idle',
  currentError: null,
  currentErrorIndex: -1,
  errors: [],
  selectedSuggestionIndex: 0,
  customReplacement: '',
  ignoredWords: new Set(),
  changesCount: 0,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSpellingDialogSlice: StateCreator<
  SpellingDialogSlice,
  [],
  [],
  SpellingDialogSlice
> = (set, get) => ({
  spellingDialog: initialSpellingDialogState,

  openSpellingDialog: () => {
    set({
      spellingDialog: {
        ...initialSpellingDialogState,
        isOpen: true,
        status: 'checking',
      },
    });
  },

  closeSpellingDialog: () => {
    set({
      spellingDialog: {
        ...initialSpellingDialogState,
        // Preserve ignored words for this session (until app reload)
        ignoredWords: get().spellingDialog.ignoredWords,
      },
    });
  },

  setSpellingStatus: (status) => {
    set((state) => ({
      spellingDialog: {
        ...state.spellingDialog,
        status,
      },
    }));
  },

  setSpellingErrors: (errors) => {
    const firstError = errors.length > 0 ? errors[0] : null;
    set((state) => ({
      spellingDialog: {
        ...state.spellingDialog,
        errors,
        currentError: firstError,
        currentErrorIndex: firstError ? 0 : -1,
        selectedSuggestionIndex: 0,
        customReplacement: firstError?.suggestions[0] ?? firstError?.word ?? '',
        status: errors.length > 0 ? 'checking' : 'no-errors',
      },
    }));
  },

  nextSpellingError: () => {
    const state = get().spellingDialog;
    const nextIndex = state.currentErrorIndex + 1;

    if (nextIndex >= state.errors.length) {
      // No more errors
      set({
        spellingDialog: {
          ...state,
          currentError: null,
          currentErrorIndex: -1,
          status: 'completed',
        },
      });
    } else {
      const nextError = state.errors[nextIndex];
      set({
        spellingDialog: {
          ...state,
          currentError: nextError,
          currentErrorIndex: nextIndex,
          selectedSuggestionIndex: 0,
          customReplacement: nextError.suggestions[0] ?? nextError.word,
        },
      });
    }
  },

  selectSpellingSuggestion: (index) => {
    const state = get().spellingDialog;
    const suggestion = state.currentError?.suggestions[index];
    set({
      spellingDialog: {
        ...state,
        selectedSuggestionIndex: index,
        customReplacement: suggestion ?? state.customReplacement,
      },
    });
  },

  setSpellingCustomReplacement: (text) => {
    set((state) => ({
      spellingDialog: {
        ...state.spellingDialog,
        customReplacement: text,
      },
    }));
  },

  ignoreSpellingWord: () => {
    // Just move to next error without adding to ignored list
    get().nextSpellingError();
  },

  ignoreAllSpellingWord: () => {
    const state = get().spellingDialog;
    const wordToIgnore = state.currentError?.word;

    if (!wordToIgnore) return;

    // Add to ignored words set
    const newIgnoredWords = new Set(state.ignoredWords);
    newIgnoredWords.add(wordToIgnore.toLowerCase());

    // Filter out all errors with this word
    const remainingErrors = state.errors.filter(
      (error) => error.word.toLowerCase() !== wordToIgnore.toLowerCase(),
    );

    // Update state
    const nextError = remainingErrors.length > 0 ? remainingErrors[0] : null;
    set({
      spellingDialog: {
        ...state,
        ignoredWords: newIgnoredWords,
        errors: remainingErrors,
        currentError: nextError,
        currentErrorIndex: nextError ? 0 : -1,
        selectedSuggestionIndex: 0,
        customReplacement: nextError?.suggestions[0] ?? nextError?.word ?? '',
        status: remainingErrors.length > 0 ? 'checking' : 'completed',
      },
    });
  },

  incrementSpellingChangesCount: () => {
    set((state) => ({
      spellingDialog: {
        ...state.spellingDialog,
        changesCount: state.spellingDialog.changesCount + 1,
      },
    }));
  },

  resolveCurrentSpellingError: () => {
    const state = get().spellingDialog;

    // Remove current error from list
    const remainingErrors = state.errors.filter((_, idx) => idx !== state.currentErrorIndex);

    // Get next error (at same index since we removed one)
    const nextError =
      remainingErrors.length > 0
        ? remainingErrors[Math.min(state.currentErrorIndex, remainingErrors.length - 1)]
        : null;

    set({
      spellingDialog: {
        ...state,
        errors: remainingErrors,
        currentError: nextError,
        currentErrorIndex: nextError
          ? Math.min(state.currentErrorIndex, remainingErrors.length - 1)
          : -1,
        selectedSuggestionIndex: 0,
        customReplacement: nextError?.suggestions[0] ?? nextError?.word ?? '',
        changesCount: state.changesCount + 1,
        status: remainingErrors.length > 0 ? 'checking' : 'completed',
      },
    });
  },
});
