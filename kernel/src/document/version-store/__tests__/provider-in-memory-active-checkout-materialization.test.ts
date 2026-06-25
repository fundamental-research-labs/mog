import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  versionDocumentScopeKey,
} from '../provider';
import type {
  ActiveCheckoutMaterializationMemoryBackendSnapshot,
  ActiveCheckoutMaterializationRecord,
} from '../active-checkout-materialization-store';
import { DOCUMENT_SCOPE, OTHER_DOCUMENT_SCOPE } from './provider-test-utils';

const ORIGINAL_COMMIT = `commit:sha256:${'1'.repeat(64)}`;
const MUTATED_COMMIT = `commit:sha256:${'2'.repeat(64)}`;

describe('InMemoryVersionStoreProvider active checkout materialization snapshots', () => {
  it('records active checkout materialization across close/reopen without mutable reference leaks', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const store = await provider.openActiveCheckoutMaterializationStore();
    const writeInput = {
      checkedOutCommitId: ORIGINAL_COMMIT,
      branchName: 'main',
      refHeadAtMaterialization: ORIGINAL_COMMIT,
      updatedAt: '2026-06-24T00:00:00.000Z',
    };

    await store.write(writeInput);
    writeInput.checkedOutCommitId = MUTATED_COMMIT;
    writeInput.branchName = 'mutated-after-write';

    const written = await store.read();
    expect(written).toEqual({
      documentScopeKey: versionDocumentScopeKey(DOCUMENT_SCOPE),
      checkedOutCommitId: ORIGINAL_COMMIT,
      branchName: 'main',
      refHeadAtMaterialization: ORIGINAL_COMMIT,
      updatedAt: '2026-06-24T00:00:00.000Z',
    });
    expect(Object.isFrozen(written)).toBe(true);

    if (!written) throw new Error('expected active checkout materialization');
    mutateRecordUnchecked(written, { checkedOutCommitId: MUTATED_COMMIT });
    await expect(store.read()).resolves.toMatchObject({
      checkedOutCommitId: ORIGINAL_COMMIT,
      branchName: 'main',
    });

    await provider.close('workbook-close');
    const snapshot = await backend.exportSnapshot();
    expect(snapshot.activeCheckoutMaterializations).toHaveLength(1);
    const snapshotRecord = snapshot.activeCheckoutMaterializations?.[0] ?? null;
    expect(Object.isFrozen(snapshot.activeCheckoutMaterializations)).toBe(true);
    expect(Object.isFrozen(snapshotRecord)).toBe(true);
    if (!snapshotRecord) throw new Error('expected snapshot materialization record');

    const snapshotForReload: ActiveCheckoutMaterializationMemoryBackendSnapshot = [
      { ...snapshotRecord },
    ];
    const snapshotReloadRecord = snapshotForReload[0];
    if (!snapshotReloadRecord) throw new Error('expected reload snapshot materialization record');
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot({
      ...snapshot,
      activeCheckoutMaterializations: snapshotForReload,
    });
    mutateRecordUnchecked(snapshotReloadRecord, {
      checkedOutCommitId: MUTATED_COMMIT,
      branchName: 'mutated-after-reload',
    });

    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    const reloadedStore = await reloadedProvider.openActiveCheckoutMaterializationStore();
    await expect(reloadedStore.read()).resolves.toMatchObject({
      checkedOutCommitId: ORIGINAL_COMMIT,
      branchName: 'main',
      refHeadAtMaterialization: ORIGINAL_COMMIT,
    });

    const isolatedProvider = createInMemoryVersionStoreProvider({
      documentScope: OTHER_DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    await expect(
      (await isolatedProvider.openActiveCheckoutMaterializationStore()).read(),
    ).resolves.toBeNull();
  });
});

function mutateRecordUnchecked(
  record: ActiveCheckoutMaterializationRecord,
  patch: Partial<ActiveCheckoutMaterializationRecord>,
): void {
  try {
    Object.assign(record as unknown as Record<string, unknown>, patch);
  } catch {
    // Frozen clones may throw in strict runtimes; either way, they must not mutate backend state.
  }
}
