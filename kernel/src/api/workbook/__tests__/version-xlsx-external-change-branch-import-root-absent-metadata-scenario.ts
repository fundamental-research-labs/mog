import { expect, it } from '@jest/globals';

import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  absentMetadataProvenance,
  CREATED_AT,
  initializeExistingGraphFixture,
  semanticState,
  semanticStateReader,
  snapshotPort,
} from './version-xlsx-external-change-branch-test-utils';
import {
  expectCommittedImportRootResult,
  expectMainHeadPreserved,
  expectOnlyImportNewRootBranchTargets,
  readImportRootCommitAndSemanticPayload,
} from './version-xlsx-external-change-branch-import-root-helpers';

export function registerAbsentMetadataImportRootScenario() {
  it('routes absent metadata on an existing graph to a zero-parent import-root branch', async () => {
    const baseState = semanticState('base', 'a');
    const localState = semanticState('local-main', 'b');
    const importedState = semanticState('missing-metadata-import', 'c');
    const { namespace, graph, baseCommit, localCommit } = await initializeExistingGraphFixture({
      documentId: 'vc10-xlsx-absent-metadata-new-root',
      baseState,
      localState,
      localLabel: 'local-main',
    });
    const reader = semanticStateReader(importedState, baseState);

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x01),
      semanticStateReader: reader,
      provenance: absentMetadataProvenance(512),
      createdAt: CREATED_AT,
    });

    expectCommittedImportRootResult(result, 'import-root branch commit');
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    await expectMainHeadPreserved({ graph, localCommitId: localCommit.id });

    await expectOnlyImportNewRootBranchTargets({ graph, commitId: result.commitId });

    const { rootCommit, semanticPayload } = await readImportRootCommitAndSemanticPayload({
      graph,
      commitId: result.commitId,
      readableDescription: 'root commit',
    });
    expect(rootCommit.payload.parentCommitIds).toEqual([]);
    expect(rootCommit.payload.parentCommitIds).not.toEqual([baseCommit.id]);
    expect(rootCommit.payload.author).toMatchObject({
      authorId: 'mog.xlsx-import',
      displayName: 'Mog XLSX Import',
    });

    expect(semanticPayload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'absent',
        },
      },
      semanticState: importedState,
    });
  });
}
