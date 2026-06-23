import { expect, jest } from '@jest/globals';

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
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
} from '../../../document/version-store/object-store';
import { captureWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import type { VersionSemanticStateReaderPort } from '../../../document/version-store/semantic-state-reader';
import {
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
  type XlsxVersionImportRootProvenance,
} from '../../../document/version-store/xlsx-import-root';

export const CREATED_AT = '2026-06-23T00:00:00.000Z';
export const SIDE_CAR_PART = 'customXml/mog-version-metadata.xml';

const TEST_AUTHOR = {
  authorId: 'test.local-edit',
  actorKind: 'user' as const,
  displayName: 'Local Edit',
};

export type XlsxExternalChangeBranchGraph = ReturnType<typeof createInMemoryVersionGraphStore>;

export function testNamespace(documentId: string): VersionGraphNamespace {
  return { documentId, graphId: XLSX_IMPORT_ROOT_GRAPH_ID };
}

export function semanticState(label: string, seed: string): SemanticWorkbookStateEnvelope {
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

export function semanticStateReader(
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

export function snapshotPort(seed: number) {
  return {
    encodeDiff: jest.fn().mockResolvedValue(new Uint8Array([seed, seed + 1, seed + 2])),
  };
}

export async function initializeExistingGraphFixture(input: {
  readonly documentId: string;
  readonly baseState: SemanticWorkbookStateEnvelope;
  readonly localState: SemanticWorkbookStateEnvelope;
  readonly localLabel: string;
}): Promise<{
  readonly namespace: VersionGraphNamespace;
  readonly graph: XlsxExternalChangeBranchGraph;
  readonly baseState: SemanticWorkbookStateEnvelope;
  readonly localState: SemanticWorkbookStateEnvelope;
  readonly baseCommit: WorkbookCommit;
  readonly baseHead: {
    readonly head: VersionGraphCommitRef;
    readonly main: VersionGraphRef;
  };
  readonly localCommit: WorkbookCommit;
}> {
  const namespace = testNamespace(input.documentId);
  const graph = createInMemoryVersionGraphStore({ namespace });
  const { baseCommit, baseHead } = await initializeImportRoot(graph, namespace, input.baseState);
  const localCommit = await commitMain({
    graph,
    namespace,
    head: baseHead,
    state: input.localState,
    label: input.localLabel,
  });

  return {
    namespace,
    graph,
    baseState: input.baseState,
    localState: input.localState,
    baseCommit,
    baseHead,
    localCommit,
  };
}

export async function initializeImportRoot(
  graph: XlsxExternalChangeBranchGraph,
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
    provenance: absentMetadataProvenance(128),
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

export async function commitMain(input: {
  readonly graph: XlsxExternalChangeBranchGraph;
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

export function absentMetadataProvenance(byteLength: number): XlsxVersionImportRootProvenance {
  return {
    kind: 'xlsx',
    source: { sourceType: 'bytes', byteLength },
    diagnostics: [],
    versionMetadataTrust: {
      status: 'absent',
      sidecarPart: SIDE_CAR_PART,
    },
  };
}

export function trustedProvenance(
  documentId: string,
  baseCommit: WorkbookCommit,
  exportedHead?: VersionGraphCommitRef,
  options?: {
    readonly trustStatus?: 'trusted' | 'trusted-stale-base';
    readonly diagnostics?: XlsxVersionImportRootProvenance['diagnostics'];
    readonly semanticChangeSetDigest?: ObjectDigest;
    readonly snapshotRootDigest?: ObjectDigest;
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
        semanticChangeSetDigest:
          options?.semanticChangeSetDigest ?? baseCommit.payload.semanticChangeSetDigest,
        snapshotRootDigest: options?.snapshotRootDigest ?? baseCommit.payload.snapshotRootDigest,
      },
    },
  };
}

export function staleTrustedBaseDiagnostic(): XlsxVersionImportRootProvenance['diagnostics'][number] {
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

export async function findOnlyImportExternalChangeBranch(graph: XlsxExternalChangeBranchGraph) {
  return findOnlyImportBranch(graph, /^import\/external-change\//);
}

export async function findOnlyImportNewRootBranch(graph: XlsxExternalChangeBranchGraph) {
  return findOnlyImportBranch(graph, /^import\/new-root\//);
}

export function objectDigest(seed: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    digest: seed.repeat(64).slice(0, 64),
  };
}

async function findOnlyImportBranch(
  graph: XlsxExternalChangeBranchGraph,
  branchNamePattern: RegExp,
) {
  const branches = await graph.listBranches({ prefix: 'import' });
  expect(branches.ok).toBe(true);
  if (!branches.ok) throw new Error(`expected branch list success: ${branches.error.code}`);
  const matchingBranches = branches.branches.filter((branch) =>
    branchNamePattern.test(branch.name),
  );
  expect(matchingBranches).toHaveLength(1);
  const branch = matchingBranches[0];
  if (!branch) throw new Error('expected import branch');
  expect(branch.name).toMatch(branchNamePattern);
  return branch;
}

function semanticDigest(seed: string): SemanticWorkbookStateEnvelope['stateDigest'] {
  return {
    algorithm: 'sha256',
    value: seed.repeat(64).slice(0, 64),
  };
}
