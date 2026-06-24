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
type DefaultVersionedWorkbook = Awaited<ReturnType<DocumentHandle['workbook']>>;

export function decorateNormalLocalHandleWithDefaultVersioning(
  handle: DocumentHandle,
  options?: DefaultVersioningDocumentOptions,
): DocumentHandle {
  if (options?.skipLocalPersistence === true || options?.internal === true) {
    return handle;
  }
  return decorateHandleWithDefaultIndexedDbVersioning(handle, options);
}

export function decorateHandleWithDefaultIndexedDbVersioning(
  handle: DocumentHandle,
  options: Pick<DefaultVersioningDocumentOptions, 'operation'> = {},
): DocumentHandle {
  const originalWorkbook = handle.workbook.bind(handle);
  const materializeHeadOnOpen = options.operation === 'open';
  let materializedHead = false;

  (handle as DocumentHandle & MutableDocumentHandleWorkbook).workbook = (async (
    config?: DocumentHandleWorkbookConfig,
  ) => {
    const workbook = await originalWorkbook({
      ...config,
      versioning: {
        providerSelection: createDefaultVersionProviderSelection(handle),
        domainSupportManifest: createDefaultDomainSupportManifest(handle.documentId),
        ...config?.versioning,
      },
    });

    if (materializeHeadOnOpen && !materializedHead) {
      materializedHead = true;
      await materializeDefaultVersionHead(workbook, handle.documentId);
    }

    return workbook;
  }) as DocumentHandle['workbook'];
  return handle;
}

async function materializeDefaultVersionHead(
  workbook: DefaultVersionedWorkbook,
  documentId: string,
): Promise<void> {
  try {
    const result = await workbook.version.checkout(
      { kind: 'head' },
      { includeDiagnostics: true },
    );
    if (!result.ok) {
      console.warn('[DocumentManager] default version head checkout failed:', {
        documentId,
        code: result.error.code,
      });
    }
  } catch (error) {
    console.warn('[DocumentManager] default version head checkout threw:', {
      documentId,
      error,
    });
  }
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
