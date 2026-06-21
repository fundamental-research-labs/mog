import type { VersionNormalCommitCapture, WorkbookVersionCommitService } from './commit-service';
import type { CheckoutSnapshotMaterializer } from './checkout-apply';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphRegistryReadResult,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
  type VersionStoreProviderKind,
} from './provider-registry';
import {
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import {
  normalizeVersionDocumentScope,
  namespaceForRegistry,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from './registry';

export type ResolvedWorkbookVersioningConfig = {
  readonly provider?: VersionStoreProvider;
  readonly writeService?: Pick<
    WorkbookVersionCommitService,
    'readHead' | 'readRef' | 'listCommits' | 'commit'
  >;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly checkoutSnapshotMaterializer?: CheckoutSnapshotMaterializer;
};

export type VersionStoreLifecycleProviderSelection = {
  readonly kind: VersionStoreProviderKind | (string & {});
  readonly workspaceId?: string;
  readonly principalScope?: string;
  readonly readOnly?: boolean;
  readonly requireDurablePersistence?: boolean;
  /**
   * Optional root graph initializer for documents whose selected durable store
   * has no visible version graph yet. Hosts must provide this explicitly so
   * IndexedDB never becomes an implicit default.
   */
  readonly initialize?: {
    readonly graphId: string;
    readonly rootWrite: VersionGraphInitializeInput['rootWrite'];
    readonly requireDurablePersistence?: boolean;
  };
};

export type DocumentWorkbookVersioningLifecycleConfig = ResolvedWorkbookVersioningConfig & {
  /**
   * Explicit document-scoped provider selection. Used by DocumentHandle.workbook()
   * because resolving and initializing durable providers is asynchronous; the
   * lower-level WorkbookConfig path still accepts an already-created provider.
   */
  readonly providerSelection?: VersionStoreLifecycleProviderSelection;
};

export type ResolvedDocumentWorkbookVersioningLifecycle = {
  readonly versioning?: ResolvedWorkbookVersioningConfig;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export type VersionStoreLifecycleFailureReadService = {
  readHead(): Promise<{
    readonly status: 'degraded';
    readonly head: null;
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  readRef(): Promise<{
    readonly status: 'degraded';
    readonly ref: null;
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  listCommits(): Promise<{
    readonly status: 'failed';
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  commit(): Promise<{
    readonly status: 'failed';
    readonly diagnostics: readonly VersionStoreDiagnostic[];
    readonly mutationGuarantee: 'no-write-attempted';
    readonly retryable: false;
  }>;
};

export async function resolveDocumentWorkbookVersioningLifecycle(input: {
  readonly documentId: string;
  readonly versioning?: DocumentWorkbookVersioningLifecycleConfig;
}): Promise<ResolvedDocumentWorkbookVersioningLifecycle> {
  const config = input.versioning;
  if (!config) return { diagnostics: [] };
  if (config.provider || !config.providerSelection) {
    if (config.provider) {
      const mismatchDiagnostics = diagnosticsForProviderScopeMismatch(
        input.documentId,
        config.provider,
      );
      if (mismatchDiagnostics.length > 0) {
        return {
          versioning: {
            writeService: createLifecycleFailureReadService(mismatchDiagnostics),
          },
          diagnostics: mismatchDiagnostics,
        };
      }
    }
    return { versioning: config, diagnostics: [] };
  }

  const providerSelection = config.providerSelection;
  const documentScope = normalizeVersionDocumentScope({
    ...(providerSelection.workspaceId === undefined
      ? {}
      : { workspaceId: providerSelection.workspaceId }),
    documentId: input.documentId,
    ...(providerSelection.principalScope === undefined
      ? {}
      : { principalScope: providerSelection.principalScope }),
  });
  const provider = selectVersionStoreProvider(
    {
      kind: providerSelection.kind,
      documentScope,
      readOnly: providerSelection.readOnly,
      requireDurablePersistence: providerSelection.requireDurablePersistence,
    },
    createDefaultVersionStoreProviderRegistry(),
  );

  const diagnostics = await initializeSelectedProviderWhenAbsent({
    documentScope,
    provider,
    initialize: providerSelection.initialize,
    requireDurablePersistence: providerSelection.requireDurablePersistence,
  });

  return {
    versioning: {
      provider,
      captureNormalCommit: config.captureNormalCommit,
      snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
      writeService: config.writeService,
      checkoutSnapshotMaterializer: config.checkoutSnapshotMaterializer,
    },
    diagnostics,
  };
}

export function createLifecycleFailureReadService(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionStoreLifecycleFailureReadService {
  const frozenDiagnostics = Object.freeze([...diagnostics]);
  return {
    async readHead() {
      return { status: 'degraded', head: null, diagnostics: frozenDiagnostics };
    },
    async readRef() {
      return { status: 'degraded', ref: null, diagnostics: frozenDiagnostics };
    },
    async listCommits() {
      return { status: 'failed', diagnostics: frozenDiagnostics };
    },
    async commit() {
      return {
        status: 'failed',
        diagnostics: frozenDiagnostics,
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      };
    },
  };
}

function diagnosticsForProviderScopeMismatch(
  documentId: string,
  provider: VersionStoreProvider,
): readonly VersionStoreDiagnostic[] {
  if (provider.documentScope.documentId === documentId) return [];
  return [
    versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
      operation: 'openGraph',
      documentScope: { documentId },
      safeMessage: 'Selected version store provider does not match this document scope.',
      mutationGuarantee: 'no-write-attempted',
    }),
  ];
}

async function initializeSelectedProviderWhenAbsent(input: {
  readonly documentScope: VersionDocumentScope;
  readonly provider: VersionStoreProvider;
  readonly initialize?: VersionStoreLifecycleProviderSelection['initialize'];
  readonly requireDurablePersistence?: boolean;
}): Promise<readonly VersionStoreDiagnostic[]> {
  let registryRead: VersionGraphRegistryReadResult;
  try {
    registryRead = await input.provider.readGraphRegistry();
  } catch {
    return [];
  }

  if (registryRead.status === 'ok') {
    assertRegistryMatchesDocumentScope(input.documentScope, registryRead.registry);
    return [];
  }
  if (registryRead.status !== 'absent') return registryRead.diagnostics;
  if (!input.initialize) return [];

  const initialized = await input.provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: input.initialize.graphId,
    rootWrite: input.initialize.rootWrite,
    requireDurablePersistence:
      input.initialize.requireDurablePersistence ?? input.requireDurablePersistence,
  });
  if (initialized.status !== 'success') return initialized.diagnostics;

  assertRegistryMatchesDocumentScope(input.documentScope, initialized.registry);
  return [];
}

function assertRegistryMatchesDocumentScope(
  documentScope: VersionDocumentScope,
  registry: VersionGraphRegistry,
): VersionGraphNamespace {
  const expected = namespaceForDocumentScope(documentScope, registry.currentGraphId);
  const registryNamespace = namespaceForRegistry(registry);
  if (versionGraphNamespaceKey(expected) !== versionGraphNamespaceKey(registryNamespace)) {
    throw new Error('Version graph registry namespace does not match selected document scope.');
  }
  return expected;
}

export type { VersionNormalCommitCapture };
