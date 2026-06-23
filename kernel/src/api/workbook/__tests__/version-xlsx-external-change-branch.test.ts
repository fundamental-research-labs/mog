import { jest } from '@jest/globals';

import type {
  SemanticWorkbookDiff,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import type { WorkbookCommit } from '../../../document/version-store/commit-store';
import {
  createInMemoryVersionGraphStore,
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphCommitRef,
  type VersionGraphRef,
} from '../../../document/version-store/graph-store';
import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
} from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import type { VersionSemanticStateReaderPort } from '../../../document/version-store/semantic-state-reader';
import {
  applyXlsxVersionImportChangeToExistingGraph,
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
  type XlsxVersionImportRootProvenance,
} from '../../../document/version-store/xlsx-import-root';

const CREATED_AT = '2026-06-23T00:00:00.000Z';
const SIDE_CAR_PART = 'customXml/mog-version-metadata.xml';
const TEST_AUTHOR = {
  authorId: 'test.local-edit',
  actorKind: 'user' as const,
  displayName: 'Local Edit',
};

describe('VC-10 XLSX external-change branch routing', () => {
  it('commits same-document external edits to an import external-change branch from the trusted base', async () => {
    const namespace = testNamespace('vc10-xlsx-external-change-branch');
    const graph = createInMemoryVersionGraphStore({ namespace });
    const baseState = semanticState('base', '1');
    const localState = semanticState('local-main', '2');
    const externalState = semanticState('external-edit', '3');

    const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, baseState);
    const localCommit = await commitMain({
      graph,
      namespace,
      head: baseHead,
      state: localState,
      label: 'local-main',
    });

    const result = await applyXlsxVersionImportChangeToExistingGraph({
      namespace,
      graph,
      snapshotRootByteSyncPort: snapshotPort(0x31),
      semanticStateReader: semanticStateReader(externalState, baseState),
      provenance: trustedProvenance(namespace.documentId, baseCommit, baseHead.head),
      createdAt: CREATED_AT,
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

  it('does not attach same-document metadata to an arbitrary lexical commit id', async () => {
    const namespace = testNamespace('vc10-xlsx-missing-external-base');
    const graph = createInMemoryVersionGraphStore({ namespace });
    const baseState = semanticState('base', '4');
    const localState = semanticState('local-main', '5');
    const externalState = semanticState('external-edit', '6');

    const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, baseState);
    const localCommit = await commitMain({
      graph,
      namespace,
      head: baseHead,
      state: localState,
      label: 'local-main',
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

    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_PARENT' })],
    });
    expect(reader.readCurrentSemanticState).not.toHaveBeenCalled();
    expect(reader.diffSemanticStates).not.toHaveBeenCalled();

    const headAfter = await graph.readHead();
    expect(headAfter).toMatchObject({
      status: 'success',
      head: { id: localCommit.id, refName: VERSION_GRAPH_MAIN_REF },
    });
    const branches = await graph.listBranches({ prefix: 'import' });
    expect(branches).toMatchObject({ ok: true, branches: [] });
  });

  it('records stale trusted-base diagnostics when routing to an external-change branch', async () => {
    const namespace = testNamespace('vc10-xlsx-stale-trusted-base-branch');
    const graph = createInMemoryVersionGraphStore({ namespace });
    const baseState = semanticState('base', '7');
    const localState = semanticState('local-main', '8');
    const externalState = semanticState('external-edit', '9');

    const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, baseState);
    const localCommit = await commitMain({
      graph,
      namespace,
      head: baseHead,
      state: localState,
      label: 'local-main',
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

function testNamespace(documentId: string): VersionGraphNamespace {
  return { documentId, graphId: XLSX_IMPORT_ROOT_GRAPH_ID };
}

function semanticState(label: string, seed: string): SemanticWorkbookStateEnvelope {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: label,
      domains: {},
      sheets: {},
    },
    stateDigest: semanticDigest(seed),
  };
}

function semanticStateReader(
  currentState: SemanticWorkbookStateEnvelope,
  baseState: SemanticWorkbookStateEnvelope,
): VersionSemanticStateReaderPort & {
  readonly readCurrentSemanticState: jest.MockedFunction<
    VersionSemanticStateReaderPort['readCurrentSemanticState']
  >;
  readonly diffSemanticStates: jest.MockedFunction<
    VersionSemanticStateReaderPort['diffSemanticStates']
  >;
} {
  return {
    readCurrentSemanticState: jest.fn().mockResolvedValue(currentState),
    diffSemanticStates: jest.fn().mockResolvedValue({
      beforeDigest: baseState.stateDigest,
      afterDigest: currentState.stateDigest,
      changes: [],
      coverage: [],
      diagnostics: [],
    } satisfies SemanticWorkbookDiff),
  };
}

function snapshotPort(seed: number) {
  return {
    encodeDiff: jest.fn().mockResolvedValue(new Uint8Array([seed, seed + 1, seed + 2])),
  };
}

async function initializeImportRoot(
  graph: ReturnType<typeof createInMemoryVersionGraphStore>,
  namespace: VersionGraphNamespace,
  state: SemanticWorkbookStateEnvelope,
): Promise<{
  readonly baseCommit: WorkbookCommit;
  readonly baseHead: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
}> {
  const rootWrite = await buildXlsxVersionImportRootWrite({
    namespace,
    snapshotRootByteSyncPort: snapshotPort(0x11),
    semanticStateReader: semanticStateReader(state, state),
    provenance: {
      kind: 'xlsx',
      source: { sourceType: 'bytes', byteLength: 128 },
      diagnostics: [],
      versionMetadataTrust: {
        status: 'absent',
        sidecarPart: SIDE_CAR_PART,
      },
    },
    createdAt: CREATED_AT,
  });
  const initialized = await graph.initializeGraph(rootWrite);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected graph initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  const head = await graph.readHead();
  expect(head.status).toBe('success');
  if (head.status !== 'success') {
    throw new Error(`expected graph head success: ${head.diagnostics[0]?.code}`);
  }
  const baseCommit = await graph.readCommit(head.head.id);
  expect(baseCommit.status).toBe('success');
  if (baseCommit.status !== 'success') {
    throw new Error(`expected root commit success: ${baseCommit.diagnostics[0]?.code}`);
  }
  return { baseCommit: baseCommit.commit, baseHead: { head: head.head, main: head.main } };
}

async function commitMain(input: {
  readonly graph: ReturnType<typeof createInMemoryVersionGraphStore>;
  readonly namespace: VersionGraphNamespace;
  readonly head: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
  readonly state: SemanticWorkbookStateEnvelope;
  readonly label: string;
}): Promise<WorkbookCommit> {
  const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
    input.namespace,
    snapshotPort(0x21),
  );
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'testLocalCommit',
        label: input.label,
        semanticStateDigest: input.state.stateDigest,
      },
      semanticState: input.state,
      changes: [],
    },
  });
  const committed = await input.graph.commit({
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: TEST_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: input.head.head.id,
    expectedMainRefVersion: input.head.main.revision,
  });
  expect(committed.status).toBe('success');
  if (committed.status !== 'success') {
    throw new Error(`expected local commit success: ${committed.diagnostics[0]?.code}`);
  }
  return committed.commit;
}

