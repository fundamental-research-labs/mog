import type { ShellBootstrapResult } from '@mog/shell/bootstrap';

import { getSourceFileKind, toDocumentSource } from './bytes';
import { noopDisposable } from './deferred';
import type { SpreadsheetDocumentSource } from './public-types';
import type {
  SpreadsheetAppCapabilityRegistry,
  SpreadsheetAppDocumentHandle,
} from './runtime-types';

export function createPermissiveCapabilityRegistry(): SpreadsheetAppCapabilityRegistry {
  const grants = new Map<string, Set<string>>();
  const listeners = new Set<(event: unknown) => void>();

  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };

  const registry = {
    on(_event: string, handler: (event: unknown) => void) {
      listeners.add(handler);
      return noopDisposable();
    },
    once(_event: string, handler: (event: unknown) => void) {
      const wrapped = (event: unknown) => {
        listeners.delete(wrapped);
        handler(event);
      };
      listeners.add(wrapped);
      return noopDisposable();
    },
    hasCapability() {
      return true;
    },
    getGrants() {
      return [];
    },
    getEffectiveCapabilities(appId: string) {
      return [...(grants.get(appId) ?? [])];
    },
    grant(appId: string, capability: string) {
      const set = grants.get(appId) ?? new Set<string>();
      set.add(capability);
      grants.set(appId, set);
      emit({ type: 'capability:granted', appId, capability, timestamp: Date.now() });
    },
    grantBatch(appId: string, capabilities: readonly string[]) {
      for (const capability of capabilities) this.grant(appId, capability);
    },
    revoke(appId: string, capability: string) {
      grants.get(appId)?.delete(capability);
      emit({ type: 'capability:revoked', appId, capability, timestamp: Date.now() });
    },
    revokeAll(appId: string) {
      const count = grants.get(appId)?.size ?? 0;
      grants.delete(appId);
      return count;
    },
    expandCapabilities(capabilities: readonly unknown[]) {
      return [...capabilities];
    },
    isCapabilityScoped() {
      return false;
    },
    getCapabilityScope() {
      return null;
    },
    cleanupExpired() {
      return 0;
    },
    subscribeToApp() {
      return noopDisposable();
    },
    subscribeToAll() {
      return noopDisposable();
    },
    dispose() {
      grants.clear();
      listeners.clear();
    },
    [Symbol.dispose]() {
      this.dispose();
    },
  };

  return registry as unknown as SpreadsheetAppCapabilityRegistry;
}

export function openShellDocument(
  shell: ShellBootstrapResult,
  documentId: string,
  displayName: string,
): void {
  const store = shell.store.getState();
  store.addOpenFileId(documentId);
  store.addFile({
    id: documentId,
    filePath: null,
    displayName,
    isModified: false,
    lastSaved: null,
    documentType: 'spreadsheet',
  });
  store.setActiveFileId(documentId);
  store.setActiveAppId('spreadsheet');
}

export function asSpreadsheetAppDocumentHandle(
  handle: unknown,
  operation: string,
): SpreadsheetAppDocumentHandle {
  const candidate = handle as Partial<SpreadsheetAppDocumentHandle>;
  if (!candidate.eventBus || typeof candidate.eventBus.onAll !== 'function') {
    throw new Error(
      `Spreadsheet app document handle missing runtime internals during ${operation}`,
    );
  }
  return candidate as SpreadsheetAppDocumentHandle;
}

export async function loadDocumentForSource(
  shell: ShellBootstrapResult,
  documentId: string,
  source: SpreadsheetDocumentSource,
  options?: { skipLocalPersistence?: boolean },
): Promise<SpreadsheetAppDocumentHandle> {
  const documentSource = toDocumentSource(source);
  if (!documentSource) {
    const handle = await shell.documentManager.createDocument(documentId, {
      documentId,
      internal: true,
      skipLocalPersistence: options?.skipLocalPersistence,
    });
    return asSpreadsheetAppDocumentHandle(handle, 'createDocument');
  }

  const loadOptions = {
    kind: getSourceFileKind(source),
    skipLocalPersistence: options?.skipLocalPersistence,
  } as const;
  const handle = await shell.documentManager.loadDocument(documentId, documentSource, loadOptions);
  return asSpreadsheetAppDocumentHandle(handle, 'loadDocument');
}
