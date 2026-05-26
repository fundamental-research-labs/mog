/**
 * useDocument Hook
 *
 * Retrieves a document from DocumentManager and subscribes to its state changes.
 * Does NOT create documents - only subscribes to existing ones.
 *
 * This hook is safe across remounts because DocumentManager owns the state.
 * When components remount, they simply re-subscribe and get the current state
 * without triggering any new loading operations.
 *
 * Usage:
 * ```tsx
 * function SpreadsheetApp() {
 *   const activeFileId = useShellStore(s => s.activeFileId);
 *   const { handle, isLoading, error, loadingState } = useDocument(activeFileId);
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <ErrorScreen error={error} />;
 *   if (!handle) return <WelcomeScreen />;
 *
 *   return <SpreadsheetContent handle={handle} />;
 * }
 * ```
 *
 */

import type { DocumentHandle } from '@mog-sdk/kernel';
import { useCallback, useEffect, useState } from 'react';
import { useDocumentManager } from '../context/document-manager-context';
import type { DocumentLoadingState } from '../services/document';

// =============================================================================
// Types
// =============================================================================

/**
 * Result type returned by useDocument hook.
 */
export interface UseDocumentResult {
  /** Document handle, or null if not loaded */
  handle: DocumentHandle | null;

  /** Whether the document is currently loading */
  isLoading: boolean;

  /** Error from last load attempt, or null if no error */
  error: Error | null;

  /** Detailed loading state: 'idle' | 'loading' | 'loaded' | 'error' */
  loadingState: DocumentLoadingState;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Get a document by file ID and subscribe to its state changes.
 *
 * This hook subscribes to DocumentManager and returns the current state.
 * It does NOT trigger document loading - that's ProjectService's responsibility.
 *
 * Key properties:
 * - **Safe across remounts**: State lives in DocumentManager, not in component
 * - **No duplicate loads**: Just retrieves existing state from cache
 * - **Reactive**: Automatically updates when document state changes
 *
 * @param fileId - File ID to get document for, or null for no document
 * @returns UseDocumentResult with handle, loading state, and error info
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { handle, isLoading, error } = useDocument('file-123');
 *
 * // With null fileId (e.g., no file selected)
 * const { handle } = useDocument(null);
 * // handle will be null, isLoading false, error null
 * ```
 */
export function useDocument(fileId: string | null): UseDocumentResult {
  const documentManager = useDocumentManager();

  // Get state from DocumentManager for the given fileId
  const getState = useCallback((): UseDocumentResult => {
    if (!fileId) {
      return {
        handle: null,
        isLoading: false,
        error: null,
        loadingState: 'idle',
      };
    }

    const loadingState = documentManager.getLoadingState(fileId);
    return {
      handle: documentManager.getDocument(fileId),
      isLoading: loadingState === 'loading',
      error: documentManager.getError(fileId),
      loadingState,
    };
  }, [documentManager, fileId]);

  const [state, setState] = useState<UseDocumentResult>(getState);

  // Subscribe to DocumentManager changes
  useEffect(() => {
    // Shallow-compare to avoid unnecessary re-renders — getState() always creates
    // a new object, but if the fields are identical we should return the previous
    // reference so downstream useEffect deps (like `handle`) stay stable.
    const updateIfChanged = () => {
      setState((prev) => {
        const next = getState();
        if (
          prev.handle === next.handle &&
          prev.isLoading === next.isLoading &&
          prev.error === next.error &&
          prev.loadingState === next.loadingState
        ) {
          return prev;
        }
        return next;
      });
    };

    // Update state immediately to sync with current DocumentManager state
    // This handles the case where state changed while we were unmounted
    updateIfChanged();

    // Subscribe to future changes
    const unsubscribe = documentManager.subscribe(updateIfChanged);

    return unsubscribe;
  }, [documentManager, fileId, getState]);

  return state;
}
