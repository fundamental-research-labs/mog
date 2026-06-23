import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import {
  DOCUMENT_SCOPE,
  OTHER_DOCUMENT_SCOPE,
  createProposalInput,
  expectCreate,
} from './proposal-store-test-utils';

export function registerProposalListingTests(): void {
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
}
