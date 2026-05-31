/**
 * Thesaurus Dialog
 *
 * A dialog that provides thesaurus functionality for finding synonyms and antonyms.
 * Users can look up words and select replacements.
 *
 * Excel Parity: Review > Thesaurus (Shift+F7)
 *
 * Features:
 * - Display looked up word
 * - Show synonyms grouped by meaning
 * - Search for new words
 * - Insert selected synonym into cell
 */

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

interface ThesaurusResult {
  word: string;
  meanings: ThesaurusMeaning[];
}

interface ThesaurusMeaning {
  partOfSpeech: string;
  definitions: string[];
  synonyms: string[];
  antonyms: string[];
}

// =============================================================================
// Thesaurus Service
// =============================================================================

/**
 * Fetch thesaurus data from the Free Dictionary API.
 * Returns synonyms and antonyms grouped by meaning.
 */
async function lookupWord(word: string): Promise<ThesaurusResult | null> {
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // Word not found
      }
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();

    // Extract meanings with synonyms/antonyms
    const meanings: ThesaurusMeaning[] = [];

    for (const entry of data) {
      for (const meaning of entry.meanings || []) {
        const synonyms: string[] = [];
        const antonyms: string[] = [];
        const definitions: string[] = [];

        // Collect synonyms and antonyms from meaning level
        if (meaning.synonyms) synonyms.push(...meaning.synonyms);
        if (meaning.antonyms) antonyms.push(...meaning.antonyms);

        // Collect from definitions
        for (const def of meaning.definitions || []) {
          if (def.definition) definitions.push(def.definition);
          if (def.synonyms) synonyms.push(...def.synonyms);
          if (def.antonyms) antonyms.push(...def.antonyms);
        }

        // Only add if we have synonyms or antonyms
        if (synonyms.length > 0 || antonyms.length > 0) {
          meanings.push({
            partOfSpeech: meaning.partOfSpeech || 'unknown',
            definitions: definitions.slice(0, 2), // Limit definitions
            synonyms: [...new Set(synonyms)].slice(0, 10), // Dedupe and limit
            antonyms: [...new Set(antonyms)].slice(0, 5),
          });
        }
      }
    }

    return { word, meanings };
  } catch (error) {
    console.error('[Thesaurus] Lookup error:', error);
    throw error;
  }
}

// =============================================================================
// Component
// =============================================================================

