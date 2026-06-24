import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type VersionGraphWriteResult,
} from '../graph';
import type { VersionGraphNamespace } from '../object-store';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphStore,
  type VersionStoreCapabilities,
  type VersionStoreFailure,
} from '../provider';
import { createVersionGraphRegistry, type VersionDocumentScope } from '../registry';
import {
  failedStoreResult,
  initializeSuccess,
  mapGraphDiagnostics,
  registryRecordResult,
  versionStoreDiagnostic,
  type RegistryRecordRead,
} from './internal';
import {
  persistInitializedIndexedDbBackendGraphSnapshot,
  publishIndexedDbBackendRegistryVisibleLast,
} from './backend-registry';

export async function initializeIndexedDbBackendGraph(options: {
  readonly input: VersionGraphInitializeInput;
  readonly capabilities: VersionStoreCapabilities;
  readonly documentScope: VersionDocumentScope;
  readonly scopeKey: string;
  readonly writeFailure: VersionStoreFailure | null;
  readonly getDb: () => Promise<IDBDatabase>;
  readonly readRegistryRecord: () => Promise<RegistryRecordRead>;
  readonly openGraph: (namespace: VersionGraphNamespace) => Promise<VersionGraphStore>;
}): Promise<VersionGraphInitializeResult> {
  const writeFailure = options.writeFailure;
  if (writeFailure) return writeFailure;

  const { input } = options;
  if (
    input.requireDurablePersistence &&
    (!options.capabilities.durableGraphRegistry || !options.capabilities.durableObjects)
  ) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_UNSUPPORTED_DURABLE_PERSISTENCE', {
          operation: 'initializeGraph',
          documentScope: options.documentScope,
          recoverability: 'unsupported',
          safeMessage:
            'This version store provider does not support durable graph registry and object persistence.',
        }),
      ],
      'no-write-attempted',
    );
  }

  if (input.expectedRegistryRevision !== null) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
          operation: 'initializeGraph',
          documentScope: options.documentScope,
          recoverability: 'retry',
          safeMessage: 'Graph registry initialization expected an absent registry.',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  let namespace: VersionGraphNamespace;
  try {
    namespace = namespaceForDocumentScope(options.documentScope, input.graphId);
  } catch {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
          operation: 'initializeGraph',
          documentScope: options.documentScope,
          safeMessage: 'Graph registry initialization requested an invalid graph namespace.',
        }),
      ],
      'no-write-attempted',
    );
  }

  const existingRegistry = await options.readRegistryRecord();
  if (existingRegistry.status === 'corrupt' || existingRegistry.status === 'unsupported') {
    return failedStoreResult(
      registryRecordResult(existingRegistry.status, 'initializeGraph', options.documentScope)
        .diagnostics,
      'no-write-attempted',
    );
  }

  const dryRun = createInMemoryVersionGraphStore({ namespace });
  const dryRunInitialized = await dryRun.initializeGraph(input.rootWrite);
  if (dryRunInitialized.status !== 'success') {
    return failedStoreResult(
      mapGraphDiagnostics(dryRunInitialized.diagnostics, 'initializeGraph'),
      'no-write-attempted',
    );
  }

  if (existingRegistry.status === 'valid') {
    return initializeIndexedDbBackendAgainstExistingRegistry({
      existingRegistry: existingRegistry.registry,
      namespace,
      initialized: dryRunInitialized,
      documentScope: options.documentScope,
      openGraph: options.openGraph,
    });
  }

  const snapshot = await dryRun.exportSnapshot();
  const persisted = await persistInitializedIndexedDbBackendGraphSnapshot({
    db: await options.getDb(),
    snapshot,
    documentScope: options.documentScope,
  });
  if (persisted.status !== 'success') {
    return persisted;
  }

  const registry = await createVersionGraphRegistry({
    documentScope: options.documentScope,
    graphId: namespace.graphId,
    rootCommitId: dryRunInitialized.commit.id,
    createdAt: dryRunInitialized.commit.payload.createdAt,
  });
  const published = await publishIndexedDbBackendRegistryVisibleLast({
    db: await options.getDb(),
    registry,
    scopeKey: options.scopeKey,
    documentScope: options.documentScope,
  });
  if (published.status === 'published') {
    return initializeSuccess(registry, dryRunInitialized.main);
  }
  if (published.status === 'same') {
    return initializeIndexedDbBackendAgainstExistingRegistry({
      existingRegistry: published.registry,
      namespace,
      initialized: dryRunInitialized,
      documentScope: options.documentScope,
      openGraph: options.openGraph,
    });
  }

  return published.failure;
}

async function initializeIndexedDbBackendAgainstExistingRegistry(options: {
  readonly existingRegistry: VersionGraphRegistry;
  readonly namespace: VersionGraphNamespace;
  readonly initialized: Extract<VersionGraphWriteResult, { status: 'success' }>;
  readonly documentScope: VersionDocumentScope;
  readonly openGraph: (namespace: VersionGraphNamespace) => Promise<VersionGraphStore>;
}): Promise<VersionGraphInitializeResult> {
  if (
    options.existingRegistry.currentGraphId === options.namespace.graphId &&
    options.existingRegistry.rootCommitId === options.initialized.commit.id
  ) {
    const graph = await options.openGraph(options.namespace);
    const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
    if (main.status === 'success' && main.ref.name === VERSION_GRAPH_MAIN_REF) {
      return initializeSuccess(options.existingRegistry, main.ref);
    }

    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
          operation: 'initializeGraph',
          documentScope: options.documentScope,
          namespace: options.namespace,
          recoverability: 'repair',
          safeMessage: 'Visible graph registry points at an unreadable graph.',
        }),
      ],
      'no-write-attempted',
    );
  }

  return failedStoreResult(
    [
      versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
        operation: 'initializeGraph',
        documentScope: options.documentScope,
        namespace: options.namespace,
        commitId: options.existingRegistry.rootCommitId,
        recoverability: 'retry',
        safeMessage: 'A version graph registry already exists for this document.',
      }),
    ],
    'no-write-attempted',
    true,
  );
}
