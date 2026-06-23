import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { ACTOR, DOCUMENT_SCOPE, createReadyProposal } from './proposal-store-test-utils';

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
}
