import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';
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
import { attachWorkbookVersioning } from '../version-wiring';
import { WorkbookVersionImpl } from '../version';

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

describe('WorkbookVersion provider-backed proposal service', () => {
  it('auto-attaches provider-backed proposal metadata without advertising workspace lifecycle', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(graph.provider);

    const created = await version.createProposal(createProposalInput('proposal-create-1'));
    expect(created).toMatchObject({
      ok: true,
      value: {
        status: 'draft',
        revision: 1,
        targetRef: 'refs/heads/main',
        baseCommitId: graph.rootCommitId,
        targetHeadIdAtCreation: graph.rootCommitId,
        proposalBranchName: expect.stringMatching(/^agent\/agent-run-1\//),
      },
    });
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { id: created.value.id, status: 'draft' },
    });
    await expect(version.listProposals({ targetRef: 'refs/heads/main' })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: created.value.id }], totalEstimate: 1 },
    });
    await expect(version.getRef(created.value.proposalBranchName)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: `refs/heads/${created.value.proposalBranchName}`,
          commitId: graph.rootCommitId,
        },
      },
    });
    await expect(
      version.startProposalWorkspace({
        clientRequestId: 'workspace-open-unavailable',
        proposalId: created.value.id,
        expectedRevision: 1,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [expect.objectContaining({ code: 'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE' })],
      },
    });

    const surface = await version.getSurfaceStatus();
    expect(surface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
    });
  });

  it('delegates workspace lifecycle to an attached branch-isolated workspace service before review', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    await expect(version.getSurfaceStatus()).resolves.toMatchObject({
      capabilities: { 'version:proposal': { enabled: true } },
    });

    const created = await version.createProposal(createProposalInput('proposal-create-2'));
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-1',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });
    expect(opened).toMatchObject({
      ok: true,
      value: {
        proposalId: created.value.id,
        proposalBranchName: created.value.proposalBranchName,
        baseCommitId: graph.rootCommitId,
      },
    });
    if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-1',
      proposalId: created.value.id,
      workspaceId: opened.value.workspaceId,
      expectedRevision: 2,
      actor: ACTOR,
      message: 'Agent proposal commit',
    });
    if (!committed.ok) {
      throw new Error(`expected proposal commit success: ${JSON.stringify(committed.error)}`);
    }
    expect(committed).toMatchObject({
      ok: true,
      value: {
        status: 'committed',
        revision: 3,
        proposalCommitId: expect.stringMatching(/^commit:sha256:[0-9a-f]{64}$/),
      },
    });

    const verified = await version.markProposalVerified({
      clientRequestId: 'proposal-verify-1',
      proposalId: created.value.id,
      expectedRevision: 3,
      actor: ACTOR,
      verification: PASSED_VERIFICATION,
    });
    expect(verified).toMatchObject({ ok: true, value: { status: 'verified', revision: 4 } });
    if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);

    const review = await version.openProposalReview({
      clientRequestId: 'proposal-review-1',
      proposalId: created.value.id,
      expectedRevision: 4,
      actor: ACTOR,
    });
    expect(review).toMatchObject({
      ok: true,
      value: {
        subject: {
          kind: 'proposal',
          proposalId: created.value.id,
          baseCommitId: graph.rootCommitId,
          headCommitId: committed.value.proposalCommitId,
        },
      },
    });
    if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);

    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'ready_for_review',
        revision: 5,
        reviewId: review.value.id,
      },
    });

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-1',
      proposalId: created.value.id,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });
    if (!accepted.ok) {
      throw new Error(`expected proposal accept success: ${JSON.stringify(accepted.error)}`);
    }
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'fast_forwarded',
        proposalId: created.value.id,
        appliedCommitId: committed.value.proposalCommitId,
        targetRef: 'refs/heads/main',
        newHeadId: committed.value.proposalCommitId,
        refUpdateReceiptId: expect.stringContaining('proposal-accept:'),
      },
    });

    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: committed.value.proposalCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
  });

  it('marks a proposal stale when the target ref moves before acceptance', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });
    const ready = await createReadyReviewedProposal(version, graph, 'stale');
    const movedMainCommitId = await commitMain(graph.provider, graph.rootCommitId);

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-stale',
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

    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'stale', revision: 6 },
    });
  });
});

function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  versioning: Partial<Parameters<typeof attachWorkbookVersioning>[1]> = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider, ...versioning });
  return new WorkbookVersionImpl(ctx);
}

function createProposalInput(clientRequestId: string) {
  return {
    clientRequestId,
    title: 'Proposal One',
    targetRef: 'refs/heads/main' as const,
    agentRunId: 'agent-run-1',
    agent: AGENT,
    redactionPolicy: REDACTION_POLICY,
  };
}

async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: Awaited<ReturnType<typeof graphWithRoot>>,
  suffix: string,
) {
  const created = await version.createProposal(createProposalInput(`proposal-create-${suffix}`));
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

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return { proposalId: created.value.id, proposalCommitId: committed.value.proposalCommitId };
}

async function commitMain(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  expectedHeadCommitId: WorkbookCommitId,
): Promise<WorkbookCommitId> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const graph = await provider.openGraph(namespace);
  const main = await graph.readRef('refs/heads/main');
  if (main.status !== 'success' || main.ref.name === 'HEAD') {
    throw new Error('expected main ref before stale proposal test');
  }
  const committed = await graph.commit(
    await commitInput(namespace, expectedHeadCommitId, main.ref.revision, 'refs/heads/main'),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected main move success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit.id;
}

function graphCommittingWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
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
      try {
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
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.commitProposalWorkspace',
            diagnostics: [
              {
                code: 'TEST_WORKSPACE_COMMIT_FAILED',
                severity: 'error',
                message: error instanceof Error ? error.message : 'Workspace commit failed.',
              },
            ],
          },
        };
      }
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
