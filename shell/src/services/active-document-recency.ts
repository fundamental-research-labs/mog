import type { ShellStoreApi } from '../ui-store/shell-store';
import type { DocumentManager } from './document';
import type { RecentDocsStore } from './recent-docs';

export interface ActiveDocumentRecencyOptions {
  store: ShellStoreApi;
  documentManager: DocumentManager;
  recentDocsStore: RecentDocsStore;
}

/**
 * Mirrors user-visible active-document transitions into the Meta recency
 * boundary. Provider attach still records open recency; this observer records
 * active-tab recency, including switches to already-open workbooks.
 */
export function installActiveDocumentRecency({
  store,
  documentManager,
  recentDocsStore,
}: ActiveDocumentRecencyOptions): () => void {
  let disposed = false;
  let lastQueuedDocId: string | null = null;
  let chain = Promise.resolve();

  const queueTouch = (activeFileId: string | null): void => {
    if (!activeFileId || activeFileId === lastQueuedDocId) return;

    const handle = documentManager.getDocument(activeFileId);
    if (!handle || handle.documentId !== activeFileId) return;
    const mode = documentManager.getDocumentMode(activeFileId);
    if (mode?.kind === 'collaboration') return;
    if (mode?.kind === 'normal' && mode.skipLocalPersistence) return;

    lastQueuedDocId = activeFileId;
    chain = chain
      .then(async () => {
        if (disposed) return;
        await recentDocsStore.getState().touch(activeFileId);
      })
      .catch((err) => {
        console.error('[activeDocumentRecency] touch failed:', err);
      });
  };

  queueTouch(store.getState().activeFileId);
  const unsubscribe = store.subscribe((state, prevState) => {
    if (state.activeFileId !== prevState.activeFileId) {
      queueTouch(state.activeFileId);
    }
  });

  return () => {
    disposed = true;
    unsubscribe();
  };
}
