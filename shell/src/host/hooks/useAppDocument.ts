/**
 * useAppDocument - Document Management Hook for Apps with Managed Tables
 *
 * ## Problem This Solves
 *
 * When a user clicks "Start Fresh" in an app (CRM, Finance, etc.), they expect
 * to start with a completely clean slate - like opening a "New File" in Excel.
 *
 * Previously, all apps shared a single fallback document, which caused table name
 * collisions when "Start Fresh" was clicked multiple times. The second "Start Fresh"
 * would fail because table names like "Deals" already existed in the shared document.
 *
 * ## Solution: "Start Fresh" = "New File"
 *
 * This hook implements the mental model: **"Start Fresh" creates a brand new document**.
 * Each document has a unique ID (app-{appId}-{timestamp}), ensuring complete isolation:
 *
 * - No table name collisions (each document is fresh)
 * - Clean user mental model (just like "New File")
 * - Natural multi-instance support (multiple documents for same app)
 * - No cleanup logic needed (old documents persist in IndexedDB)
 *
 * ## Architecture
 *
 * Document lifecycle:
 * 1. Hook mounts with enabled=true (app has managedTables)
 * 2. State: loading=true, kernel=null, handle=null
 * 3. User clicks "Start Fresh" → calls createFreshDocument()
 * 4. Creates new document with unique ID: app-{appId}-{Date.now()}
 * 5. Document persisted to IndexedDB, cached in memory
 * 6. State updates: loading=false, kernel=IAppKernelAPI, handle=DocumentHandle
 * 7. Caller uses kernel to create managed tables
 * 8. On unmount: handle.dispose() cleans up resources
 *
 * Document caching (memory):
 * - Documents are cached by their unique ID in module-level Map
 * - Prevents duplicate YjsDocument instances for same ID
 * - Cache cleared on page unload and HMR
 *
 * ## Usage in AppSlot
 *
 * ```typescript
 * // In AppSlot.tsx
 * const {
 *   kernel,
 *   handle,
 *   loading,
 *   error,
 *   createFreshDocument
 * } = useAppDocument({
 *   appId: 'crm',
 *   enabled: !!manifest?.managedTables
 * });
 *
 * // Pass createFreshDocument to setup flow
 * <AppSetupDialog
 *   onStartFresh={async () => {
 *     await createFreshDocument();
 *     // Now kernel is ready, create tables
 *     await createManagedTables(kernel, ...);
 *   }}
 * />
 * ```
 *
 * ## Cleanup Strategy
 *
 * This hook handles two cleanup scenarios:
 *
 * 1. **React unmount**: useEffect cleanup disposes current document
 * 2. **Page unload**: beforeunload event clears cache and disposes all documents
 *
 * The cache cleanup is critical to prevent file descriptor leaks and memory leaks
 * when closing the app. HMR cleanup is handled by the consuming app (dev-app).
 *
 * @see dev-app/src/App.tsx - DocumentFactory.create() usage pattern
 * @see kernel/src/api/document-factory.ts - DocumentFactory API
 */

import { DocumentFactory, type DocumentHandle } from '@mog-sdk/kernel';
import { createAppKernelAPIFromHandle } from '@mog-sdk/kernel/app-api';
import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import { useCallback, useEffect, useRef, useState } from 'react';
import { registerLifecycleHooks } from './app-document-lifecycle';

// =============================================================================
// Types
// =============================================================================

export interface UseAppDocumentOptions {
  /** App ID (e.g., 'crm', 'finance') */
  appId: string;

  /** Only run document management if app has managedTables */
  enabled: boolean;
}

export interface UseAppDocumentResult {
  /** App Kernel API - null until createFreshDocument() is called */
  kernel: IAppKernelAPI | null;

  /** Document handle - null until createFreshDocument() is called */
  handle: DocumentHandle | null;

  /** True while creating document */
  loading: boolean;

  /** Error message if document creation failed */
  error: string | null;

  /**
   * Create a fresh document with unique ID.
   * Generates ID: app-{appId}-{Date.now()}
   * Persists to IndexedDB and caches in memory.
   */
  createFreshDocument: () => Promise<void>;
}

// =============================================================================
// Module-Level Document Cache
// =============================================================================

/**
 * Memory cache for open documents.
 * Key: documentId, Value: DocumentHandle
 *
 * Purpose:
 * - Prevent duplicate YjsDocument instances for same ID
 * - Reuse documents across component remounts (within same session)
 * - Enable manual cache clearing (HMR, page unload)
 *
 * Cache lifetime:
 * - Lives for the entire page session
 * - Cleared on page unload (beforeunload event)
 * - Cleared on HMR (import.meta.hot.dispose)
 */
const documentCache = new Map<string, DocumentHandle>();

