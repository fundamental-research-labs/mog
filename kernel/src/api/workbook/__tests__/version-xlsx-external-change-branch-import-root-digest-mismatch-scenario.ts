import { expect, it } from '@jest/globals';

import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  initializeExistingGraphFixture,
  objectDigest,
  semanticState,
  semanticStateReader,
  snapshotPort,
  trustedProvenance,
} from './version-xlsx-external-change-branch-test-utils';
import {
  expectCommittedImportRootResult,
  expectMainHeadPreserved,
  expectOnlyImportNewRootBranchTargets,
  readImportRootCommitAndSemanticPayload,
} from './version-xlsx-external-change-branch-import-root-helpers';

export function registerDigestMismatchImportRootScenario() {
  it('does not attach same-document metadata by commit id when object digests do not match', async () => {
    const baseState = semanticState('base', 'd');
    const localState = semanticState('local-main', 'e');
    const externalState = semanticState('forged-external-edit', 'f');
    const { namespace, graph, baseCommit, baseHead, localCommit } =
      await initializeExistingGraphFixture({
        documentId: 'vc10-xlsx-digest-mismatch-new-root',
        baseState,
        localState,
        localLabel: 'local-main',
      });
    const reader = semanticStateReader(externalState, baseState);

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x42),
      semanticStateReader: reader,
      provenance: trustedProvenance(namespace.documentId, baseCommit, baseHead.head, {
        semanticChangeSetDigest: objectDigest('f'),
      }),
      createdAt: CREATED_AT,
    });

    expectCommittedImportRootResult(result, 'digest-mismatch import root');
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    await expectMainHeadPreserved({ graph, localCommitId: localCommit.id });

    const branch = await expectOnlyImportNewRootBranchTargets({ graph, commitId: result.commitId });
    expect(branch.ref.targetCommitId).not.toBe(baseCommit.id);

    const { rootCommit, semanticPayload } = await readImportRootCommitAndSemanticPayload({
      graph,
      commitId: result.commitId,
      readableDescription: 'digest-mismatch root',
    });
    expect(rootCommit.payload.parentCommitIds).toEqual([]);

    expect(semanticPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: 'object-digest-mismatch',
          redacted: true,
        },
      },
      importDiagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'object-digest-mismatch',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
      semanticState: externalState,
    });
  });
}
