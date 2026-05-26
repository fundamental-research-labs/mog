/**
 * Shell UI Store
 *
 * Lightweight store for shell-level (app-wide) state that is NOT document-specific.
 * This store is created once at app startup and shared across all documents.
 *
 * Shell-level state includes:
 * - View navigation (activeViewId, viewSwitcherOpen)
 * - Record detail sidebar (works across views)
 *
 * This is SEPARATE from the per-document UIStore which contains:
 * - All document-specific state (dialogs, format painter, zoom, etc.)
 * - activeSheetId (document-specific)
 *
 * Architecture (OS Pattern):
 * ```
 * App
 * └─ ShellProvider (creates ShellStore - once for entire app)
 *    └─ DocumentProvider (creates UIStore - per document)
 *       └─ SpreadsheetContent
 * ```
 *
 * Why this separation matters:
 * 1. View switching is app-level - Grid → Kanban doesn't need document context
 * 2. Multi-document support - one ShellProvider, multiple DocumentProviders (tabs)
 * 3. Apps as first-class citizens - Apps import shell (UI) and kernel (data)
 *
 */

import { create, type StoreApi } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Import slice creators directly from their files (not from slices/index.ts)
// because they've been removed from the barrel export
import { createNavigationSlice, type NavigationSlice } from './slices/navigation';
import { createProjectSlice, type ProjectSlice } from './slices/project';
import { createRecordDetailSlice, type RecordDetailSlice } from './slices/record-detail';

// =============================================================================
// Shell UI State Type
// =============================================================================

/**
 * Shell-level UI state - app-wide, not document-specific.
 *
 * This is intentionally minimal. Only state that:
 * 1. Is shared across documents (multi-tab future)
 * 2. Is view-level, not document-level
 * 3. Doesn't require DocumentContext to function
 */
export type ShellUIState = NavigationSlice & RecordDetailSlice & ProjectSlice;

// =============================================================================
// Shell Store Factory
// =============================================================================

/**
 * Create a shell UI store instance.
 * Called once at app startup by ShellProvider.
 *
 * This store is lightweight and does NOT require document context.
 * It manages app-wide UI state like view navigation.
 */
export function createShellStore(): StoreApi<ShellUIState> {
  return create<ShellUIState>()(
    subscribeWithSelector((...args) => ({
      ...createNavigationSlice(...args),
      ...createRecordDetailSlice(...args),
      ...createProjectSlice(...args),
    })),
  );
}

// =============================================================================
// Shell Store API Type
// =============================================================================

/**
 * Type for the ShellStore API with subscribeWithSelector middleware.
 */
export type ShellStoreApi = ReturnType<typeof createShellStore>;
