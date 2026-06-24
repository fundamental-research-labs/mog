import type { DocumentHandle, DocumentHandleWorkbookConfig } from '@mog-sdk/kernel';
import {
  createPublicVersionDomainSupportManifest,
  type DomainSupportManifest,
} from '@mog-sdk/contracts/versioning';

type MutableDocumentHandleWorkbook = {
  workbook(config?: DocumentHandleWorkbookConfig): ReturnType<DocumentHandle['workbook']>;
};

type DefaultVersioningDocumentOptions = {
  readonly skipLocalPersistence?: boolean;
  readonly internal?: boolean;
  readonly operation?: 'create' | 'open';
};

const DEFAULT_VERSION_PROVIDER_SELECTION = {
  kind: 'indexeddb',
  requireDurablePersistence: true,
} as const satisfies NonNullable<
  NonNullable<DocumentHandleWorkbookConfig['versioning']>['providerSelection']
>;
type DefaultVersionProviderSelection = NonNullable<
  NonNullable<DocumentHandleWorkbookConfig['versioning']>['providerSelection']
>;

export function decorateNormalLocalHandleWithDefaultVersioning(
  handle: DocumentHandle,
  options?: DefaultVersioningDocumentOptions,
): DocumentHandle {
  if (options?.skipLocalPersistence === true || options?.internal === true) {
    return handle;
  }
  return decorateHandleWithDefaultIndexedDbVersioning(handle);
}

export function decorateHandleWithDefaultIndexedDbVersioning(
  handle: DocumentHandle,
): DocumentHandle {
  const originalWorkbook = handle.workbook.bind(handle);

  (handle as DocumentHandle & MutableDocumentHandleWorkbook).workbook = (async (
    config?: DocumentHandleWorkbookConfig,
  ) => {
    return originalWorkbook({
      ...config,
      versioning: {
        providerSelection: createDefaultVersionProviderSelection(handle),
        domainSupportManifest: createDefaultDomainSupportManifest(handle.documentId),
        ...config?.versioning,
      },
    });
  }) as DocumentHandle['workbook'];
  return handle;
}

function createDefaultVersionProviderSelection(
  handle: DocumentHandle,
): DefaultVersionProviderSelection {
  return {
    ...DEFAULT_VERSION_PROVIDER_SELECTION,
    ...(handle.isReadOnly === true ? { readOnly: true } : {}),
    ...(handle.isImportDurabilityPending === true ? { initializeTiming: 'deferred' as const } : {}),
  };
}

function createDefaultDomainSupportManifest(documentId: string): DomainSupportManifest {
  return createPublicVersionDomainSupportManifest({ workbookId: documentId });
}
