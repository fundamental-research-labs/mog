import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';
import type {
  VersionDiagnostic,
  VersionResult,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import type {
  CommitVersionGraphInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/graph-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';
import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposal-workspace-lifecycle-service';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [],
  createdAt: '2026-06-22T00:00:02.000Z',
} as const;
type InMemoryVersionStoreProvider = ReturnType<typeof createInMemoryVersionStoreProvider>;
type AgentProposalStore = Awaited<
  ReturnType<InMemoryVersionStoreProvider['openAgentProposalMetadataStore']>
>;
type UpdateProposalInput = Parameters<AgentProposalStore['updateProposal']>[0];

describe('WorkbookVersion provider-backed proposal accept policy', () => {
  it('fast-forwards the target branch through provider-backed refs after approved review', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'fast-forward');

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-fast-forward',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'fast_forwarded',
        proposalId: ready.proposalId,
        appliedCommitId: ready.proposalCommitId,
        targetRef: 'refs/heads/main',
        newHeadId: ready.proposalCommitId,
        refUpdateReceiptId: expect.stringContaining('proposal-accept:'),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: ready.proposalCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied' },
    });
  });

  it('marks a reviewed proposal stale when the target branch head moved', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: movedMainCommitId,
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_head',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });
  });

  it('replays stale target-head accept retries from durable proposal diagnostics', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-retry');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );
    const acceptInput = {
      clientRequestId: 'proposal-accept-target-stale-retry',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const accepted = await version.acceptProposal(acceptInput);
    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toEqual(accepted);
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_head',
            data: expect.objectContaining({
              acceptClientRequestId: acceptInput.clientRequestId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });

  it('retries stale no-write accepts against current review state without appending diagnostics', async () => {
    const graph = await graphWithRoot();
    const acceptClientRequestId = 'proposal-accept-target-stale-no-write-review-retry';
    const provider = providerWithFirstStaleProposalUpdateFailure(graph.provider, {
      clientRequestId: acceptClientRequestId,
      diagnostic: noWriteStaleProposalUpdateDiagnostic(acceptClientRequestId),
    });
    const version = versionForProvider(
      provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-no-write-retry');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );
    const acceptInput = {
      clientRequestId: acceptClientRequestId,
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const noWriteAttempt = await version.acceptProposal(acceptInput);

    expect(noWriteAttempt).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.acceptProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'proposal_accept_stale_update_no_write',
            data: expect.objectContaining({
              operation: 'acceptProposal',
              acceptClientRequestId,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, diagnostics: [] },
    });

    const approvedReview = await version.getReview({ reviewId: ready.reviewId });
    if (!approvedReview.ok) {
      throw new Error(`expected approved review before retry: ${approvedReview.error.code}`);
    }
    const rejectedReview = await version.updateReviewStatus({
      reviewId: ready.reviewId,
      expectedRevision: approvedReview.value.revision,
      clientRequestId: 'proposal-review-reject-after-stale-no-write',
      status: 'rejected',
      actor: ACTOR,
      reason: 'Reviewer withdrew approval before retry.',
    });
    expect(rejectedReview).toMatchObject({ ok: true, value: { status: 'rejected' } });

    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_review_not_approved',
        allowed: ['approved'],
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, diagnostics: [] },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'rejected' },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });

  it('keeps target-head drift acceptance disabled without merge apply capability', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
      { proposalAcceptMergeApplyCapability: false },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-disabled');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale-disabled',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'VC-07',
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5 },
    });
  });

  it('marks a reviewed proposal stale when the proposal branch head changed', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'proposal-branch-stale');
    await commitRef(
      graph.provider,
      `refs/heads/${ready.proposalBranchName}`,
      ready.proposalCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-proposal-branch-stale',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: graph.rootCommitId,
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: graph.rootCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_branch_head',
            data: expect.objectContaining({
              expectedProposalCommitId: ready.proposalCommitId,
              actualProposalBranchHeadId: expect.stringMatching(/^commit:sha256:/),
            }),
          }),
        ],
      },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });

  it('replays stale proposal-branch accept retries from durable proposal diagnostics', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'proposal-branch-stale-retry');
    const movedProposalBranchHeadId = await commitRef(
      graph.provider,
      `refs/heads/${ready.proposalBranchName}`,
      ready.proposalCommitId,
    );
    const acceptInput = {
      clientRequestId: 'proposal-accept-proposal-branch-stale-retry',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const accepted = await version.acceptProposal(acceptInput);
    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toEqual(accepted);
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_proposal_branch_head',
            data: expect.objectContaining({
              acceptClientRequestId: acceptInput.clientRequestId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: graph.rootCommitId },
      },
    });
  });

  it.each(['allowCleanMerge', 'allowResolvedMerge'] as const)(
    'fails closed for unsupported %s acceptance policy',
    async (resolutionPolicy) => {
      const graph = await graphWithRoot();
      const version = versionForProvider(
        graph.provider,
        graphCommittingWorkspaceService(graph.provider),
      );
      const ready = await createReadyReviewedProposal(version, graph, resolutionPolicy);

      const accepted = await version.acceptProposal({
        clientRequestId: `proposal-accept-${resolutionPolicy}`,
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy,
      });

      expect(accepted).toMatchObject({
        ok: false,
        error: {
          code: 'invalid_state',
          state: 'proposal_accept_resolution_policy_unsupported',
          allowed: ['fastForwardOnly'],
        },
      });
      await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: { commitId: graph.rootCommitId },
        },
      });
      await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
        ok: true,
        value: { status: 'ready_for_review', revision: 5 },
      });
      await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
        ok: true,
        value: { status: 'approved' },
      });
    },
  );
});

