import type { AgentProposalWorkspaceHandle } from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
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
