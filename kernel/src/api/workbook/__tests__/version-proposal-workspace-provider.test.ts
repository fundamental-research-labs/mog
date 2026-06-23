import type {
  AgentProposalWorkspaceHandle,
  VersionCreateReviewInput,
  VersionGetReviewInput,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import type { CommitVersionGraphInput } from '../../../document/version-store/graph-store';
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
import {
  proposalWorkspaceStaleHeadResult,
  type ProposalWorkspaceLifecycleService,
} from '../../../document/version-store/proposal-workspace-lifecycle-service';
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

describe('WorkbookVersion provider-backed proposal workspace lookup', () => {
  it('validates proposal workspace lookup handles before returning them', async () => {
    const graph = await graphWithRoot();
    const workspaceService = workspaceLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toEqual({
      ok: true,
      value: opened,
    });
    await expect(
      version.getProposalWorkspace({ workspaceId: 'workspace:missing' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', target: 'workbook.version.proposal' },
    });
  });

  it('rejects proposal workspace lookup handles that do not match stored metadata', async () => {
    const graph = await graphWithRoot();
    const workspaceService = misboundLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'misbound-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_branch_mismatch',
        allowed: ['matching_proposal_workspace'],
      },
    });
  });

  it('rejects proposal workspace lookup handles with a mismatched base commit binding', async () => {
    const graph = await graphWithRoot();
    const workspaceService = misbasedLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'misbased-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_base_mismatch',
        allowed: ['matching_proposal_workspace'],
      },
    });
  });

  it('validates workspace bindings before disposal', async () => {
    const graph = await graphWithRoot();
    const workspaceService = workspaceLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-dispose');

    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-missing',
        workspaceId: 'workspace:missing',
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', target: 'workbook.version.proposal' },
    });
    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-ok',
        workspaceId: opened.workspaceId,
        actor: ACTOR,
      }),
    ).resolves.toEqual({ ok: true, value: { disposed: true } });
  });

  it('fails closed when a proposal workspace commit observes a stale branch head', async () => {
    const graph = await graphWithRoot();
    const workspaceService = staleHeadCheckingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-stale-head');
    const movedProposalBranchHeadId = await commitRef(
      graph.provider,
      `refs/heads/${opened.proposalBranchName}`,
      graph.rootCommitId,
    );
    const safeProposalBranchName = opened.proposalBranchName.replace(
      'agent-run-1',
      'redacted-principal',
    );

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-stale-head',
      proposalId: opened.proposalId,
      workspaceId: opened.workspaceId,
      expectedRevision: 2,
      actor: ACTOR,
      message: 'Stale workspace commit',
    });
    expect(committed).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commitProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_workspace_head',
            data: expect.objectContaining({
              proposalId: opened.proposalId,
              workspaceId: opened.workspaceId,
              proposalBranchName: safeProposalBranchName,
              expectedWorkspaceHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(committed)).not.toContain('agent-run-1');
    await expect(version.getProposal({ proposalId: opened.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });

  it('redacts unsafe provider workspace diagnostics before returning public failures', async () => {
    const graph = await graphWithRoot();
    const workspaceService = unsafeStartDiagnosticWorkspaceService();
    const version = versionForProvider(graph.provider, workspaceService);
    const created = await version.createProposal({
      clientRequestId: 'proposal-create-unsafe-diagnostics',
      title: 'Proposal One',
      targetRef: 'refs/heads/main',
      agentRunId: 'agent-run-1',
      agent: AGENT,
      redactionPolicy: REDACTION_POLICY,
    });
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-unsafe-diagnostics',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });

    expect(opened).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
            message: 'Workspace denied redacted-principal for redacted-principal.',
            data: expect.objectContaining({
              safeWorkspaceId: 'workspace:redaction',
              safeNote: 'redacted-principal',
              safeTokens: ['redacted-principal', 'redacted-principal'],
              nested: expect.objectContaining({
                safeStatus: 'kept',
                safeNote: 'redacted-principal',
              }),
            }),
          }),
        ],
      },
    });
    if (opened.ok) throw new Error('expected workspace start to fail');
    const diagnostic = opened.error.diagnostics[0] as any;
    expect(diagnostic.data).not.toHaveProperty('principalId');
    expect(diagnostic.data).not.toHaveProperty('agentRunId');
    expect(diagnostic.data.nested).not.toHaveProperty('actorId');
    const serialized = JSON.stringify(opened);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('agent-run-1');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('principalId');
    expect(serialized).not.toContain('agentRunId');
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'draft', revision: 1 },
    });
  });

  it('rejects proposal acceptance when the linked review record is missing', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
      { reviewService: missingLinkedReviewService() as any },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'missing-review', false);

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-missing-review',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'not_found',
        target: 'workbook.version.review',
        reason: expect.stringContaining(ready.reviewId),
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, reviewId: ready.reviewId },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: { status: 'success', ref: { commitId: graph.rootCommitId } },
    });
  });

  it('persists public diagnostics when the target head moves before acceptance', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'stale-target');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-stale-target',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
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
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_head',
            severity: 'warning',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
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
});

