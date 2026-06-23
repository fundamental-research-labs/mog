import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph-store';
import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  absentMetadataProvenance,
  CREATED_AT,
  findOnlyImportNewRootBranch,
  initializeExistingGraphFixture,
  objectDigest,
  semanticState,
  semanticStateReader,
  SIDE_CAR_PART,
  snapshotPort,
  staleTrustedBaseDiagnostic,
  trustedProvenance,
} from './version-xlsx-external-change-branch-test-utils';

describe('VC-10 XLSX external-change branch routing: import-root fallbacks', () => {
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

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected import-root branch commit, got ${result.status}`);
    }
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branch = await findOnlyImportNewRootBranch(graph);
    expect(branch.ref.targetCommitId).toBe(result.commitId);

    const rootCommit = await graph.readCommit(result.commitId);
    expect(rootCommit.status).toBe('success');
    if (rootCommit.status !== 'success') {
      throw new Error(`expected root commit readable: ${rootCommit.diagnostics[0]?.code}`);
    }
    expect(rootCommit.commit.payload.parentCommitIds).toEqual([]);
    expect(rootCommit.commit.payload.parentCommitIds).not.toEqual([baseCommit.id]);
    expect(rootCommit.commit.payload.author).toMatchObject({
      authorId: 'mog.xlsx-import',
      displayName: 'Mog XLSX Import',
    });

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: rootCommit.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'absent',
        },
      },
      semanticState: importedState,
    });
  });

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

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected missing-base import root, got ${result.status}`);
    }
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });
    const branch = await findOnlyImportNewRootBranch(graph);
    expect(branch.ref.targetCommitId).toBe(result.commitId);

    const rootCommit = await graph.readCommit(result.commitId);
    expect(rootCommit.status).toBe('success');
    if (rootCommit.status !== 'success') {
      throw new Error(`expected missing-base root readable: ${rootCommit.diagnostics[0]?.code}`);
    }
    expect(rootCommit.commit.payload.parentCommitIds).toEqual([]);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: rootCommit.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
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
    const serializedPayload = JSON.stringify(semanticRecord.preimage.payload);
    expect(serializedPayload).not.toContain(missingCommitId);
    expect(serializedPayload).not.toContain(namespace.documentId);
  });

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

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected digest-mismatch import root, got ${result.status}`);
    }
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branch = await findOnlyImportNewRootBranch(graph);
    expect(branch.ref.targetCommitId).toBe(result.commitId);
    expect(branch.ref.targetCommitId).not.toBe(baseCommit.id);

    const rootCommit = await graph.readCommit(result.commitId);
    expect(rootCommit.status).toBe('success');
    if (rootCommit.status !== 'success') {
      throw new Error(`expected digest-mismatch root readable: ${rootCommit.diagnostics[0]?.code}`);
    }
    expect(rootCommit.commit.payload.parentCommitIds).toEqual([]);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: rootCommit.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
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

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected untrusted candidate import root, got ${result.status}`);
    }
    expect(reader.readCurrentSemanticState).toHaveBeenCalledTimes(1);
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branch = await findOnlyImportNewRootBranch(graph);
    expect(branch.ref.targetCommitId).toBe(result.commitId);
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true });
    if (!branches.ok) throw new Error(`expected import branches`);
    expect(
      branches.branches.filter((candidateBranch) =>
        /^import\/external-change\//.test(candidateBranch.name),
      ),
    ).toHaveLength(0);
  });

  it('downgrades a trusted summary without a head candidate to missing-head', async () => {
    const baseState = semanticState('base', 'm');
    const localState = semanticState('local-main', 'n');
    const importedState = semanticState('trusted-missing-candidate', 'o');
    const { namespace, graph } = await initializeExistingGraphFixture({
      documentId: 'vc10-xlsx-trusted-missing-candidate',
      baseState,
      localState,
      localLabel: 'local-main',
    });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x44),
      semanticStateReader: semanticStateReader(importedState, baseState),
      provenance: {
        kind: 'xlsx',
        source: { sourceType: 'bytes', byteLength: 640 },
        diagnostics: [staleTrustedBaseDiagnostic()],
        versionMetadataTrust: {
          status: 'trusted',
          sidecarPart: SIDE_CAR_PART,
          redacted: true,
        },
      },
      createdAt: CREATED_AT,
    });

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected missing-candidate import root, got ${result.status}`);
    }

    const rootCommit = await graph.readCommit(result.commitId);
    expect(rootCommit.status).toBe('success');
    if (rootCommit.status !== 'success') {
      throw new Error(`expected missing-candidate root readable`);
    }
    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: rootCommit.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
      source: {
        kind: 'xlsxImportRoot',
        versionMetadataTrust: {
          status: 'untrusted',
          reason: 'missing-head',
          redacted: true,
        },
      },
      importDiagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'missing-head',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
    });
    expect(JSON.stringify(semanticRecord.preimage.payload)).not.toContain('trusted-stale-base');
  });
});
