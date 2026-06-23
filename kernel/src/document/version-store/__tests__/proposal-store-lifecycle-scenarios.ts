import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  ACCEPTED_COMMIT_ID,
  ACTOR,
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  PASSED_VERIFICATION,
  PROPOSAL_COMMIT_ID,
  createProposalInput,
} from './proposal-store-test-utils';

export function registerProposalLifecycleTests(): void {
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
}
