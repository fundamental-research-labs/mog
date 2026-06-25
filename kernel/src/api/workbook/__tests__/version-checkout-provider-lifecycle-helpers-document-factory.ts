import { afterEach, beforeEach, jest } from '@jest/globals';

import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import type { DocumentContext } from '../../../context';
import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { installVersionDomainDetectorNoopsOnHandles } from './version-domain-support-test-utils';

export type ProviderLifecycleDocumentFactoryState = {
  readonly setStaleMaterializationVersioningScope: (scope: VersionDocumentScope | null) => void;
  readonly internalMaterializationCreateCount: () => number;
};

export function installProviderLifecycleDocumentFactoryHooks(): ProviderLifecycleDocumentFactoryState {
  let documentCreateSpy: { mockRestore(): void } | undefined;
  let staleMaterializationVersioningScope: VersionDocumentScope | null = null;
  let internalMaterializationCreateCount = 0;

  beforeEach(() => {
    staleMaterializationVersioningScope = null;
    internalMaterializationCreateCount = 0;
    const createDocument = DocumentFactory.create.bind(DocumentFactory);
    const spy = jest.spyOn(DocumentFactory, 'create');
    spy.mockImplementation(async (options?: any) => {
      const handle = await createDocument(options);
      const getAllSheetIds = bindProviderLifecycleGetAllSheetIds(handle);
      installVersionDomainDetectorNoopsOnHandles(handle);
      installProviderLifecycleMetadataNoops(handle, getAllSheetIds);
      if (options?.internal === true) {
        internalMaterializationCreateCount += 1;
        if (staleMaterializationVersioningScope) {
          attachStaleMaterializationVersioning(handle, staleMaterializationVersioningScope);
        }
      }
      return handle;
    });
    documentCreateSpy = spy;
  });

  afterEach(() => {
    documentCreateSpy?.mockRestore();
    documentCreateSpy = undefined;
    staleMaterializationVersioningScope = null;
    internalMaterializationCreateCount = 0;
  });

  return {
    setStaleMaterializationVersioningScope: (scope) => {
      staleMaterializationVersioningScope = scope;
    },
    internalMaterializationCreateCount: () => internalMaterializationCreateCount,
  };
}

export function versioningRuntimeForHandle(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
) {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  if (!isMutableRecord(context.versioning)) {
    throw new Error('expected attached versioning runtime');
  }
  return context.versioning;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function bindProviderLifecycleGetAllSheetIds(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
): (() => Promise<unknown>) | null {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge) || typeof bridge.getAllSheetIds !== 'function') return null;
  const getAllSheetIds = bridge.getAllSheetIds;
  return () => getAllSheetIds.call(bridge);
}

export function installProviderLifecycleMetadataNoops(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  getAllSheetIds: (() => Promise<unknown>) | null,
): void {
  const bridge = (
    (handle as Partial<DocumentHandleInternal>).context as DocumentContext | undefined
  )?.computeBridge;
  if (!isMutableRecord(bridge)) return;
  if (getAllSheetIds) bridge.getAllSheetIds = getAllSheetIds;
  bridge.getSheetName = async () => 'Sheet1';
  bridge.isSheetHidden = async () => false;
}

export function attachStaleMaterializationVersioning(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
  documentScope: VersionDocumentScope,
): void {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  context.versioning = {
    provider: createInMemoryVersionStoreProvider({ documentScope }),
    checkoutService: {
      checkout: jest.fn(),
    },
  };
}
