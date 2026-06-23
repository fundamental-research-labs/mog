import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import {
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from '../../../api/workbook/__tests__/version-domain-support-test-utils';
import type { VersionNormalCommitCapture } from '../commit-service';
import {
  openVersionStoreIndexedDb,
  REGISTRIES_STORE,
} from '../provider-indexeddb-schema';
import {
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../provider';
import {
  objectRecord,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
} from './provider-indexeddb-test-utils';

export {
  objectRecord,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
  updateFirstByNamespace,
} from './provider-indexeddb-test-utils';

const SHEET_ID = 'sheet-1';

export const FULL_STATE_BYTES = new Uint8Array([0x0a, 0x0b, 0x0c]);

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockContext() {
  return {
    eventBus: createMockEventBus(),
    computeBridge: {
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID] as never),
      getSheetName: jest.fn().mockResolvedValue('Sheet1' as never),
      isSheetHidden: jest.fn().mockResolvedValue(false as never),
      getMutationHandler: jest.fn().mockReturnValue(null),
      onTrap: jest.fn().mockReturnValue(() => undefined),
      syncApply: jest.fn().mockResolvedValue(undefined as never),
      encodeDiff: jest.fn().mockResolvedValue(FULL_STATE_BYTES as never),
      currentStateVector: jest.fn().mockResolvedValue(new Uint8Array([0x01]) as never),
    },
    mirror: {
      getSheetIds: jest.fn().mockReturnValue([SHEET_ID]),
      getSheetMeta: jest.fn().mockReturnValue({ name: 'Sheet1', hidden: false }),
      getWorkbookSettings: jest.fn().mockReturnValue({}),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    workbookLinkScope: jest.fn().mockReturnValue({ requestingSessionId: 'session-1' }),
  };
}

jest.unstable_mockModule('../../index', () => ({
  DocumentLifecycleSystem: jest.fn().mockImplementation(() => {
    const context = createMockContext();
    let documentId = 'doc-test';
    return {
      create: jest.fn((id: string) => {
        documentId = id;
      }),
      waitForReady: jest.fn().mockResolvedValue(undefined as never),
      dispose: jest.fn().mockResolvedValue(undefined as never),
      scheduleDeferredHydration: jest.fn().mockResolvedValue(undefined as never),
      ensureDeferredHydration: jest.fn().mockResolvedValue(undefined as never),
      awaitMaterialized: jest.fn().mockResolvedValue(undefined as never),
      awaitImportDurability: jest.fn().mockResolvedValue(undefined as never),
      attachStorageProvider: jest.fn().mockResolvedValue(undefined as never),
      checkpoint: jest.fn().mockResolvedValue({ status: 'checkpointed' } as never),
      close: jest.fn().mockResolvedValue({
        status: 'closed',
        detachedProviders: [],
        errors: [],
        timestamp: Date.now(),
      } as never),
      get snapshot() {
        return { context: { docId: documentId, initialSheetIds: [SHEET_ID] } };
      },
      get documentContext() {
        return context;
      },
      get initialSheetId() {
        return SHEET_ID;
      },
      get rustDocument() {
        return null;
      },
      get computeBridge() {
        return context.computeBridge;
      },
      get isImportDurabilityPending() {
        return false;
      },
      _devtoolsProviders: jest.fn().mockReturnValue([]),
    };
  }),
}));

jest.unstable_mockModule('../../../api/worksheet/worksheet-impl', () => ({
  WorksheetImpl: jest.fn().mockImplementation((sheetId: string) => ({
    _sheetId: sheetId,
    _syncMetadata: jest.fn(),
    dispose: jest.fn(),
  })),
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: jest.fn().mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  }),
}));

jest.unstable_mockModule('../../../api/namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

const documentFactoryModule = await import('../../../api/document/document-factory');

export const DocumentFactory = documentFactoryModule.DocumentFactory;

type LifecycleVersioningConfig = Parameters<
  Awaited<ReturnType<typeof DocumentFactory.create>>['workbook']
>[0]['versioning'];

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

export async function createLifecycleDocumentHandle(documentId: string) {
  return DocumentFactory.create({
    documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export async function openLifecycleWorkbook(
  documentId: string,
  versioning: NonNullable<LifecycleVersioningConfig>,
) {
  const handle = await createLifecycleDocumentHandle(documentId);
  const wb = await handle.workbook({ versioning: withVersionManifest(versioning) });
  installVersionDomainDetectorNoopsOnWorkbook(wb);
  return { handle, wb };
}

export const captureNormalCommit: VersionNormalCommitCapture = async ({ namespace, options }) => {
  const label = options.message ?? 'normal commit';
  return {
    status: 'success',
    input: {
      ...(await rootWrite(label, namespace)),
      mutationSegmentRecords: [
        await objectRecord('workbook.mutationSegment.v1', { label, operations: [] }, namespace),
      ],
    },
  };
};

export async function putRegistryEnvelope(
  documentScope: VersionDocumentScope,
  value: unknown,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REGISTRIES_STORE, 'readwrite');
  tx.objectStore(REGISTRIES_STORE).put(value, versionDocumentScopeKey(documentScope));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('registry put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('registry put aborted'));
  });
  db.close();
}
