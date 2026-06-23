import type { AgentProposalWorkspaceHandle } from '@mog-sdk/contracts/api';
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

    await expect(
      version.commitProposalWorkspace({
        clientRequestId: 'workspace-commit-stale-head',
        proposalId: opened.proposalId,
        workspaceId: opened.workspaceId,
        expectedRevision: 2,
        actor: ACTOR,
        message: 'Stale workspace commit',
      }),
    ).resolves.toMatchObject({
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
              proposalBranchName: opened.proposalBranchName,
              expectedWorkspaceHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ],
      },
    });
    await expect(version.getProposal({ proposalId: opened.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });
});

function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider, proposalWorkspaceService });
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
