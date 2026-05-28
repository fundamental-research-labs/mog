/**
 * Spelling Dialog
 *
 * A dialog that provides spell checking functionality for cell content.
 * Users can navigate through spelling errors, accept suggestions,
 * or add words to an ignore list.
 *
 * Excel Parity: Review > Spelling (F7)
 *
 * Features:
 * - Display misspelled words
 * - Show correction suggestions
 * - Ignore/Ignore All options
 * - Change/Change All options
 * - Custom replacement text
 */

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

export function SpellingDialog() {
  const suggestionsListRef = useRef<HTMLSelectElement>(null);
  const dispatch = useDispatch();

  // Get state from UIStore
  const isOpen = useUIStore((s) => s.spellingDialog.isOpen);
  const status = useUIStore((s) => s.spellingDialog.status);
  const currentError = useUIStore((s) => s.spellingDialog.currentError);
  const currentErrorIndex = useUIStore((s) => s.spellingDialog.currentErrorIndex);
  const errors = useUIStore((s) => s.spellingDialog.errors);
  const selectedSuggestionIndex = useUIStore((s) => s.spellingDialog.selectedSuggestionIndex);
  const customReplacement = useUIStore((s) => s.spellingDialog.customReplacement);
  const changesCount = useUIStore((s) => s.spellingDialog.changesCount);

  // Get actions from UIStore
  const closeSpellingDialog = useUIStore((s) => s.closeSpellingDialog);
  const selectSpellingSuggestion = useUIStore((s) => s.selectSpellingSuggestion);
  const setSpellingCustomReplacement = useUIStore((s) => s.setSpellingCustomReplacement);
  const ignoreAllSpellingWord = useUIStore((s) => s.ignoreAllSpellingWord);

  // Focus suggestions list when error changes
  useEffect(() => {
    if (currentError && suggestionsListRef.current) {
      suggestionsListRef.current.focus();
    }
  }, [currentError]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeSpellingDialog();
  }, [closeSpellingDialog]);

  // Handle suggestion selection change
  const handleSuggestionChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const index = parseInt(e.target.value, 10);
      if (!isNaN(index)) {
        selectSpellingSuggestion(index);
      }
    },
    [selectSpellingSuggestion],
  );

  // Handle custom replacement text change
  const handleReplacementChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setSpellingCustomReplacement(e.target.value);
    },
    [setSpellingCustomReplacement],
  );

  // Handle Ignore - skip this occurrence
  const handleIgnore = useCallback(() => {
    dispatch('SPELL_CHECK_IGNORE');
  }, [dispatch]);

  // Handle Ignore All - skip all occurrences of this word
  const handleIgnoreAll = useCallback(() => {
    dispatch('SPELL_CHECK_IGNORE_ALL');
  }, [dispatch]);

  // Handle Change - replace this occurrence
  // Note: Actual cell update requires SPELL_CHECK_CHANGE action implementation
  const handleChange = useCallback(() => {
    if (!currentError || !customReplacement) return;
    dispatch('SPELL_CHECK_CHANGE', { replacement: customReplacement });
  }, [currentError, customReplacement, dispatch]);

  // Handle Change All - replace all occurrences
  // Note: Actual cell updates require SPELL_CHECK_CHANGE_ALL action implementation
  const handleChangeAll = useCallback(() => {
    if (!currentError || !customReplacement) return;
    dispatch('SPELL_CHECK_CHANGE_ALL', { replacement: customReplacement });
  }, [currentError, customReplacement, dispatch]);

  // Handle Add to Dictionary (placeholder - needs dictionary integration)
  const handleAddToDictionary = useCallback(() => {
    if (!currentError) return;

    // TODO: SPELL_CHECK_ADD_TO_DICTIONARY action will store the word
    // For now, just ignore all occurrences
    ignoreAllSpellingWord();
  }, [currentError, ignoreAllSpellingWord]);

  // Handle double-click on suggestion to apply it
  const handleSuggestionDoubleClick = useCallback(() => {
    handleChange();
  }, [handleChange]);

  // Enter-to-submit (when there's a current error) is handled by Dialog's onEnterKeyDown prop.
  // Escape-to-close is handled natively by the Dialog primitive.

  if (!isOpen) return null;

  // Determine the view based on status
  if (status === 'completed' || status === 'no-errors') {
    return (
      <Dialog
        onEnterKeyDown={handleClose}
        open={isOpen}
        onClose={handleClose}
        dialogId="spelling-dialog"
        width="sm"
      >
        <DialogHeader onClose={handleClose}>Spelling</DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="text-4xl">
              {/* Checkmark icon */}
              <span className="text-ss-success">&#10003;</span>
            </div>
            <div className="text-body font-medium">
              {status === 'no-errors' ? 'No spelling errors found.' : 'Spell check complete.'}
            </div>
            {changesCount > 0 && (
              <div className="text-body-sm text-ss-text-secondary">
                {changesCount} change{changesCount !== 1 ? 's' : ''} made.
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={handleClose}>
            OK
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  if (status === 'checking' && !currentError) {
    return (
      <Dialog
        onEnterKeyDown={handleClose}
        open={isOpen}
        onClose={handleClose}
        dialogId="spelling-dialog"
        width="sm"
      >
        <DialogHeader onClose={handleClose}>Spelling</DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-6 h-6 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
            <div className="text-body text-ss-text-secondary">Checking spelling...</div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // Main spell check view
  const suggestions = currentError?.suggestions ?? [];
  const errorProgress = errors.length > 0 ? `${currentErrorIndex + 1} of ${errors.length}` : '';

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      dialogId="spelling-dialog"
      width="md"
      onEnterKeyDown={() => {
        if (currentError) handleChange();
      }}
    >
      <DialogHeader onClose={handleClose}>Spelling</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Progress indicator */}
          {errorProgress && (
            <div className="text-body-sm text-ss-text-secondary">Error {errorProgress}</div>
          )}

          {/* Not in Dictionary */}
          <div className="flex flex-col gap-1">
            <label className="text-body-sm text-ss-text-secondary">Not in Dictionary:</label>
            <div className="bg-ss-error/10 text-ss-error px-3 py-2 rounded font-medium">
              {currentError?.word ?? ''}
            </div>
          </div>

          {/* Cell location */}
          {currentError && (
            <div className="text-caption text-ss-text-tertiary">
              Found in: {currentError.sheetId} at row {currentError.row + 1}, column{' '}
              {currentError.col + 1}
            </div>
          )}

          {/* Change to */}
          <div className="flex flex-col gap-1">
            <label htmlFor="spelling-replacement" className="text-body-sm text-ss-text-secondary">
              Change to:
            </label>
            <Input
              id="spelling-replacement"
              type="text"
              value={customReplacement}
              onChange={handleReplacementChange}
              size="sm"
              autoComplete="off"
            />
          </div>

          {/* Suggestions */}
          <div className="flex flex-col gap-1">
            <label htmlFor="spelling-suggestions" className="text-body-sm text-ss-text-secondary">
              Suggestions:
            </label>
            <select
              ref={suggestionsListRef}
              id="spelling-suggestions"
              className="w-full h-32 border border-ss-border rounded bg-ss-surface text-body-sm p-1 focus:outline-none focus:ring-2 focus:ring-ss-primary"
              value={selectedSuggestionIndex}
              onChange={handleSuggestionChange}
              onDoubleClick={handleSuggestionDoubleClick}
              size={6}
            >
              {suggestions.length > 0 ? (
                suggestions.map((suggestion: string, index: number) => (
                  <option key={index} value={index}>
                    {suggestion}
                  </option>
                ))
              ) : (
                <option disabled value={-1}>
                  (No suggestions)
                </option>
              )}
            </select>
          </div>
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleIgnore}>
              Ignore
            </Button>
            <Button variant="secondary" onClick={handleIgnoreAll}>
              Ignore All
            </Button>
          </div>
          <Button variant="secondary" onClick={handleAddToDictionary} disabled>
            Add to Dictionary
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="primary" onClick={handleChange} disabled={!customReplacement.trim()}>
              Change
            </Button>
            <Button
              variant="secondary"
              onClick={handleChangeAll}
              disabled={!customReplacement.trim()}
            >
              Change All
            </Button>
          </div>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
