/**
 * DocumentManager Context
 *
 * Provides DocumentManager to React components.
 * DocumentManager is created during shell bootstrap (before React mounts)
 * and passed via context.
 *
 * The DocumentManager owns document lifecycle, surviving React component remounts.
 * React components subscribe to it via the useDocument hook.
 *
 * Usage:
 * ```tsx
 * // At app root (in ShellProvider)
 * <DocumentManagerProvider documentManager={shell.documentManager}>
 *   <App />
 * </DocumentManagerProvider>
 *
 * // In components
 * const dm = useDocumentManager();
 * const doc = dm.getDocument(fileId);
 * ```
 *
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { DocumentManager } from '../services/document';

// =============================================================================
// Context
// =============================================================================

const DocumentManagerContext = createContext<DocumentManager | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface DocumentManagerProviderProps {
  /**
   * DocumentManager instance to provide.
   * Created during shell bootstrap via createDocumentManager().
   */
  documentManager: DocumentManager;

  /**
   * Children to render.
   */
  children: ReactNode;
}

/**
 * Provider component that makes the DocumentManager available to all descendants.
 *
 * @example
 * ```tsx
 * const shell = await createShell();
 *
 * function App() {
 *   return (
 *     <DocumentManagerProvider documentManager={shell.documentManager}>
 *       <MainLayout />
 *     </DocumentManagerProvider>
 *   );
 * }
 * ```
 */
export function DocumentManagerProvider({
  documentManager,
  children,
}: DocumentManagerProviderProps): React.JSX.Element {
  return (
    <DocumentManagerContext.Provider value={documentManager}>
      {children}
    </DocumentManagerContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the DocumentManager.
 *
 * @returns The DocumentManager instance
 * @throws Error if used outside of DocumentManagerProvider
 *
 * @example
 * ```tsx
 * function DocumentInfo({ fileId }: { fileId: string }) {
 *   const dm = useDocumentManager();
 *   const doc = dm.getDocument(fileId);
 *   const state = dm.getLoadingState(fileId);
 *
 *   return <div>State: {state}</div>;
 * }
 * ```
 */
export function useDocumentManager(): DocumentManager {
  const dm = useContext(DocumentManagerContext);
  if (!dm) {
    throw new Error('useDocumentManager must be used within DocumentManagerProvider');
  }
  return dm;
}

/**
 * Hook to optionally access the DocumentManager.
 * Returns null if not within a DocumentManagerProvider.
 *
 * Useful for components that can work with or without document functionality.
 *
 * @returns The DocumentManager instance or null
 *
 * @example
 * ```tsx
 * function MaybeDocumentInfo({ fileId }: { fileId: string }) {
 *   const dm = useDocumentManagerOptional();
 *
 *   if (!dm) {
 *     return <div>No document manager available</div>;
 *   }
 *
 *   const doc = dm.getDocument(fileId);
 *   return <div>Document: {doc ? 'loaded' : 'not loaded'}</div>;
 * }
 * ```
 */
export function useDocumentManagerOptional(): DocumentManager | null {
  return useContext(DocumentManagerContext);
}
