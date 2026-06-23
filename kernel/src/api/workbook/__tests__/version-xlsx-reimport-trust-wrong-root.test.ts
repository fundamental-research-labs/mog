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
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type { VersionSemanticStateReaderPort } from '../../../document/version-store/semantic-state-reader';
import {
  applyXlsxVersionImportChangeToExistingGraph,
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
  type XlsxVersionImportRootProvenance,
} from '../../../document/version-store/xlsx-import-root';

const CREATED_AT = '2026-06-23T00:00:00.000Z';
const SIDE_CAR_PART = 'customXml/mog-version-metadata.xml';
const WRONG_ROOT_REF_REVISION = {
  kind: 'opaque',
  value: 'vc10-xlsx-reimport-wrong-root-ref-revision',
} as const;

describe('VC-10 XLSX reimport wrong-root trust denial', () => {
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
});

function trustedWrongRootProvenance(
  documentId: string,
  commit: WorkbookCommit,
): XlsxVersionImportRootProvenance {
  return {
    kind: 'xlsx',
    source: { sourceType: 'bytes', byteLength: 768 },
    diagnostics: [],
    versionMetadataTrust: {
      status: 'trusted-stale-base',
      sidecarPart: SIDE_CAR_PART,
      redacted: true,
    },
    versionMetadataHeadCandidate: {
      documentId,
      head: {
        commitId: commit.id,
        refName: VERSION_GRAPH_MAIN_REF,
        resolvedFrom: VERSION_GRAPH_HEAD_REF,
        refRevision: WRONG_ROOT_REF_REVISION,
        semanticChangeSetDigest: commit.payload.semanticChangeSetDigest,
        snapshotRootDigest: commit.payload.snapshotRootDigest,
      },
    },
  };
}

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
    stateDigest: {
      algorithm: 'sha256',
      value: seed.repeat(64).slice(0, 64),
    },
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
    throw new Error(`expected initialized graph: ${initialized.diagnostics[0]?.code}`);
  }
  const head = await graph.readHead();
  expect(head.status).toBe('success');
  if (head.status !== 'success') throw new Error('expected readable head');
  return { baseCommit: initialized.commit, baseHead: head };
}

async function readCommit(
  graph: ReturnType<typeof createInMemoryVersionGraphStore>,
  commitId: WorkbookCommitId,
): Promise<WorkbookCommit> {
  const read = await graph.readCommit(commitId);
  expect(read.status).toBe('success');
  if (read.status !== 'success') {
    throw new Error(`expected commit ${commitId}: ${read.diagnostics[0]?.code}`);
  }
  return read.commit;
}