function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  versioning: Partial<Parameters<typeof attachWorkbookVersioning>[1]> = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  const mergeCap = async () => undefined as never;
  attachWorkbookVersioning(ctx, {
    provider,
    captureMergeCommit: mergeCap,
    proposalWorkspaceService,
    ...versioning,
  });
  return new WorkbookVersionImpl(ctx);
}

async function openProposalWorkspace(
  version: WorkbookVersionImpl,
  suffix: string,
): Promise<AgentProposalWorkspaceHandle> {
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
  return opened.value;
}

async function createReadyReviewedProposal(
  version: WorkbookVersionImpl,
  graph: Awaited<ReturnType<typeof graphWithRoot>>,
  suffix: string,
  approve = true,
) {
  const opened = await openProposalWorkspace(version, suffix);
  const committed = await version.commitProposalWorkspace({
    clientRequestId: `workspace-commit-${suffix}`,
    proposalId: opened.proposalId,
    workspaceId: opened.workspaceId,
    expectedRevision: 2,
    actor: ACTOR,
    message: 'Agent proposal commit',
  });
  if (!committed.ok) throw new Error(`expected proposal commit success: ${committed.error.code}`);
  const verified = await version.markProposalVerified({
    clientRequestId: `proposal-verify-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 3,
    actor: ACTOR,
    verification: PASSED_VERIFICATION,
  });
  if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);
  const review = await version.openProposalReview({
    clientRequestId: `proposal-review-${suffix}`,
    proposalId: opened.proposalId,
    expectedRevision: 4,
    actor: ACTOR,
  });
  if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
  if (approve) {
    const approved = await approveReview(
      version,
      review.value.id,
      review.value.revision,
      `proposal-review-approve-${suffix}`,
    );
    if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);
  }

  expect(committed.value.baseCommitId).toBe(graph.rootCommitId);
  return {
    proposalId: opened.proposalId,
    proposalCommitId: committed.value.proposalCommitId,
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

function workspaceLookupService(): ProposalWorkspaceLifecycleService {
  const handles = new Map<string, AgentProposalWorkspaceHandle>();
  return {
    async startProposalWorkspace(input) {
      const handle: AgentProposalWorkspaceHandle = {
        workspaceId: `workspace:${input.proposal.id}`,
        proposalId: input.proposal.id,
        proposalBranchName: input.proposal.proposalBranchName,
        baseCommitId: input.proposal.baseCommitId,
        providerIdentity: 'in-memory-test-provider',
        workbookSessionId: `session:${input.proposal.id}`,
      };
      handles.set(handle.workspaceId, handle);
      return { ok: true, value: handle };
    },
    async getProposalWorkspace(input) {
      const handle = handles.get(input.workspaceId);
      return handle
        ? ({ ok: true, value: handle } as const)
        : ({
            ok: false,
            error: {
              code: 'target_unavailable',
              target: 'workbook.version.getProposalWorkspace',
              diagnostics: [
                {
                  code: 'TEST_WORKSPACE_NOT_FOUND',
                  severity: 'error',
                  message: 'Workspace handle was not found.',
                },
              ],
            },
          } as const);
    },
    async disposeProposalWorkspace(input) {
      handles.delete(input.workspaceId);
      return { ok: true, value: { disposed: true } };
    },
    async commitProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.commitProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_COMMIT_UNAVAILABLE',
              severity: 'error',
              message: 'This test service only supports lookup and disposal.',
            },
          ],
        },
      };
    },
  };
}

function misboundLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          proposalBranchName: `${workspace.value.proposalBranchName}-other` as never,
        },
      };
    },
  };
}

function misbasedLookupService(): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async getProposalWorkspace(input) {
      const workspace = await base.getProposalWorkspace(input);
      if (!workspace.ok) return workspace;
      return {
        ok: true,
        value: {
          ...workspace.value,
          baseCommitId: `commit:sha256:${'f'.repeat(64)}` as never,
        },
      };
    },
  };
}

function unsafeStartDiagnosticWorkspaceService(): ProposalWorkspaceLifecycleService {
  return {
    ...workspaceLookupService(),
    async startProposalWorkspace() {
      return {
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.startProposalWorkspace',
          diagnostics: [
            {
              code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
              severity: 'error',
              message: 'Workspace denied principal-secret for agent-run-1.',
              data: {
                principalId: 'principal-secret',
                agentRunId: 'agent-run-1',
                safeWorkspaceId: 'workspace:redaction',
                safeNote: 'agent-run-1',
                safeTokens: ['principal-secret', 'agent-run-1'],
                nested: {
                  actorId: 'actor-secret',
                  safeStatus: 'kept',
                  safeNote: 'agent-run-1',
                },
              },
            },
          ],
        },
      };
    },
  };
}

function missingLinkedReviewService() {
  return {
    async createReview(input: VersionCreateReviewInput) {
      const review: WorkbookVersionReviewRecord = {
        schemaVersion: 1,
        id: `review:${input.clientRequestId}`,
        documentId: DOCUMENT_SCOPE.documentId,
        subject: input.subject,
        status: 'approved',
        baseCommitId: input.baseCommitId,
        headCommitId: input.headCommitId,
        revision: 1,
        createdBy: input.createdBy,
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
        decisions: [],
        redaction: {
          policy: input.redactionPolicy,
          redactedFields: [],
          diagnostics: [],
        },
        diagnostics: [],
      };
      return { ok: true, value: review } as const;
    },
    async getReview(input: VersionGetReviewInput) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          target: 'workbook.version.review',
          reason: `Review record ${input.reviewId} was not found.`,
        },
      } as const;
    },
  };
}

function staleHeadCheckingWorkspaceService(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
): ProposalWorkspaceLifecycleService {
  const base = workspaceLookupService();
  return {
    ...base,
    async commitProposalWorkspace(input) {
      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const graph = await provider.openGraph(namespace);
      const proposalRefName = `refs/heads/${input.proposal.proposalBranchName}`;
      const branch = await graph.readRef(proposalRefName);
      if (branch.status !== 'success' || branch.ref.name === 'HEAD') {
        throw new Error('expected proposal branch ref before workspace commit');
      }
      if (branch.ref.commitId !== input.proposal.baseCommitId) {
        return proposalWorkspaceStaleHeadResult({
          operation: 'commitProposalWorkspace',
          proposalId: input.proposal.id,
          workspaceId: input.workspaceId,
          proposalBranchName: input.proposal.proposalBranchName,
          expectedWorkspaceHeadId: input.proposal.baseCommitId,
          actualProposalBranchHeadId: branch.ref.commitId,
        });
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
          proposalBranchName: input.proposal.proposalBranchName,
          committedFromHeadId: input.proposal.baseCommitId,
        },
      };
    },
  };
}

async function graphWithRoot() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') throw new Error('expected graph initialize success');
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
  };
}

async function commitRef(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  targetRef: string,
  expectedHeadCommitId: WorkbookCommitId,
): Promise<WorkbookCommitId> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const graph = await provider.openGraph(namespace);
  const ref = await graph.readRef(targetRef);
  if (ref.status !== 'success' || ref.ref.name === 'HEAD') {
    throw new Error(`expected ${targetRef} before workspace stale-head test`);
  }
  const committed = await graph.commit(
    await commitInput(namespace, expectedHeadCommitId, ref.ref.revision, targetRef),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected ${targetRef} move success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit.id;
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
      label: 'proposal-workspace-stale-head',
      sheets: [{ id: 'sheet-1', cells: { A1: 'branch-move' } }],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [
        {
          changeId: 'proposal-workspace-stale-head-change',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 'branch-move' },
        },
      ],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'proposal-workspace-stale-head-segment',
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
