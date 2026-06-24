import { expect } from '@jest/globals';

import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import type { VersionGraphWriteResult } from '../../../document/version-store/graph';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
} from './version-checkout-preconditions-helpers-constants';
import type {
  InitializedVersionGraph,
  TestVersionStoreProvider,
} from './version-checkout-preconditions-helpers-types';

export async function initializeVersionGraph(
  graphId: string,
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
): Promise<{
  provider: TestVersionStoreProvider;
  initialized: InitializedVersionGraph;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', completenessDiagnostics),
  );
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

export async function appendHeadCommit(
  provider: TestVersionStoreProvider,
  graphId: string,
  initialized: InitializedVersionGraph,
  label: string,
): Promise<Extract<VersionGraphWriteResult, { status: 'success' }>> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const input = await initializeInput(graphId, label);
  const result = await graph.commit({
    ...input.rootWrite,
    expectedHeadCommitId: initialized.rootCommit.id,
    expectedMainRefVersion: initialized.initialHead.revision,
  });
  expectGraphWriteSuccess(result);
  return result;
}

export async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is InitializedVersionGraph {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeInput(
  graphId: string,
  label: string,
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics,
    },
  };
}