function trustedProvenance(
  documentId: string,
  baseCommit: WorkbookCommit,
  exportedHead?: VersionGraphCommitRef,
  options?: {
    readonly trustStatus?: 'trusted' | 'trusted-stale-base';
    readonly diagnostics?: XlsxVersionImportRootProvenance['diagnostics'];
  },
): XlsxVersionImportRootProvenance {
  return {
    kind: 'xlsx',
    source: { sourceType: 'bytes', byteLength: 256 },
    diagnostics: options?.diagnostics ?? [],
    versionMetadataTrust: {
      status: options?.trustStatus ?? 'trusted',
      sidecarPart: SIDE_CAR_PART,
      redacted: true,
    },
    versionMetadataHeadCandidate: {
      documentId,
      head: {
        commitId: baseCommit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: VERSION_GRAPH_HEAD_REF,
        refRevision: exportedHead?.refRevision ?? { kind: 'counter', value: '1' },
        semanticChangeSetDigest: baseCommit.payload.semanticChangeSetDigest,
        snapshotRootDigest: baseCommit.payload.snapshotRootDigest,
      },
    },
  };
}

function staleTrustedBaseDiagnostic(): XlsxVersionImportRootProvenance['diagnostics'][number] {
  return {
    id: 'mog-version-metadata-trusted-stale-base',
    code: 'mogVersionMetadataStale',
    severity: 'warning',
    feature: 'workbook-metadata',
    recoverability: 'mergeRequired',
    message:
      'Mog version metadata sidecar was trusted, but the current head advanced; external edits were routed to an external-change branch.',
    reason: 'trusted-stale-base',
    details: {
      kind: 'mogVersionMetadataTrust',
      reason: 'trusted-stale-base',
      trusted: true,
      staleBase: true,
      branchRouting: 'external-change',
      redacted: true,
    },
    importPhases: ['parser'],
    firstImportPhase: 'parser',
  };
}

async function findOnlyImportExternalChangeBranch(
  graph: ReturnType<typeof createInMemoryVersionGraphStore>,
) {
  const branches = await graph.listBranches({ prefix: 'import' });
  expect(branches.ok).toBe(true);
  if (!branches.ok) throw new Error(`expected branch list success: ${branches.error.code}`);
  expect(branches.branches).toHaveLength(1);
  const branch = branches.branches[0];
  if (!branch) throw new Error('expected external-change branch');
  return branch;
}

function semanticDigest(seed: string): SemanticWorkbookStateEnvelope['stateDigest'] {
  return {
    algorithm: 'sha256',
    value: seed.repeat(64).slice(0, 64),
  };
}
