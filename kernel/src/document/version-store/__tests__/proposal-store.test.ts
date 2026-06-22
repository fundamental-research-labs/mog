import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../provider';
import type {
  AgentProposalMetadataStore,
  AgentProposalRecord,
  CreateAgentProposalStoreInput,
} from '../proposal-store';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const OTHER_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-2',
  principalScope: 'principal-1',
};
const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
const PROPOSAL_COMMIT_ID = `commit:sha256:${'3'.repeat(64)}` as const;
const ACCEPTED_COMMIT_ID = `commit:sha256:${'4'.repeat(64)}` as const;
const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;
const PASSED_VERIFICATION = {
  status: 'passed',
  checks: [
    {
      name: 'proposal-tests',
      status: 'passed',
      diagnostics: [],
    },
  ],
  createdAt: '2026-06-22T00:10:00.000Z',
} as const;

describe('AgentProposalMetadataStore', () => {
  it('persists proposal lifecycle mutations with idempotency and CAS checks', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAgentProposalMetadataStore();
    const createInput = createProposalInput('create-1');

    const created = await store.createProposal(createInput);
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: expect.stringMatching(/^proposal:sha256:[0-9a-f]{64}$/),
        documentId: DOCUMENT_SCOPE.documentId,
        status: 'draft',
        revision: 1,
        targetRef: 'refs/heads/main',
        baseCommitId: BASE_COMMIT_ID,
        proposalBranchName: 'agent/agent-run-1/proposal-1',
        agentRunId: 'agent-run-1',
      },
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const proposalId = created.value.id;

    await expect(store.createProposal(createInput)).resolves.toEqual(created);
    await expect(
      store.createProposal({ ...createInput, title: 'Different title' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_client_request_reused' },
    });

    const workspace = await store.updateProposal({
      clientRequestId: 'workspace-1',
      proposalId,
      expectedRevision: 1,
      status: 'workspace_open',
      trustedActor: ACTOR,
      workspaceId: 'workspace-session-1',
      updatedAt: '2026-06-22T00:01:00.000Z',
    });
    expect(workspace).toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2, workspaceId: 'workspace-session-1' },
    });
    await expect(store.getProposalByWorkspaceId('workspace-session-1')).resolves.toEqual(workspace);
    await expect(store.getProposalByWorkspaceId('missing-workspace')).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', target: 'workbook.version.proposal' },
    });
    await expect(
      store.updateProposal({
        clientRequestId: 'workspace-1',
        proposalId,
        expectedRevision: 1,
        status: 'workspace_open',
        trustedActor: ACTOR,
        workspaceId: 'workspace-session-1',
        updatedAt: '2026-06-22T00:01:00.000Z',
      }),
    ).resolves.toEqual(workspace);
    await expect(
      store.updateProposal({
        clientRequestId: 'workspace-1',
        proposalId,
        expectedRevision: 2,
        status: 'workspace_open',
        trustedActor: ACTOR,
        workspaceId: 'different-workspace',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_client_request_reused' },
    });
    await expect(
      store.updateProposal({
        clientRequestId: 'commit-stale',
        proposalId,
        expectedRevision: 1,
        status: 'committed',
        trustedActor: ACTOR,
        proposalCommitId: PROPOSAL_COMMIT_ID,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale_revision', expectedRevision: 1, actualRevision: 2 },
    });
    await expect(
      store.updateProposal({
        clientRequestId: 'commit-missing',
        proposalId,
        expectedRevision: 2,
        status: 'committed',
        trustedActor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_commit_required' },
    });

    const committed = await store.updateProposal({
      clientRequestId: 'commit-1',
      proposalId,
      expectedRevision: 2,
      status: 'committed',
      trustedActor: ACTOR,
      proposalCommitId: PROPOSAL_COMMIT_ID,
      updatedAt: '2026-06-22T00:02:00.000Z',
    });
    expect(committed).toMatchObject({
      ok: true,
      value: { status: 'committed', revision: 3, proposalCommitId: PROPOSAL_COMMIT_ID },
    });
    await expect(
      store.updateProposal({
        clientRequestId: 'verify-failed-input',
        proposalId,
        expectedRevision: 3,
        status: 'verified',
        trustedActor: ACTOR,
        verification: { ...PASSED_VERIFICATION, status: 'failed' },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_verification_required' },
    });

    const verified = await store.updateProposal({
      clientRequestId: 'verify-1',
      proposalId,
      expectedRevision: 3,
      status: 'verified',
      trustedActor: ACTOR,
      verification: PASSED_VERIFICATION,
      updatedAt: '2026-06-22T00:03:00.000Z',
    });
    expect(verified).toMatchObject({
      ok: true,
      value: { status: 'verified', revision: 4, verification: PASSED_VERIFICATION },
    });

    await expect(
      store.updateProposal({
        clientRequestId: 'ready-missing-review',
        proposalId,
        expectedRevision: 4,
        status: 'ready_for_review',
        trustedActor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_review_required' },
    });

    const ready = await store.updateProposal({
      clientRequestId: 'ready-1',
      proposalId,
      expectedRevision: 4,
      status: 'ready_for_review',
      trustedActor: ACTOR,
      reviewId: 'review-1',
      updatedAt: '2026-06-22T00:04:00.000Z',
    });
    expect(ready).toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, reviewId: 'review-1' },
    });

    const applied = await store.updateProposal({
      clientRequestId: 'accept-1',
      proposalId,
      expectedRevision: 5,
      status: 'applied',
      trustedActor: ACTOR,
      accepted: {
        targetRef: 'refs/heads/main',
        expectedTargetHeadId: HEAD_COMMIT_ID,
        appliedCommitId: ACCEPTED_COMMIT_ID,
        refUpdateReceiptId: 'receipt-1',
      },
      updatedAt: '2026-06-22T00:05:00.000Z',
    });
    expect(applied).toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        revision: 6,
        proposalCommitId: PROPOSAL_COMMIT_ID,
        accepted: { appliedCommitId: ACCEPTED_COMMIT_ID },
      },
    });
    await expect(
      store.updateProposal({
        clientRequestId: 'reject-after-accepted',
        proposalId,
        expectedRevision: 6,
        status: 'rejected',
        trustedActor: ACTOR,
        reason: 'too late',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_status_transition' },
    });
  });

  it('lists proposals with filters, paging, document isolation, and snapshot reload', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAgentProposalMetadataStore();
    const first = await expectCreate(
      store.createProposal(
        createProposalInput('create-a', {
          title: 'A',
          proposalBranchName: 'agent/agent-run-1/a',
          createdAt: '2026-06-22T00:01:00.000Z',
        }),
      ),
    );
    const second = await expectCreate(
      store.createProposal(
        createProposalInput('create-b', {
          title: 'B',
          proposalBranchName: 'agent/agent-run-1/b',
          createdAt: '2026-06-22T00:03:00.000Z',
        }),
      ),
    );
    const third = await expectCreate(
      store.createProposal(
        createProposalInput('create-c', {
          title: 'C',
          proposalBranchName: 'agent/agent-run-1/c',
          createdAt: '2026-06-22T00:02:00.000Z',
        }),
      ),
    );

    await expect(store.listProposals({ limit: 2 })).resolves.toMatchObject({
      ok: true,
      value: {
        items: [{ id: second.id }, { id: third.id }],
        limit: 2,
        totalEstimate: 3,
        nextCursor: expect.stringMatching(/^proposal-list:/),
      },
    });
    const page = await store.listProposals({ limit: 2 });
    if (!page.ok || !page.value.nextCursor) throw new Error('expected paged proposal list');
    await expect(
      store.listProposals({ cursor: page.value.nextCursor, limit: 2 }),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: first.id }], totalEstimate: 3 },
    });
    await expect(
      store.listProposals({ cursor: 'not-a-proposal-cursor' as any }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'stale_proposal_cursor' },
    });
    await expect(
      store.listProposals({ proposalBranchName: 'agent/agent-run-1/b' }),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: second.id }], totalEstimate: 1 },
    });

    const otherProvider = createInMemoryVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await otherProvider.openAgentProposalMetadataStore()).listProposals(),
    ).resolves.toMatchObject({
      ok: true,
      value: { items: [], totalEstimate: 0 },
    });

    const snapshot = await backend.exportSnapshot();
    const reloaded = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloaded,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await reloadedProvider.openAgentProposalMetadataStore()).getProposal(second.id),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: second.id, title: 'B', proposalBranchName: 'agent/agent-run-1/b' },
    });
  });

  it('projects stale and merge-conflicted proposal terminal states', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAgentProposalMetadataStore();

    const staleReady = await createReadyProposal(store, 'stale');
    const stale = await store.updateProposal({
      clientRequestId: 'stale-status',
      proposalId: staleReady.id,
      expectedRevision: staleReady.revision,
      status: 'stale',
      trustedActor: ACTOR,
      diagnostics: [
        {
          code: 'stale_head',
          severity: 'warning',
          message: 'Target ref moved before proposal acceptance.',
        },
      ],
    });
    expect(stale).toMatchObject({
      ok: true,
      value: { status: 'stale', revision: staleReady.revision + 1 },
    });
    if (!stale.ok) throw new Error(`expected stale success: ${stale.error.code}`);
    await expect(
      store.updateProposal({
        clientRequestId: 'supersede-stale',
        proposalId: stale.value.id,
        expectedRevision: stale.value.revision,
        status: 'superseded',
        trustedActor: ACTOR,
        reason: 'replacement proposal created',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'superseded', supersedeReason: 'replacement proposal created' },
    });

    const conflictedReady = await createReadyProposal(store, 'conflict');
    await expect(
      store.updateProposal({
        clientRequestId: 'conflicted-status',
        proposalId: conflictedReady.id,
        expectedRevision: conflictedReady.revision,
        status: 'merge_conflicted',
        trustedActor: ACTOR,
        diagnostics: [
          {
            code: 'merge_conflicted',
            severity: 'warning',
            message: 'Proposal acceptance requires conflict resolution.',
          },
        ],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: 'merge_conflicted', revision: conflictedReady.revision + 1 },
    });
  });
});

