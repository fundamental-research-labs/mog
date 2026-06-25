import { VERSION_GRAPH_MAIN_REF, createInMemoryVersionGraphStore } from './graph';
import type { VersionGraphNamespace } from './object-store';
import { mapGraphDiagnostics, versionStoreDiagnostic } from './provider-diagnostics';
import { failedStoreResult, initializeSuccess, registryRecordResult } from './provider-results';
import type {
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
} from './provider-types';
import { createVersionGraphRegistry, namespaceForDocumentScope } from './registry';
import {
  assertInMemoryProviderAvailable,
  inMemoryProviderWriteUnavailableFailure,
} from './provider-in-memory-availability';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

export async function readInMemoryGraphRegistry(
  state: InMemoryVersionStoreProviderState,
): Promise<VersionGraphRegistryReadResult> {
  assertInMemoryProviderAvailable(state, 'readGraphRegistry');

  const registryRecord = state.backend.readRegistryRecord(state.documentScope);
  if (!registryRecord) {
    return {
      status: 'absent',
      registry: null,
      diagnostics: [
        versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
          operation: 'readGraphRegistry',
          documentScope: state.documentScope,
          safeMessage: 'Version graph registry has not been initialized for this document.',
        }),
      ],
    };
  }
  if (registryRecord.kind !== 'valid') {
    return registryRecordResult(registryRecord.kind, 'readGraphRegistry', state.documentScope);
  }

  return {
    status: 'ok',
    registry: registryRecord.registry,
    diagnostics: [],
  };
}

export async function initializeInMemoryGraph(
  state: InMemoryVersionStoreProviderState,
  input: VersionGraphInitializeInput,
): Promise<VersionGraphInitializeResult> {
  const writeFailure = inMemoryProviderWriteUnavailableFailure(state, 'initializeGraph');
  if (writeFailure) return writeFailure;

  if (
    input.requireDurablePersistence &&
    (!state.capabilities.durableGraphRegistry || !state.capabilities.durableObjects)
  ) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_UNSUPPORTED_DURABLE_PERSISTENCE', {
          operation: 'initializeGraph',
          documentScope: state.documentScope,
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
          documentScope: state.documentScope,
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
    namespace = namespaceForDocumentScope(state.documentScope, input.graphId);
  } catch {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
          operation: 'initializeGraph',
          documentScope: state.documentScope,
          safeMessage: 'Graph registry initialization requested an invalid graph namespace.',
        }),
      ],
      'no-write-attempted',
    );
  }

  const existingRegistryRecord = state.backend.readRegistryRecord(state.documentScope);
  if (
    existingRegistryRecord?.kind === 'corrupt' ||
    existingRegistryRecord?.kind === 'unsupported'
  ) {
    return failedStoreResult(
      registryRecordResult(existingRegistryRecord.kind, 'initializeGraph', state.documentScope)
        .diagnostics,
      'no-write-attempted',
    );
  }

  if (existingRegistryRecord?.kind === 'valid') {
    const existingRegistry = existingRegistryRecord.registry;
    const dryRun = createInMemoryVersionGraphStore({ namespace });
    const dryRunInitialized = await dryRun.initializeGraph(input.rootWrite);
    if (dryRunInitialized.status !== 'success') {
      return failedStoreResult(
        mapGraphDiagnostics(dryRunInitialized.diagnostics, 'initializeGraph'),
        'no-write-attempted',
      );
    }

    if (
      existingRegistry.currentGraphId === namespace.graphId &&
      existingRegistry.rootCommitId === dryRunInitialized.commit.id
    ) {
      const existingGraph = state.backend.getGraph(namespace);
      if (!existingGraph) {
        return failedStoreResult(
          [
            versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
              operation: 'initializeGraph',
              documentScope: state.documentScope,
              namespace,
              recoverability: 'retry',
              safeMessage: 'Visible graph registry could not be opened by this provider.',
            }),
          ],
          'no-write-attempted',
          true,
        );
      }

      const main = await existingGraph.readRef(VERSION_GRAPH_MAIN_REF);
      if (main.status === 'success' && main.ref.name === VERSION_GRAPH_MAIN_REF) {
        return initializeSuccess(existingRegistry, main.ref);
      }

      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'initializeGraph',
            documentScope: state.documentScope,
            namespace,
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
          documentScope: state.documentScope,
          namespace,
          commitId: existingRegistry.rootCommitId,
          recoverability: 'retry',
          safeMessage: 'A version graph registry already exists for this document.',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  const graph = state.backend.getOrCreateGraph(namespace);
  const initialized = await graph.initializeGraph(input.rootWrite);

  if (initialized.status !== 'success') {
    const diagnostics = mapGraphDiagnostics(initialized.diagnostics, 'initializeGraph');
    const mutationGuarantee =
      initialized.mutationGuarantee === 'ref-not-mutated'
        ? 'registry-not-visible'
        : 'no-write-attempted';
    return failedStoreResult(diagnostics, mutationGuarantee);
  }

  const registry = await createVersionGraphRegistry({
    documentScope: state.documentScope,
    graphId: namespace.graphId,
    rootCommitId: initialized.commit.id,
    createdAt: initialized.commit.payload.createdAt,
  });
  state.backend.setRegistry(state.documentScope, registry);

  return initializeSuccess(registry, initialized.main);
}
