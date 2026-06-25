import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { AUTHOR, DOCUMENT_SCOPE } from './version-diff-projection-helpers-constants';
import {
  appendChild,
  expectInitializeSuccess,
} from './version-diff-projection-helpers-graph-operations';
import { commitInput, initializeInput } from './version-diff-projection-helpers-graph-inputs';
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

export async function graphWithMergeTarget(
  options: {
    readonly materializedMergeProof?: boolean;
    readonly changes?: readonly unknown[];
    readonly mergeChanges?: readonly unknown[];
  } = {},
) {
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

  const mergeChange = defaultCellChange('merge');
  const changes = options.changes ?? [mergeChange];
  const mergePayload = {
    ...validSemanticPayload('merge', changes),
    ...(options.materializedMergeProof
      ? {
          merge: {
            baseCommitId: initialized.rootCommit.id,
            oursCommitId: ours.commit.id,
            theirsCommitId: theirs.commit.id,
            targetRef: 'refs/heads/main',
            expectedTargetHead: {
              commitId: ours.commit.id,
              revision: ours.main.revision,
            },
            resolutionCount: options.mergeChanges?.length ?? 0,
            materializer: 'test-materializer',
          },
        }
      : {}),
    ...(options.mergeChanges ? { mergeChanges: [...options.mergeChanges] } : {}),
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
    mergeChange,
  };
}
