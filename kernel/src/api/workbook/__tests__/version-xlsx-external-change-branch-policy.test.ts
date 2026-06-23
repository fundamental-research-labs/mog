import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  absentMetadataProvenance,
  CREATED_AT,
  initializeExistingGraphFixture,
  semanticState,
  semanticStateReader,
  snapshotPort,
} from './version-xlsx-external-change-branch-test-utils';

describe('VC-10 XLSX external-change branch routing: history root policy', () => {
  it('fails closed with redacted diagnostics when policy rejects existing-no-history roots', async () => {
    const baseState = semanticState('base-policy', 'p');
    const localState = semanticState('local-policy', 'q');
    const importedState = semanticState('import-policy', 'r');
    const { namespace, graph, baseCommit, localCommit } = await initializeExistingGraphFixture({
      documentId: 'vc10-xlsx-policy-existing-no-history-secret',
      baseState,
      localState,
      localLabel: 'local-policy',
    });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x35),
      semanticStateReader: semanticStateReader(importedState, baseState),
      provenance: absentMetadataProvenance(768),
      createdAt: CREATED_AT,
      historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
    });

    expect(result).toEqual({
      status: 'failed',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_HISTORY_ROOT_POLICY_BLOCKED',
          safeMessage: 'Version history root policy rejects roots that would create a history gap.',
          operation: 'commitGraphWrite',
          redacted: true,
          mutationGuarantee: 'no-write-attempted',
          details: expect.objectContaining({
            rootKind: 'existing-no-history',
            reason: 'history-gap-rejected',
            existingVisibleHistory: 'true',
            trustedBase: 'false',
            allowDetachedRoots: false,
            gapPolicy: 'reject',
            redacted: true,
          }),
        }),
      ],
    });

    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain(namespace.documentId);
    expect(serialized).not.toContain(baseCommit.id);
    expect(serialized).not.toContain(localCommit.id);
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branch list: ${branches.error.code}`);
    expect(branches.branches.filter((branch) => /^import\/new-root\//.test(branch.name))).toEqual(
      [],
    );
  });
});
