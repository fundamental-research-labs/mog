import type { VersionGraphNamespace } from '../graph';
import type { WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeResult,
} from '../provider';
import type { RefVersion } from '../refs/ref-store';
import {
  DIFF_SERVICE_DOCUMENT_SCOPE,
  type DiffServiceProvider,
} from './diff-service-fixtures-graph-context';
import {
  commitInput,
  initializeInput,
} from './diff-service-fixtures-graph-inputs';

export async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DIFF_SERVICE_DOCUMENT_SCOPE,
  });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const appended = await appendChild(
    {
      provider,
      namespace: namespaceForDocumentScope(DIFF_SERVICE_DOCUMENT_SCOPE, 'graph-1'),
      rootCommitId: initialized.rootCommit.id,
      headCommitId: initialized.rootCommit.id,
      headRevision: initialized.initialHead.revision,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    namespace: namespaceForDocumentScope(DIFF_SERVICE_DOCUMENT_SCOPE, 'graph-1'),
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

export async function appendChild(
  graph: {
    readonly provider: DiffServiceProvider;
    readonly namespace: VersionGraphNamespace;
    readonly rootCommitId?: WorkbookCommitId;
    readonly headCommitId?: WorkbookCommitId;
    readonly headRevision?: RefVersion;
  },
  options: {
    readonly label: string;
    readonly semanticPayload: unknown;
  },
): Promise<{ readonly childCommitId: WorkbookCommitId }> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');

  const committed = await opened.commit(
    await commitInput(
      graph.namespace,
      options.label,
      options.semanticPayload,
      head.head.id,
      head.head.refRevision as RefVersion,
    ),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return { childCommitId: committed.commit.id };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}
