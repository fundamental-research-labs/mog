import './recent-docs/__tests__/setup-structured-clone';

import 'fake-indexeddb/auto';

import type { DocumentHandle } from '@mog-sdk/kernel';
import { clearMeta, readMeta, touchDoc } from '@mog-sdk/kernel/storage';
import { createShellStore } from '../ui-store/shell-store';
import type { DocumentManager } from './document';
import { createRecentDocsStore } from './recent-docs';
import { installActiveDocumentRecency } from './active-document-recency';

function makeHandle(documentId: string): DocumentHandle {
  return { documentId } as unknown as DocumentHandle;
}

function makeDocumentManager(handles: Map<string, DocumentHandle>): DocumentManager {
  return {
    loadDocument: jest.fn(),
    createDocument: jest.fn(),
    createCollaborationDocument: jest.fn(),
    getDocument: jest.fn((fileId: string) => handles.get(fileId) ?? null),
    disposeDocument: jest.fn(),
    closeCollaborationDocument: jest.fn(),
    getSidecar: jest.fn().mockReturnValue(null),
    getDocumentMode: jest.fn((fileId: string) =>
      handles.has(fileId)
        ? { kind: 'normal' as const, documentId: fileId, skipLocalPersistence: false }
        : null,
    ),
    attachSidecar: jest.fn(),
    detachSidecar: jest.fn(),
    disposeAll: jest.fn(),
    getLoadingState: jest.fn().mockReturnValue('idle'),
    getError: jest.fn().mockReturnValue(null),
    getOpenFileIds: jest.fn(() => Array.from(handles.keys())),
    subscribe: jest.fn().mockReturnValue(() => {}),
    getState: jest.fn().mockReturnValue({
      documents: handles,
      documentModes: new Map(
        Array.from(handles.keys(), (fileId) => [
          fileId,
          { kind: 'normal' as const, documentId: fileId, skipLocalPersistence: false },
        ]),
      ),
      loadingStates: new Map(),
      errors: new Map(),
    }),
    setError: jest.fn(),
    clearError: jest.fn(),
  };
}

async function waitForLastActiveDocId(expected: string | null): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const meta = await readMeta();
    if (meta.lastActiveDocId === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect((await readMeta()).lastActiveDocId).toBe(expected);
}

beforeEach(async () => {
  await clearMeta();
});

describe('active document recency', () => {
  it('touches Meta when the active tab switches to an already-open document', async () => {
    const store = createShellStore();
    const recentDocsStore = createRecentDocsStore();
    const handles = new Map<string, DocumentHandle>([
      ['doc-a', makeHandle('doc-a')],
      ['doc-b', makeHandle('doc-b')],
    ]);
    const manager = makeDocumentManager(handles);
    const dispose = installActiveDocumentRecency({
      store,
      documentManager: manager,
      recentDocsStore,
    });

    store.getState().setActiveFileId('doc-a');
    await waitForLastActiveDocId('doc-a');

    store.getState().setActiveFileId('doc-b');
    await waitForLastActiveDocId('doc-b');

    dispose();
  });

  it('does not clear lastActiveDocId when activeFileId becomes null', async () => {
    await touchDoc('doc-prior');
    const store = createShellStore();
    const recentDocsStore = createRecentDocsStore();
    const manager = makeDocumentManager(new Map());
    const dispose = installActiveDocumentRecency({
      store,
      documentManager: manager,
      recentDocsStore,
    });

    store.getState().setActiveFileId(null);
    await waitForLastActiveDocId('doc-prior');

    dispose();
  });

  it('ignores ids whose loaded handle does not match the shell file id', async () => {
    const store = createShellStore();
    const recentDocsStore = createRecentDocsStore();
    const handles = new Map<string, DocumentHandle>([
      ['shell-file-id', makeHandle('different-kernel-doc-id')],
    ]);
    const manager = makeDocumentManager(handles);
    const dispose = installActiveDocumentRecency({
      store,
      documentManager: manager,
      recentDocsStore,
    });

    store.getState().setActiveFileId('shell-file-id');
    await waitForLastActiveDocId(null);

    dispose();
  });

  it('does not touch Meta for documents that skip local persistence', async () => {
    await touchDoc('doc-prior');
    const store = createShellStore();
    const recentDocsStore = createRecentDocsStore();
    const handles = new Map<string, DocumentHandle>([
      ['doc-ephemeral', makeHandle('doc-ephemeral')],
    ]);
    const manager = makeDocumentManager(handles);
    jest
      .mocked(manager.getDocumentMode)
      .mockImplementation((fileId: string) =>
        handles.has(fileId)
          ? { kind: 'normal' as const, documentId: fileId, skipLocalPersistence: true }
          : null,
      );
    const dispose = installActiveDocumentRecency({
      store,
      documentManager: manager,
      recentDocsStore,
    });

    store.getState().setActiveFileId('doc-ephemeral');
    await waitForLastActiveDocId('doc-prior');

    dispose();
  });
});