export function ThesaurusDialog() {
  const deps = useActionDependencies();

  // Get state from UIStore
  const isOpen = useUIStore((s) => s.thesaurusDialogOpen);
  const initialWord = useUIStore((s) => s.thesaurusWord);
  const error = useUIStore((s) => s.thesaurusError);

  // Get actions from UIStore
  const closeThesaurusDialog = useUIStore((s) => s.closeThesaurusDialog);
  const setThesaurusError = useUIStore((s) => s.setThesaurusError);

  // Local state
  const [searchWord, setSearchWord] = useState('');
  const [result, setResult] = useState<ThesaurusResult | null>(null);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize search with the word from cell
  useEffect(() => {
    if (isOpen && initialWord) {
      setSearchWord(initialWord);
      // Auto-lookup the initial word
      handleLookup(initialWord);
    }
  }, [isOpen, initialWord]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setSearchWord('');
      setResult(null);
      setSelectedWord(null);
      setIsLoading(false);
    }
  }, [isOpen]);

  // Handle word lookup
  const handleLookup = useCallback(
    async (word: string) => {
      if (!word.trim()) return;

      setIsLoading(true);
      setThesaurusError(null);
      setResult(null);
      setSelectedWord(null);

      try {
        const data = await lookupWord(word.trim());
        if (data) {
          setResult(data);
        } else {
          setThesaurusError(`No results found for "${word}"`);
        }
      } catch {
        setThesaurusError('Failed to look up word. Please check your internet connection.');
      } finally {
        setIsLoading(false);
      }
    },
    [setThesaurusError],
  );

  // Handle search input change
  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSearchWord(e.target.value);
  }, []);

  // Handle "Look Up" button click
  const handleLookupClick = useCallback(() => {
    handleLookup(searchWord);
  }, [searchWord, handleLookup]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeThesaurusDialog();
  }, [closeThesaurusDialog]);

  // Handle word selection
  const handleWordSelect = useCallback((word: string) => {
    setSelectedWord(word);
  }, []);

  // Handle word double-click to insert
  const handleWordDoubleClick = useCallback(
    (word: string) => {
      dispatch('THESAURUS_INSERT_WORD', deps, { word });
      handleClose();
    },
    [deps, handleClose],
  );

  // Handle insert button click
  const handleInsert = useCallback(() => {
    if (selectedWord) {
      dispatch('THESAURUS_INSERT_WORD', deps, { word: selectedWord });
      handleClose();
    }
  }, [selectedWord, deps, handleClose]);

  // Enter-to-confirm: if a word is selected, insert it; otherwise look up the
  // current search term. Escape-to-close is handled natively by Dialog.
  const handleConfirm = useCallback(() => {
    if (selectedWord) {
      handleInsert();
    } else if (searchWord.trim()) {
      handleLookup(searchWord);
    }
  }, [selectedWord, searchWord, handleInsert, handleLookup]);

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      dialogId="thesaurus-dialog"
      width="md"
      onEnterKeyDown={handleConfirm}
    >
      <DialogHeader onClose={handleClose} closeAriaLabel="Close Thesaurus dialog">
        Thesaurus
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Search input */}
          <div className="flex gap-2">
            <Input
              type="text"
              value={searchWord}
              onChange={handleSearchChange}
              placeholder="Enter a word..."
              size="sm"
              className="flex-1"
              autoComplete="off"
              autoFocus
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleLookupClick}
              disabled={isLoading || !searchWord.trim()}
            >
              Look Up
            </Button>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
            </div>
          )}

          {/* Error state */}
          {error && !isLoading && (
            <div className="text-body text-ss-error text-center py-4">{error}</div>
          )}

          {/* Results */}
          {result && !isLoading && (
            <div className="flex flex-col gap-4 max-h-80 overflow-y-auto">
              <div className="text-body font-medium">Results for "{result.word}"</div>

              {result.meanings.map((meaning, index) => (
                <div key={index} className="flex flex-col gap-2">
                  {/* Part of speech */}
                  <div className="text-body-sm text-ss-text-secondary italic">
                    {meaning.partOfSpeech}
                  </div>

                  {/* Definition preview */}
                  {meaning.definitions.length > 0 && (
                    <div className="text-caption text-ss-text-tertiary pl-2">
                      {meaning.definitions[0]}
                    </div>
                  )}

                  {/* Synonyms */}
                  {meaning.synonyms.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="text-caption font-medium text-ss-text-secondary">
                        Synonyms:
                      </div>
                      <div className="flex flex-wrap gap-1 pl-2">
                        {meaning.synonyms.map((synonym) => (
                          <button
                            key={synonym}
                            type="button"
                            onClick={() => handleWordSelect(synonym)}
                            onDoubleClick={() => handleWordDoubleClick(synonym)}
                            className={`px-2 py-1 text-body-sm rounded border transition-colors ${
                              selectedWord === synonym
                                ? 'bg-ss-primary text-ss-text-inverse border-ss-primary'
                                : 'bg-ss-surface border-ss-border hover:bg-ss-surface-hover'
                            }`}
                          >
                            {synonym}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Antonyms */}
                  {meaning.antonyms.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <div className="text-caption font-medium text-ss-text-secondary">
                        Antonyms:
                      </div>
                      <div className="flex flex-wrap gap-1 pl-2">
                        {meaning.antonyms.map((antonym) => (
                          <button
                            key={antonym}
                            type="button"
                            onClick={() => handleWordSelect(antonym)}
                            onDoubleClick={() => handleWordDoubleClick(antonym)}
                            className={`px-2 py-1 text-body-sm rounded border transition-colors ${
                              selectedWord === antonym
                                ? 'bg-ss-primary text-ss-text-inverse border-ss-primary'
                                : 'bg-ss-surface border-ss-border hover:bg-ss-surface-hover'
                            }`}
                          >
                            {antonym}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {result.meanings.length === 0 && (
                <div className="text-body text-ss-text-secondary text-center py-4">
                  No synonyms or antonyms found.
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!result && !isLoading && !error && (
            <div className="text-body text-ss-text-secondary text-center py-8">
              Enter a word above to find synonyms and antonyms.
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Close
        </Button>
        <Button variant="primary" onClick={handleInsert} disabled={!selectedWord}>
          Insert
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