function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  options: { readonly proposalAcceptMergeApplyCapability?: boolean } = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, {
    provider,
    proposalWorkspaceService,
    ...(options.proposalAcceptMergeApplyCapability === false
      ? {}
      : { captureMergeCommit: unexpectedMergeCommitCapture }),
  });
  return new WorkbookVersionImpl(ctx);
}

async function unexpectedMergeCommitCapture(): Promise<never> {
  throw new Error('proposal accept capability fixture must not materialize merge commits');
}

async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: Awaited<ReturnType<typeof graphWithRoot>>,
  suffix: string,
) {
  const created = await version.createProposal({
    clientRequestId: `proposal-create-${suffix}`,
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    agentRunId: 'agent-run-1',
    agent: AGENT,
    redactionPolicy: REDACTION_POLICY,
  });
  if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
  const opened = await version.startProposalWorkspace({
    clientRequestId: `workspace-open-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 1,
    actor: ACTOR,
  });
  if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);
  const committed = await version.commitProposalWorkspace({
    clientRequestId: `workspace-commit-${suffix}`,
    proposalId: created.value.id,
    workspaceId: opened.value.workspaceId,
    expectedRevision: 2,
    actor: ACTOR,
    message: 'Agent proposal commit',
  });
  if (!committed.ok) throw new Error(`expected proposal commit success: ${committed.error.code}`);
  const verified = await version.markProposalVerified({
    clientRequestId: `proposal-verify-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 3,
    actor: ACTOR,
    verification: PASSED_VERIFICATION,
  });
  if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);
  const review = await version.openProposalReview({
    clientRequestId: `proposal-review-${suffix}`,
    proposalId: created.value.id,
    expectedRevision: 4,
    actor: ACTOR,
  });
  if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
  const approved = await approveReview(
    version,
    review.value.id,
    review.value.revision,
    `proposal-review-approve-${suffix}`,
  );
  if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return {
    proposalId: created.value.id,
    proposalCommitId: committed.value.proposalCommitId,
    proposalBranchName: created.value.proposalBranchName,
    reviewId: review.value.id,
  };
}

function approveReview(
  version: WorkbookVersionImpl,
  reviewId: VersionUpdateReviewStatusInput['reviewId'],
  expectedRevision: number,
  clientRequestId: string,
) {
  return version.updateReviewStatus({
    reviewId,
    expectedRevision,
    clientRequestId,
    status: 'approved',
    actor: ACTOR,
  });
}

