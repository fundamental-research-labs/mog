import { expect } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  type InMemoryVersionDocumentProviderBackend,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  VERSION_AUTHOR,
} from './version-checkout-provider-lifecycle-helpers-constants';
import { providerLifecycleObjectRecord } from './version-checkout-provider-lifecycle-helpers-objects';

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function initializeVersionGraph(
  options: { readonly backend?: InMemoryVersionDocumentProviderBackend } = {},
): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    ...(options.backend ? { backend: options.backend } : {}),
  });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

export async function replaceVisibleRegistryGraph(
  backend: InMemoryVersionDocumentProviderBackend,
  graphId: string,
  label: string,
): Promise<void> {
  const input = await initializeInput(graphId, label);
  const graph = backend.getOrCreateGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, graphId));
  const initialized = await graph.initializeGraph(input.rootWrite);
  if (initialized.status !== 'success') {
    throw new Error(
      `expected replacement graph initialize success: ${initialized.diagnostics[0]?.code}`,
    );
  }
  const registry = await createVersionGraphRegistry({
    documentScope: DOCUMENT_SCOPE,
    graphId,
    rootCommitId: initialized.commit.id,
    createdAt: initialized.commit.payload.createdAt,
  });
  backend.setRegistry(DOCUMENT_SCOPE, registry);
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await providerLifecycleObjectRecord(
        namespace,
        'workbook.snapshotRoot.v1',
        {
          label,
          sheets: [],
        },
      ),
      semanticChangeSetRecord: await providerLifecycleObjectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        {
          label,
          changes: [],
        },
      ),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}
