import { expect, it } from '@jest/globals';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  initializeExistingGraphFixture,
  semanticState,
  semanticStateReader,
  SIDE_CAR_PART,
  snapshotPort,
  trustedProvenance,
} from './version-xlsx-external-change-branch-test-utils';
import {
  expectCommittedImportRootResult,
  expectOnlyImportNewRootBranchTargets,
} from './version-xlsx-external-change-branch-import-root-helpers';

export function registerUntrustedCandidateImportRootScenario() {
  it('ignores forged head candidates when the trust summary is untrusted', async () => {
    const baseState = semanticState('base', 'u');
    const localState = semanticState('local-main', 'v');
    const externalState = semanticState('forged-untrusted-candidate', 'w');
    const { namespace, graph, baseCommit, baseHead, localCommit } =
      await initializeExistingGraphFixture({
        documentId: 'vc10-xlsx-untrusted-candidate-new-root',
        baseState,
        localState,
        localLabel: 'local-main',
      });
    const reader = semanticStateReader(externalState, baseState);

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x43),
      semanticStateReader: reader,
      provenance: {
        ...trustedProvenance(namespace.documentId, baseCommit, baseHead.head),
        versionMetadataTrust: {
          status: 'untrusted',
          sidecarPart: SIDE_CAR_PART,
          reason: 'wrong-document',
          redacted: true,
        },
      },
      createdAt: CREATED_AT,
    });

    expectCommittedImportRootResult(result, 'untrusted candidate import root');
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    await expectOnlyImportNewRootBranchTargets({ graph, commitId: result.commitId });
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches`);
    expect(
      branches.branches.filter((candidateBranch) =>
        /^import\/external-change\//.test(candidateBranch.name),
      ),
    ).toHaveLength(0);
  });
}
