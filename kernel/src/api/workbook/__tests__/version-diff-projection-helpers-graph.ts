import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreProvider,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import { AUTHOR, CREATED_AT, DOCUMENT_SCOPE } from './version-diff-projection-helpers-constants';
import { graphContentInput } from './version-diff-projection-helpers-records';
import { defaultCellChange, validSemanticPayload } from './version-diff-projection-fixtures';

export async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const appended = await appendChild(
    {
      provider,
      namespace,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

export async function graphWithMergeTarget() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-merge', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-merge');
  const graph = await provider.openGraph(namespace);
  const branch = await graph.createBranch({
    name: 'scenario/merge-parent',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

  const ours = await graph.commit(
    await commitInput(
      namespace,
      'ours',
      validSemanticPayload('ours', [defaultCellChange('ours')]),
      initialized.rootCommit.id,
      initialized.initialHead.revision,
    ),
  );
  if (ours.status !== 'success')
    throw new Error(`expected ours commit: ${ours.diagnostics[0]?.code}`);

  const theirs = await graph.commit(
    await commitInput(
      namespace,
      'theirs',
      validSemanticPayload('theirs', [defaultCellChange('theirs')]),
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

  const merge = await graph.mergeCommit({
    ...(await graphContentInput(
      namespace,
      'merge',
      validSemanticPayload('merge', [defaultCellChange('merge')]),
    )),
    expectedHeadCommitId: ours.commit.id,
    expectedMainRefVersion: ours.main.revision,
    mergeParentCommitId: theirs.commit.id,
  });
  if (merge.status !== 'success') {
    throw new Error(`expected merge commit: ${merge.diagnostics[0]?.code}`);
  }

  return {
    provider,
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

async function appendChild(
  graph: {
    readonly provider: VersionStoreProvider;
    readonly namespace: VersionGraphNamespace;
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

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      ...(await graphContentInput(namespace, label, validSemanticPayload(label, []))),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedRefVersion: RefVersion,
  options: {
    readonly targetRef?: string;
    readonly parentCommitIds?: readonly WorkbookCommitId[];
  } = {},
) {
  return {
    ...(await graphContentInput(namespace, label, semanticPayload)),
    ...(options.targetRef
      ? { targetRef: options.targetRef, expectedTargetRefVersion: expectedRefVersion }
      : { expectedMainRefVersion: expectedRefVersion }),
    ...(options.parentCommitIds ? { parentCommitIds: options.parentCommitIds } : {}),
    expectedHeadCommitId,
  };
}
