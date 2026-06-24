import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  ACCEPTED_COMMIT_ID,
  ACTOR,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  createReadyProposal,
} from './proposal-store-test-utils';

export function registerProposalTerminalStateTests(): void {
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

  it('blocks lifecycle mutations after a proposal is superseded', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: new InMemoryVersionDocumentProviderBackend(),
      durability: 'snapshot-test-double',
    });
    const store = await provider.openAgentProposalMetadataStore();
    const ready = await createReadyProposal(store, 'terminal-superseded');

    const superseded = await store.updateProposal({
      clientRequestId: 'supersede-terminal',
      proposalId: ready.id,
      expectedRevision: ready.revision,
      status: 'superseded',
      trustedActor: ACTOR,
      reason: 'replacement proposal created',
    });
    expect(superseded).toMatchObject({
      ok: true,
      value: { status: 'superseded', revision: ready.revision + 1 },
    });
    if (!superseded.ok) throw new Error(`expected supersede success: ${superseded.error.code}`);

    await expect(
      store.updateProposal({
        clientRequestId: 'apply-after-superseded',
        proposalId: superseded.value.id,
        expectedRevision: superseded.value.revision,
        status: 'applied',
        trustedActor: ACTOR,
        accepted: {
          targetRef: 'refs/heads/main',
          expectedTargetHeadId: HEAD_COMMIT_ID,
          appliedCommitId: ACCEPTED_COMMIT_ID,
          refUpdateReceiptId: 'receipt-after-superseded',
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'proposal_status_transition', allowed: [] },
    });
    await expect(store.getProposal(superseded.value.id)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'superseded',
        revision: superseded.value.revision,
        supersedeReason: 'replacement proposal created',
      },
    });
  });
}