/**
 * Get cached document or create new one.
 * Idempotent - safe to call multiple times with same ID.
 */
async function getCachedOrCreateDocument(documentId: string): Promise<DocumentHandle> {
  // Check cache first
  const cached = documentCache.get(documentId);
  if (cached) {
    return cached;
  }

  const handle = await DocumentFactory.create({
    documentId,
  });

  // Cache it
  documentCache.set(documentId, handle);

  return handle;
}

/**
 * Dispose and remove a document from cache.
 */
function disposeDocument(documentId: string): void {
  const handle = documentCache.get(documentId);
  if (handle) {
    documentCache.delete(documentId);
    void handle.dispose().catch((err) => {
      console.error('[useAppDocument] disposeDocument failed:', err);
    });
  }
}

/**
 * Dispose all cached documents and clear cache.
 * Used for cleanup on page unload and HMR.
 */
export function disposeAllAppDocuments(): void {
  // Use Array.from to avoid downlevelIteration requirement
  const entries = Array.from(documentCache.entries());
  for (const [_documentId, handle] of entries) {
    void handle.dispose().catch((err) => {
      console.error('[useAppDocument] disposeAllAppDocuments failed:', err);
    });
  }
  documentCache.clear();
}

// =============================================================================
// Lifecycle Hooks (current implementation §6.1)
// =============================================================================

/**
 * Iterate the currently-cached document handles. Used by the lifecycle
 * hooks (in `app-document-lifecycle.ts`) to fan flush calls across
 * active docs. Each handle is a `DocumentHandle`, structurally
 * compatible with the `LifecycleDocumentHandle` shape the hooks need.
 */
function getActiveDocs(): DocumentHandle[] {
  // Array.from is required to avoid TS downlevelIteration constraints —
  // matches the existing pattern in `disposeAllAppDocuments`.
  return Array.from(documentCache.values());
}

// Register the §6.1 three-hook pattern at module load. Idempotent;
// repeated imports during HMR don't double-listen. The actual hook
// implementation lives in `app-document-lifecycle.ts` so it can be
// tested without dragging the `@mog-sdk/kernel/api` import graph.
registerLifecycleHooks(getActiveDocs);

// =============================================================================
// HMR Cleanup
// =============================================================================

/**
 * Clean up documents on HMR to prevent file descriptor leaks.
 * Same cleanup pattern used in dev-app/src/App.tsx for shell.
 *
 * Note: This is only available in Vite apps (dev-app), not in library packages.
 * The consuming app (dev-app) should handle HMR cleanup at the app level.
 */
// HMR cleanup is handled by the consuming app (dev-app/src/App.tsx)

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing per-app documents.
 *
 * When enabled=false: No-op, returns null kernel/handle immediately.
 * When enabled=true: Waits for createFreshDocument() to be called, then creates
 * and returns a document handle + kernel API.
 *
 * Cleanup:
 * - Disposes current document on unmount (if any)
 * - Does NOT clear entire cache (other hooks may be using cached documents)
 * - Cache is cleared globally on page unload and HMR
 */
export function useAppDocument(options: UseAppDocumentOptions): UseAppDocumentResult {
  const { appId, enabled } = options;

  // State
  const [kernel, setKernel] = useState<IAppKernelAPI | null>(null);
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track current document ID for cleanup
  const currentDocumentIdRef = useRef<string | null>(null);

  // ==========================================================================
  // Create Fresh Document
  // ==========================================================================

  const createFreshDocument = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Generate unique document ID
      const timestamp = Date.now();
      const documentId = `app-${appId}-${timestamp}`;

      // Get or create document (uses cache)
      const newHandle = await getCachedOrCreateDocument(documentId);

      // Create unified Workbook for the document.
      // stateProvider omitted — default headless provider tracks activeSheetId internally.
      const workbook = await newHandle.workbook();

      // Create App Kernel API
      const newKernel = createAppKernelAPIFromHandle(newHandle, workbook);

      // Update state
      setHandle(newHandle);
      setKernel(newKernel);
      currentDocumentIdRef.current = documentId;
    } catch (err) {
      console.error('[useAppDocument] Failed to create document:', err);
      setError(err instanceof Error ? err.message : 'Failed to create document');
    } finally {
      setLoading(false);
    }
  }, [appId, enabled]);

  // ==========================================================================
  // Cleanup on Unmount
  // ==========================================================================

  useEffect(() => {
    // Cleanup function: dispose current document when this component unmounts
    return () => {
      const docId = currentDocumentIdRef.current;
      if (docId) {
        disposeDocument(docId);
      }
    };
  }, [appId]);

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    kernel,
    handle,
    loading,
    error,
    createFreshDocument,
  };
}