function graphCommittingWorkspaceService(
  provider: InMemoryVersionStoreProvider,
): ProposalWorkspaceLifecycleService {
  return {
    async startProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: `workspace:${input.proposal.id}`,
          proposalId: input.proposal.id,
          proposalBranchName: input.proposal.proposalBranchName,
          baseCommitId: input.proposal.baseCommitId,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.proposal.id}`,
        },
      };
    },
    async getProposalWorkspace(input) {
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalId: 'proposal:sha256:lookup' as never,
          proposalBranchName: 'agent/lookup' as never,
          baseCommitId: `commit:sha256:${'0'.repeat(64)}` as never,
          providerIdentity: 'in-memory-test-provider',
          workbookSessionId: `session:${input.workspaceId}`,
        },
      };
    },
    async disposeProposalWorkspace() {
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace(input) {
      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const graph = await provider.openGraph(namespace);
      const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
      const branch = await graph.readRef(proposalRefName);
      if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
        throw new Error('expected proposal branch ref before workspace commit');
      }
      const committed = await graph.commit(
        await commitInput(namespace, branch.ref.commitId, branch.ref.revision, proposalRefName),
      );
      if (committed.status !== 'success') {
        throw new Error(
          `expected proposal graph commit success: ${committed.diagnostics[0]?.code}`,
        );
      }
      return {
        ok: true,
        value: {
          workspaceId: input.workspaceId,
          proposalCommitId: committed.commit.id,
        },
      };
    },
  };
}

async function graphWithRoot() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expectInitializeSuccess(initialized);
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
  };
}

async function commitRef(
  provider: InMemoryVersionStoreProvider,
  targetRef: string,
  expectedHeadCommitId: WorkbookCommitId,
): Promise<WorkbookCommitId> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const graph = await provider.openGraph(namespace);
  const ref = await graph.readRef(targetRef);
  if (ref.status !== 'success' || ref.ref.name === 'HEAD') {
    throw new Error(`expected ${targetRef} before proposal accept test`);
  }
  const committed = await graph.commit(
    await commitInput(namespace, expectedHeadCommitId, ref.ref.revision, targetRef),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected ${targetRef} move success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit.id;
}

function providerWithFirstStaleProposalUpdateFailure(
  provider: InMemoryVersionStoreProvider,
  options: {
    readonly clientRequestId: string;
    readonly diagnostic: VersionDiagnostic;
  },
): InMemoryVersionStoreProvider {
  let pendingFailure = true;
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'openAgentProposalMetadataStore') {
        return async () => {
          const store = await target.openAgentProposalMetadataStore();
          return staleUpdateFailingStore(store, {
            shouldFail: (input) => {
              if (
                !pendingFailure ||
                input.status !== 'stale' ||
                input.clientRequestId !== options.clientRequestId
              ) {
                return false;
              }
              pendingFailure = false;
              return true;
            },
            diagnostic: options.diagnostic,
          });
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as InMemoryVersionStoreProvider;
}

function staleUpdateFailingStore(
  store: AgentProposalStore,
  options: {
    readonly shouldFail: (input: UpdateProposalInput) => boolean;
    readonly diagnostic: VersionDiagnostic;
  },
): AgentProposalStore {
  return {
    documentScope: store.documentScope,
    createProposal: (input) => store.createProposal(input),
    getProposal: (proposalId) => store.getProposal(proposalId),
    getProposalByWorkspaceId: (workspaceId) => store.getProposalByWorkspaceId(workspaceId),
    listProposals: (input) => store.listProposals(input),
    updateProposal: async (input) => {
      if (options.shouldFail(input)) return noWriteProposalUpdateFailure(options.diagnostic);
      return store.updateProposal(input);
    },
  };
}

function noWriteProposalUpdateFailure<T>(diagnostic: VersionDiagnostic): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: 'workbook.version.acceptProposal',
      diagnostics: [diagnostic],
    },
  };
}

function noWriteStaleProposalUpdateDiagnostic(clientRequestId: string): VersionDiagnostic {
  return {
    code: 'proposal_accept_stale_update_no_write',
    severity: 'warning',
    message: 'Stale proposal accept update was rejected before writing.',
    owner: 'version-store',
    data: {
      operation: 'acceptProposal',
      acceptClientRequestId: clientRequestId,
      mutationGuarantee: 'no-write-attempted',
    },
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

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: GRAPH_AUTHOR,
      createdAt: '2026-06-22T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  expectedHeadCommitId: WorkbookCommitId,
  expectedTargetRefVersion: RefVersion,
  targetRef: string,
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'proposal',
      sheets: [{ id: 'sheet-1', cells: { B1: 'proposal-edit' } }],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [
        {
          changeId: 'proposal-change-b1',
          domain: 'cell',
          entityId: 'sheet-1!B1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 'proposal-edit' },
        },
      ],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'proposal-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: '2026-06-22T00:00:01.000Z',
    completenessDiagnostics: [],
    targetRef,
    expectedHeadCommitId,
    expectedTargetRefVersion,
    parentCommitIds: [expectedHeadCommitId],
  };
}

async function objectRecord(
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