function createProposalInput(
  clientRequestId: string,
  overrides: Partial<CreateAgentProposalStoreInput> = {},
): CreateAgentProposalStoreInput {
  return {
    clientRequestId,
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    proposalBranchName: 'agent/agent-run-1/proposal-1',
    redactionPolicy: REDACTION_POLICY,
    trustedIdentity: {
      actor: ACTOR,
      agent: AGENT,
      agentRunId: 'agent-run-1',
    },
    createdAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

async function expectCreate(
  resultPromise: ReturnType<AgentProposalMetadataStore['createProposal']>,
): Promise<AgentProposalRecord> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected proposal create success: ${result.error.code}`);
  return result.value;
}

async function createReadyProposal(
  store: AgentProposalMetadataStore,
  suffix: string,
): Promise<AgentProposalRecord> {
  const created = await expectCreate(
    store.createProposal(
      createProposalInput(`create-${suffix}`, {
        proposalBranchName: `agent/agent-run-1/${suffix}`,
      }),
    ),
  );
  const workspace = await expectRecord(
    store.updateProposal({
      clientRequestId: `workspace-${suffix}`,
      proposalId: created.id,
      expectedRevision: created.revision,
      status: 'workspace_open',
      trustedActor: ACTOR,
      workspaceId: `workspace-${suffix}`,
    }),
  );
  const committed = await expectRecord(
    store.updateProposal({
      clientRequestId: `commit-${suffix}`,
      proposalId: workspace.id,
      expectedRevision: workspace.revision,
      status: 'committed',
      trustedActor: ACTOR,
      proposalCommitId: PROPOSAL_COMMIT_ID,
    }),
  );
  const verified = await expectRecord(
    store.updateProposal({
      clientRequestId: `verify-${suffix}`,
      proposalId: committed.id,
      expectedRevision: committed.revision,
      status: 'verified',
      trustedActor: ACTOR,
      verification: PASSED_VERIFICATION,
    }),
  );
  return expectRecord(
    store.updateProposal({
      clientRequestId: `ready-${suffix}`,
      proposalId: verified.id,
      expectedRevision: verified.revision,
      status: 'ready_for_review',
      trustedActor: ACTOR,
      reviewId: `review-${suffix}`,
    }),
  );
}

async function expectRecord(
  resultPromise: ReturnType<AgentProposalMetadataStore['updateProposal']>,
): Promise<AgentProposalRecord> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected proposal update success: ${result.error.code}`);
  return result.value;
}
