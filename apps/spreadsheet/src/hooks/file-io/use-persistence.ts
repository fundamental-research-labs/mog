/**
 * Persistence Hooks
 *
 * Provides React hooks for monitoring persistence status and undo/redo operations.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useWorkbook } from '../../infra/context';

// =============================================================================
// Persistence Status Types
// =============================================================================

export type PersistenceStatus = 'loading' | 'synced' | 'error';

export interface PersistenceState {
  /** Current sync status */
  status: PersistenceStatus;

  /** Whether initial sync from IndexedDB is complete */
  isSynced: boolean;

  /** Whether data is being loaded */
  isLoading: boolean;

  /** Error message if status is 'error' */
  error: string | null;

  /** Last successful sync timestamp */
  lastSyncedAt: Date | null;
}

// =============================================================================
// Persistence Store (singleton tracking state)
// =============================================================================

interface PersistenceStoreState extends PersistenceState {
  subscribers: Set<() => void>;
}

const createPersistenceStore = (): PersistenceStoreState => ({
  status: 'loading',
  isSynced: false,
  isLoading: true,
  error: null,
  lastSyncedAt: null,
  subscribers: new Set(),
});

let persistenceStore: PersistenceStoreState | null = null;

function getPersistenceStore(): PersistenceStoreState {
  if (!persistenceStore) {
    persistenceStore = createPersistenceStore();
  }
  return persistenceStore;
}

function notifyPersistenceSubscribers(): void {
  const store = getPersistenceStore();
  store.subscribers.forEach((callback) => callback());
}

function updatePersistenceState(update: Partial<PersistenceState>): void {
  const store = getPersistenceStore();
  Object.assign(store, update);
  notifyPersistenceSubscribers();
}

// =============================================================================
// usePersistence Hook
// =============================================================================

/**
 * Hook to track persistence/sync status.
 *
 * Usage:
 * ```tsx
 * function App() {
 * const { isLoading, isSynced, error } = usePersistence;
 *
 * if (isLoading) return <LoadingSpinner />;
 * if (error) return <ErrorMessage error={error} />;
 * return <Spreadsheet />;
 * }
 * ```
 */
// Cached snapshot to avoid infinite loops with useSyncExternalStore
let cachedSnapshot: PersistenceState | null = null;

function getPersistenceSnapshot(): PersistenceState {
  const store = getPersistenceStore();

  // Return cached snapshot if values haven't changed
  if (
    cachedSnapshot &&
    cachedSnapshot.status === store.status &&
    cachedSnapshot.isSynced === store.isSynced &&
    cachedSnapshot.isLoading === store.isLoading &&
    cachedSnapshot.error === store.error &&
    cachedSnapshot.lastSyncedAt === store.lastSyncedAt
  ) {
    return cachedSnapshot;
  }

  // Create new snapshot
  cachedSnapshot = {
    status: store.status,
    isSynced: store.isSynced,
    isLoading: store.isLoading,
    error: store.error,
    lastSyncedAt: store.lastSyncedAt,
  };

  return cachedSnapshot;
}

function subscribeToPersistence(callback: () => void): () => void {
  const store = getPersistenceStore();
  store.subscribers.add(callback);
  return () => {
    store.subscribers.delete(callback);
  };
}

export function usePersistence(): PersistenceState {
  return useSyncExternalStore(
    subscribeToPersistence,
    getPersistenceSnapshot,
    getPersistenceSnapshot,
  );
}

// =============================================================================
// useUndoRedo Hook
// =============================================================================

export interface UndoRedoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * Hook for undo/redo operations.
 *
 * Architecture (
 * - Uses UndoService.subscribe() for reactive state updates
 * - Delegates to Rust compute engine via ComputeBridge
 *
 * Usage:
 * ```tsx
 * function Toolbar() {
 * const { canUndo, canRedo, undo, redo } = useUndoRedo;
 * return (
 * <>
 * <button onClick={undo} disabled={!canUndo}>Undo</button>
 * <button onClick={redo} disabled={!canRedo}>Redo</button>
 * </>
 * );
 * }
 * ```
 */
export function useUndoRedo(): UndoRedoState {
  const wb = useWorkbook();
  const [state, setState] = useState<{ canUndo: boolean; canRedo: boolean }>({
    canUndo: false,
    canRedo: false,
  });

  useEffect(() => {
    // Subscribe to undo state changes via WorkbookHistory sub-API
    if (!wb.history) return;

    return wb.history.subscribe((event) => {
      setState({
        canUndo: event.state.canUndo,
        canRedo: event.state.canRedo,
      });
    });
  }, [wb]);

  const undo = useCallback(() => {
    // Delegate to Rust compute engine via Workbook API
    void wb.history.undo();
  }, [wb]);

  const redo = useCallback(() => {
    // Delegate to Rust compute engine via Workbook API
    void wb.history.redo();
  }, [wb]);

  return {
    ...state,
    undo,
    redo,
  };
}

// =============================================================================
// Persistence Initialization
// =============================================================================

let initialized = false;

/**
 * Initialize persistence tracking.
 * Should be called once at app startup.
 *
 * Marks persistence as synced on the next tick (Rust compute-core handles
 * all data persistence — no Yjs sync to wait for).
 */
export function initializePersistence(): Promise<void> {
  if (initialized) {
    return Promise.resolve();
  }
  initialized = true;

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      updatePersistenceState({
        status: 'synced',
        isSynced: true,
        isLoading: false,
        lastSyncedAt: new Date(),
      });
      resolve();
    }, 0);
  });
}

/**
 * Reset persistence state (for testing).
 */
export function resetPersistenceState(): void {
  persistenceStore = null;
  initialized = false;
}
