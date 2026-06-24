import type { VersionGraphNamespace } from '../graph';
import type { WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeResult,
} from '../provider';
import type { RefVersion } from '../refs/ref-store';
import {
  DIFF_SERVICE_AUTHOR,
  DIFF_SERVICE_DOCUMENT_SCOPE,
  type DiffServiceProvider,
} from './diff-service-fixtures-graph-context';
import {
  commitInput,
  graphContentInput,
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

export async function graphWithMergeTarget(options: {
  readonly changes: readonly unknown[];
  readonly mergeChanges: readonly unknown[];
}) {
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DIFF_SERVICE_DOCUMENT_SCOPE,
  });
  const initialized = await provider.initializeGraph(await initializeInput('graph-merge', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DIFF_SERVICE_DOCUMENT_SCOPE, 'graph-merge');
  const graph = await provider.openGraph(namespace);
  const branch = await graph.createBranch({
    name: 'scenario/merge-parent',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: DIFF_SERVICE_AUTHOR,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const ours = await graph.commit(
    await commitInput(
      namespace,
      'ours',
      { schemaVersion: 1, label: 'ours', changes: [] },
      initialized.rootCommit.id,
      initialized.initialHead.revision,
    ),
  );
  if (ours.status !== 'success') {
    throw new Error(`expected ours commit: ${ours.diagnostics[0]?.code}`);
  }

  const theirs = await graph.commit(
    await commitInput(
      namespace,
      'theirs',
      { schemaVersion: 1, label: 'theirs', changes: [] },
      initialized.rootCommit.id,
      branch.branch.ref.refVersion,
      {
        targetRef: 'refs/heads/scenario/merge-parent',
        parentCommitIds: [initialized.rootCommit.id],
      },
    ),
  );
  if (theirs.status !== 'success') {
    throw new Error(`expected theirs commit: ${theirs.diagnostics[0]?.code}`);
  }

  const mergePayload = {
    schemaVersion: 1,
    label: 'merge',
    merge: {
      baseCommitId: initialized.rootCommit.id,
      oursCommitId: ours.commit.id,
      theirsCommitId: theirs.commit.id,
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: ours.commit.id,
        revision: ours.main.revision,
      },
      resolutionCount: options.mergeChanges.length,
      materializer: 'test-materializer',
    },
    changes: [...options.changes],
    mergeChanges: [...options.mergeChanges],
  };

  const merge = await graph.mergeCommit({
    ...(await graphContentInput(namespace, 'merge', mergePayload)),
    expectedHeadCommitId: ours.commit.id,
    expectedMainRefVersion: ours.main.revision,
    mergeParentCommitId: theirs.commit.id,
  });
  if (merge.status !== 'success') {
    throw new Error(`expected merge commit: ${merge.diagnostics[0]?.code}`);
  }

  return {
    provider,
    baseCommitId: initialized.rootCommit.id,
    oursCommitId: ours.commit.id,
    theirsCommitId: theirs.commit.id,
    mergeCommitId: merge.commit.id,
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}
