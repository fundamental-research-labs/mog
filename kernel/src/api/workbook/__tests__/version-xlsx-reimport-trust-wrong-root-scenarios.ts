import { expect, it } from '@jest/globals';

import {
  createInMemoryVersionGraphStore,
  VERSION_GRAPH_MAIN_REF,
} from '../../../document/version-store/graph';
import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  initializeImportRoot,
  readCommit,
  semanticState,
  semanticStateReader,
  SIDE_CAR_PART,
  snapshotPort,
  testNamespace,
  trustedWrongRootProvenance,
  WRONG_ROOT_REF_REVISION,
} from './version-xlsx-reimport-trust-wrong-root-helpers';

export function registerWrongRootTrustDenialScenarios(): void {
  it('denies same-document metadata when the candidate root is off the visible head', async () => {
    const namespace = testNamespace('vc10-xlsx-reimport-wrong-root');
    const graph = createInMemoryVersionGraphStore({ namespace });
    const mainState = semanticState('main-root', 'a');
    const wrongRootState = semanticState('wrong-root', 'b');
    const externalState = semanticState('wrong-root-external-edit', 'c');

    const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, mainState);
    const wrongRootResult = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x21),
      semanticStateReader: semanticStateReader(wrongRootState, mainState),
      provenance: {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 512 },
        diagnostics: [],
        versionMetadataTrust: {
          status: 'absent',
          sidecarPart: SIDE_CAR_PART,
        },
      },
      createdAt: CREATED_AT,
    });
    expect(wrongRootResult).toMatchObject({ status: 'committed' });
    if (wrongRootResult.status !== 'committed') {
      throw new Error(`expected wrong-root seed commit, got ${wrongRootResult.status}`);
    }

    const wrongRootCommit = await readCommit(graph, wrongRootResult.commitId);
    expect(wrongRootCommit.payload.parentCommitIds).toEqual([]);

    const reader = semanticStateReader(externalState, wrongRootState);
    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x31),
      semanticStateReader: reader,
      provenance: trustedWrongRootProvenance(namespace.documentId, wrongRootCommit),
      createdAt: CREATED_AT,
    });

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected wrong-root fallback commit, got ${result.status}`);
    }
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: baseCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches`);
    expect(
      branches.branches.filter((branch) => /^import\/external-change\//.test(branch.name)),
    ).toHaveLength(0);
    expect(
      branches.branches.filter((branch) => /^import\/new-root\//.test(branch.name)),
    ).toHaveLength(2);

    const reimportRoot = await readCommit(graph, result.commitId);
    expect(reimportRoot.id).not.toBe(baseCommit.id);
    expect(reimportRoot.id).not.toBe(wrongRootCommit.id);
    expect(reimportRoot.payload.parentCommitIds).toEqual([]);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: reimportRoot.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: 'head-unverified',
          redacted: true,
        },
      },
      semanticState: externalState,
    });
    const serializedPayload = JSON.stringify(semanticRecord.preimage.payload);
    expect(serializedPayload).not.toContain(wrongRootCommit.id);
    expect(serializedPayload).not.toContain(WRONG_ROOT_REF_REVISION.value);
    expect(baseHead.head.id).toBe(baseCommit.id);
  });
}
