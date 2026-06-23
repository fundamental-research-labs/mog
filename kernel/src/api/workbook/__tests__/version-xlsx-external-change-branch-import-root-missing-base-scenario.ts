import { expect, it } from '@jest/globals';

import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  initializeExistingGraphFixture,
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

export function registerMissingTrustedBaseImportRootScenario() {
  it('routes a missing trusted base to a redacted import-root branch', async () => {
    const baseState = semanticState('base', '4');
    const localState = semanticState('local-main', '5');
    const externalState = semanticState('external-edit', '6');
    const { namespace, graph, baseCommit, localCommit } = await initializeExistingGraphFixture({
      documentId: 'vc10-xlsx-missing-external-base',
      baseState,
      localState,
      localLabel: 'local-main',
    });
    const missingCommitId = `commit:sha256:${'f'.repeat(64)}` as WorkbookCommitId;
    const reader = semanticStateReader(externalState, baseState);

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x41),
      semanticStateReader: reader,
      provenance: trustedProvenance(namespace.documentId, {
        ...baseCommit,
        id: missingCommitId,
      }),
      createdAt: CREATED_AT,
    });

    expectCommittedImportRootResult(result, 'missing-base import root');
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    await expectMainHeadPreserved({ graph, localCommitId: localCommit.id });
    await expectOnlyImportNewRootBranchTargets({ graph, commitId: result.commitId });

    const { rootCommit, semanticPayload } = await readImportRootCommitAndSemanticPayload({
      graph,
      commitId: result.commitId,
      readableDescription: 'missing-base root',
    });
    expect(rootCommit.payload.parentCommitIds).toEqual([]);

    expect(semanticPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: 'commit-missing',
          redacted: true,
        },
      },
      importDiagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'commit-missing',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
      semanticState: externalState,
    });
    const serializedPayload = JSON.stringify(semanticPayload);
    expect(serializedPayload).not.toContain(missingCommitId);
    expect(serializedPayload).not.toContain(namespace.documentId);
  });
}
