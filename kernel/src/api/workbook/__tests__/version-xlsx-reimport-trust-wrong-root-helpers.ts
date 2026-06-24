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
} from '../../../document/version-store/graph';
import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type { VersionSemanticStateReaderPort } from '../../../document/version-store/semantic-state-reader';
import {
  buildXlsxVersionImportRootWrite,
  XLSX_IMPORT_ROOT_GRAPH_ID,
  type XlsxVersionImportRootProvenance,
} from '../../../document/version-store/xlsx-import-root';

export const CREATED_AT = '2026-06-23T00:00:00.000Z';
export const SIDE_CAR_PART = 'customXml/mog-version-metadata.xml';
export const WRONG_ROOT_REF_REVISION = {
  kind: 'opaque',
  value: 'vc10-xlsx-reimport-wrong-root-ref-revision',
} as const;

export function trustedWrongRootProvenance(
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
    stateDigest: {
      algorithm: 'sha256',
      value: seed.repeat(64).slice(0, 64),
    },
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

export async function initializeImportRoot(
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

export async function readCommit(
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
