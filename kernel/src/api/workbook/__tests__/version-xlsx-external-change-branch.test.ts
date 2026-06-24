import { PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY } from '@mog-sdk/contracts/versioning';

import { VERSION_GRAPH_MAIN_REF } from '../../../document/version-store/graph';
import { applyXlsxVersionImportChangeToExistingGraph } from '../../../document/version-store/xlsx-import-root';
import {
  CREATED_AT,
  findOnlyImportExternalChangeBranch,
  initializeExistingGraphFixture,
  semanticState,
  semanticStateReader,
  snapshotPort,
  staleTrustedBaseDiagnostic,
  trustedProvenance,
} from './version-xlsx-external-change-branch-test-utils';

describe('VC-10 XLSX external-change branch routing: trusted base branches', () => {
  it('commits same-document external edits to an import external-change branch from the trusted base', async () => {
    const baseState = semanticState('base', '1');
    const localState = semanticState('local-main', '2');
    const externalState = semanticState('external-edit', '3');
    const { namespace, graph, baseCommit, baseHead, localCommit } =
      await initializeExistingGraphFixture({
        documentId: 'vc10-xlsx-external-change-branch',
        baseState,
        localState,
        localLabel: 'local-main',
      });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x31),
      semanticStateReader: semanticStateReader(externalState, baseState),
      provenance: trustedProvenance(namespace.documentId, baseCommit, baseHead.head),
      createdAt: CREATED_AT,
      historyRootPolicy: PUBLIC_VERSION_DOMAIN_POLICY_REGISTRY.defaultHistoryRootPolicy,
    });

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected external-change commit, got ${result.status}`);
    }

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branch = await findOnlyImportExternalChangeBranch(graph);
    expect(branch.name).toMatch(/^import\/external-change\//);
    expect(branch.ref.targetCommitId).toBe(result.commitId);

    const externalCommit = await graph.readCommit(result.commitId);
    expect(externalCommit.status).toBe('success');
    if (externalCommit.status !== 'success') {
      throw new Error(`expected external commit readable: ${externalCommit.diagnostics[0]?.code}`);
    }
    expect(externalCommit.commit.payload.parentCommitIds).toEqual([baseCommit.id]);
    expect(externalCommit.commit.payload.parentCommitIds).not.toEqual([localCommit.id]);
    expect(externalCommit.commit.payload.author).toMatchObject({
      authorId: 'mog.xlsx-import-change',
      displayName: 'Mog XLSX Import Change',
    });

    const branchPage = await graph.listCommits({ ref: branch.refName });
    expect(branchPage.status).toBe('success');
    if (branchPage.status !== 'success') {
      throw new Error(`expected branch commits readable: ${branchPage.diagnostics[0]?.code}`);
    }
    expect(branchPage.commits.map((commit) => commit.id)).toEqual([result.commitId, baseCommit.id]);

    const mainPage = await graph.listCommits({ ref: VERSION_GRAPH_MAIN_REF });
    expect(mainPage.status).toBe('success');
    if (mainPage.status !== 'success') {
      throw new Error(`expected main commits readable: ${mainPage.diagnostics[0]?.code}`);
    }
    expect(mainPage.commits.map((commit) => commit.id)).toEqual([localCommit.id, baseCommit.id]);
  });

  it('records stale trusted-base diagnostics when routing to an external-change branch', async () => {
    const baseState = semanticState('base', '7');
    const localState = semanticState('local-main', '8');
    const externalState = semanticState('external-edit', '9');
    const { namespace, graph, baseCommit, baseHead, localCommit } =
      await initializeExistingGraphFixture({
        documentId: 'vc10-xlsx-stale-trusted-base-branch',
        baseState,
        localState,
        localLabel: 'local-main',
      });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x51),
      semanticStateReader: semanticStateReader(externalState, baseState),
      provenance: trustedProvenance(namespace.documentId, baseCommit, baseHead.head, {
        trustStatus: 'trusted-stale-base',
        diagnostics: [staleTrustedBaseDiagnostic()],
      }),
      createdAt: CREATED_AT,
    });

    expect(result).toMatchObject({ status: 'committed' });
    if (result.status !== 'committed') {
      throw new Error(`expected stale external-change commit, got ${result.status}`);
    }

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });

    const branch = await findOnlyImportExternalChangeBranch(graph);
    const externalCommit = await graph.readCommit(result.commitId);
    expect(externalCommit.status).toBe('success');
    if (externalCommit.status !== 'success') {
      throw new Error(`expected external commit readable: ${externalCommit.diagnostics[0]?.code}`);
    }
    expect(branch.ref.targetCommitId).toBe(result.commitId);
    expect(externalCommit.commit.payload.parentCommitIds).toEqual([baseCommit.id]);

    const semanticRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: externalCommit.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticRecord.preimage.payload).toMatchObject({
      source: {
        kind: 'xlsxImportChange',
        versionMetadataTrust: {
          status: 'trusted-stale-base',
          redacted: true,
        },
      },
      importDiagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataStale',
          reason: 'trusted-stale-base',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
    });
    const diagnosticsJson = JSON.stringify(
      (semanticRecord.preimage.payload as { importDiagnostics?: unknown }).importDiagnostics,
    );
    expect(diagnosticsJson).not.toContain(baseCommit.id);
    expect(diagnosticsJson).not.toContain(localCommit.id);
    expect(diagnosticsJson).not.toContain(namespace.documentId);
  });
});
