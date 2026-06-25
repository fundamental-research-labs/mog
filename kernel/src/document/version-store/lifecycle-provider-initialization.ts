import { versionGraphNamespaceKey, type VersionGraphNamespace } from './object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphRegistryReadResult,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import {
  namespaceForRegistry,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from './registry';
import { evaluateVersionHistoryRootPolicy } from './version-history-root-policy';
import {
  applyXlsxVersionImportChangeToExistingGraph,
  type XlsxVersionExistingGraphImportInput,
} from './xlsx-import-root';
import type { VersionStoreLifecycleRootInitializer } from './lifecycle-types';

export async function initializeSelectedProviderWhenAbsent(input: {
  readonly documentScope: VersionDocumentScope;
  readonly provider: VersionStoreProvider;
  readonly initialize?: VersionStoreLifecycleRootInitializer;
  readonly xlsxImportRootExistingGraph?: Omit<XlsxVersionExistingGraphImportInput, 'graph'>;
  readonly requireDurablePersistence?: boolean;
}): Promise<readonly VersionStoreDiagnostic[]> {
  let registryRead: VersionGraphRegistryReadResult;
  try {
    registryRead = await input.provider.readGraphRegistry();
  } catch {
    return [];
  }

  if (registryRead.status === 'ok') {
    const namespace = assertRegistryMatchesDocumentScope(
      input.documentScope,
      registryRead.registry,
    );
    if (!input.xlsxImportRootExistingGraph) return [];
    if (
      versionGraphNamespaceKey(input.xlsxImportRootExistingGraph.namespace) !==
      versionGraphNamespaceKey(namespace)
    ) {
      return [];
    }
    try {
      const graph = await input.provider.openGraph(namespace);
      const imported = await applyXlsxVersionImportChangeToExistingGraph({
        ...input.xlsxImportRootExistingGraph,
        graph,
      });
      if (
        imported.status === 'failed' &&
        isRejectedExistingGraphImportRootGap(imported.diagnostics)
      ) {
        return [];
      }
      return imported.diagnostics;
    } catch {
      return [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'commitGraphWrite',
          documentScope: input.documentScope,
          namespace,
          recoverability: 'retry',
          safeMessage: 'Existing version graph could not process XLSX reimport metadata.',
        }),
      ];
    }
  }
  if (registryRead.status !== 'absent') return registryRead.diagnostics;
  if (!input.initialize) return [];

  const rootPolicy = evaluateLifecycleRootPolicy(input.initialize);
  if (!rootPolicy.ok) return rootPolicy.diagnostics;

  const rootWrite = await materializeLifecycleRootWrite({
    documentScope: input.documentScope,
    initialize: input.initialize,
  });
  if (rootWrite.status === 'failed') return rootWrite.diagnostics;

  const initialized = await input.provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: input.initialize.graphId,
    rootWrite: rootWrite.rootWrite,
    requireDurablePersistence:
      input.initialize.requireDurablePersistence ?? input.requireDurablePersistence,
  });
  if (initialized.status !== 'success') {
    if (hasVersionGraphConflictDiagnostic(initialized.diagnostics)) {
      const accepted = await acceptAlreadyInitializedGraph({
        documentScope: input.documentScope,
        provider: input.provider,
        graphId: input.initialize.graphId,
      });
      if (accepted) return [];
    }
    return initialized.diagnostics;
  }

  assertRegistryMatchesDocumentScope(input.documentScope, initialized.registry);
  return [];
}

function isRejectedExistingGraphImportRootGap(
  diagnostics: readonly VersionStoreDiagnostic[],
): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.code === 'VERSION_HISTORY_ROOT_POLICY_BLOCKED' &&
      diagnostic.details?.rootKind === 'existing-no-history' &&
      diagnostic.details?.reason === 'history-gap-rejected',
  );
}

function evaluateLifecycleRootPolicy(
  initialize: VersionStoreLifecycleRootInitializer,
):
  | { readonly ok: true; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!initialize.historyRootKind && !initialize.historyRootPolicy) {
    return { ok: true, diagnostics: [] };
  }
  return evaluateVersionHistoryRootPolicy({
    kind: initialize.historyRootKind,
    policy: initialize.historyRootPolicy,
    operation: 'initializeGraph',
    hasExistingVisibleHistory: false,
  });
}

async function materializeLifecycleRootWrite(input: {
  readonly documentScope: VersionDocumentScope;
  readonly initialize: VersionStoreLifecycleRootInitializer;
}): Promise<
  | {
      readonly status: 'success';
      readonly rootWrite: VersionGraphInitializeInput['rootWrite'];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
> {
  let namespace: VersionGraphNamespace | undefined;
  try {
    namespace = namespaceForDocumentScope(input.documentScope, input.initialize.graphId);
    const rootWrite =
      input.initialize.rootWrite !== undefined
        ? input.initialize.rootWrite
        : await input.initialize.buildRootWrite();
    return { status: 'success', rootWrite };
  } catch {
    return {
      status: 'failed',
      diagnostics: [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'initializeGraph',
          documentScope: input.documentScope,
          ...(namespace ? { namespace } : {}),
          recoverability: 'retry',
          mutationGuarantee: 'no-write-attempted',
          safeMessage: 'Version graph root initializer failed before provider mutation.',
        }),
      ],
    };
  }
}

async function acceptAlreadyInitializedGraph(input: {
  readonly documentScope: VersionDocumentScope;
  readonly provider: VersionStoreProvider;
  readonly graphId: string;
}): Promise<boolean> {
  try {
    const registryRead = await input.provider.readGraphRegistry();
    if (registryRead.status !== 'ok') return false;
    if (registryRead.registry.currentGraphId !== input.graphId) return false;
    assertRegistryMatchesDocumentScope(input.documentScope, registryRead.registry);
    return true;
  } catch {
    return false;
  }
}

function hasVersionGraphConflictDiagnostic(
  diagnostics: readonly VersionStoreDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === 'VERSION_GRAPH_CONFLICT');
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
