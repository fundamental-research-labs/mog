import type { ImportDiagnosticDto } from '@mog-sdk/contracts/data/diagnostics';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { SemanticWorkbookStateEnvelope } from '../../bridges/compute/compute-types.gen';
import type { WorkbookCommit } from './commit-store';
import type {
  CommitVersionGraphInput,
  VersionGraphCommitRef,
} from './graph-store';
import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF } from './graph-store';
import type { WorkbookCommitId } from './object-digest';
import { createVersionObjectRecord, type VersionGraphNamespace } from './object-store';
import {
  mapGraphDiagnostics,
  versionStoreDiagnostic,
  type VersionGraphInitializeInput,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
} from './provider';
import type { VersionRecordRevision } from './registry';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
} from './snapshot-root-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';

export type XlsxVersionImportRootSource =
  | {
      readonly sourceType: 'bytes';
      readonly byteLength: number;
    }
  | {
      readonly sourceType: 'path';
      readonly pathRedacted: true;
    };

export type XlsxVersionImportRootProvenance = {
  readonly kind: 'xlsx';
  readonly source: XlsxVersionImportRootSource;
  readonly diagnostics: readonly ImportDiagnosticDto[];
  readonly versionMetadataTrust?: {
    readonly status: 'absent' | 'trusted' | 'untrusted';
    readonly sidecarPart: string;
    readonly reason?: string;
    readonly redacted?: true;
  };
  /**
   * Internal-only parsed sidecar identity used to verify a same-document reimport
   * against the selected version provider head. This must never be copied into
   * persisted semantic payloads; those payloads only receive redacted trust
   * summaries.
   */
  readonly versionMetadataHeadCandidate?: XlsxVersionMetadataHeadCandidate;
};

export const XLSX_IMPORT_ROOT_GRAPH_ID = 'xlsx-import-root';

const XLSX_IMPORT_ROOT_AUTHOR: VersionAuthor = {
  authorId: 'mog.xlsx-import',
  actorKind: 'system',
  displayName: 'Mog XLSX Import',
};

const XLSX_IMPORT_CHANGE_AUTHOR: VersionAuthor = {
  authorId: 'mog.xlsx-import-change',
  actorKind: 'system',
  displayName: 'Mog XLSX Import Change',
};

type XlsxVersionMetadataHeadCandidate = {
  readonly documentId: string;
  readonly head: {
    readonly commitId: WorkbookCommitId | string;
    readonly refName?: string;
    readonly resolvedFrom?: string;
    readonly refRevision?:
      | VersionRecordRevision
      | { readonly kind: 'opaque'; readonly value: string };
  };
};

export type XlsxVersionExistingGraphImportInput = {
  readonly namespace: VersionGraphNamespace;
  readonly graph: VersionGraphStore;
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly provenance: XlsxVersionImportRootProvenance;
  readonly createdAt: string;
};

export type XlsxVersionExistingGraphImportResult =
  | {
      readonly status: 'committed';
      readonly commitId: WorkbookCommitId;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'unchanged' | 'skipped';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function buildXlsxVersionImportRootWrite(input: {
  readonly namespace: VersionGraphNamespace;
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly provenance: XlsxVersionImportRootProvenance;
  readonly createdAt: string;
}): Promise<VersionGraphInitializeInput['rootWrite']> {
  const [snapshotRootRecord, semanticState] = await Promise.all([
    captureWorkbookSnapshotRootRecord(input.namespace, input.snapshotRootByteSyncPort),
    input.semanticStateReader.readCurrentSemanticState(),
  ]);
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'xlsxImportRoot',
        source: input.provenance.source,
        ...(input.provenance.versionMetadataTrust
          ? { versionMetadataTrust: input.provenance.versionMetadataTrust }
          : {}),
        semanticStateDigest: semanticState.stateDigest,
      },
      importDiagnostics: input.provenance.diagnostics,
      semanticState,
      changes: [],
    },
  });

  return {
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: XLSX_IMPORT_ROOT_AUTHOR,
    createdAt: input.createdAt,
    completenessDiagnostics: [],
  };
}

export async function applyXlsxVersionImportChangeToExistingGraph(
  input: XlsxVersionExistingGraphImportInput,
): Promise<XlsxVersionExistingGraphImportResult> {
  const candidate = input.provenance.versionMetadataHeadCandidate;
  if (!candidate) return { status: 'skipped', diagnostics: [] };

  const head = await input.graph.readHead();
  if (head.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: mapGraphDiagnostics(head.diagnostics, 'commitGraphWrite'),
    };
  }
  if (!metadataHeadCandidateMatchesCurrentHead(candidate, input.namespace.documentId, head.head)) {
    return { status: 'skipped', diagnostics: [] };
  }

  const parentCommit = await input.graph.readCommit(head.head.id);
  if (parentCommit.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: [
        versionStoreDiagnostic('VERSION_MISSING_PARENT', {
          operation: 'commitGraphWrite',
          namespace: input.namespace,
          safeMessage: 'Trusted XLSX reimport base commit could not be read.',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
          details: { source: 'xlsx-import-change' },
        }),
      ],
    };
  }

  const previousSemanticState = await readCommitSemanticState(
    input.graph,
    parentCommit.commit,
    input.namespace,
  );
  if (!previousSemanticState.ok) {
    return { status: 'failed', diagnostics: previousSemanticState.diagnostics };
  }

  const currentSemanticState = await input.semanticStateReader.readCurrentSemanticState();
  if (
    semanticDigestKey(previousSemanticState.semanticState.stateDigest) ===
    semanticDigestKey(currentSemanticState.stateDigest)
  ) {
    return { status: 'unchanged', diagnostics: [] };
  }

  const semanticDiff = await input.semanticStateReader.diffSemanticStates(
    previousSemanticState.semanticState.state,
    currentSemanticState.state,
  );
  const snapshotRootRecord = await captureWorkbookSnapshotRootRecord(
    input.namespace,
    input.snapshotRootByteSyncPort,
  );
  const semanticChangeSetRecord = await createVersionObjectRecord(input.namespace, {
    objectType: 'workbook.semanticChangeSet.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: {
      schemaVersion: 1,
      source: {
        kind: 'xlsxImportChange',
        source: input.provenance.source,
        versionMetadataTrust: trustedVersionMetadataTrust(input.provenance),
        beforeStateDigest: semanticDiff.beforeDigest,
        afterStateDigest: semanticDiff.afterDigest,
        semanticStateDigest: currentSemanticState.stateDigest,
      },
      importDiagnostics: input.provenance.diagnostics,
      semanticState: currentSemanticState,
      semanticDiff,
      changes: semanticDiff.changes,
    },
  });

  const committed = await input.graph.commit({
    snapshotRootRecord,
    semanticChangeSetRecord,
    author: XLSX_IMPORT_CHANGE_AUTHOR,
    createdAt: input.createdAt,
    completenessDiagnostics: [],
    expectedHeadCommitId: head.head.id,
    expectedMainRefVersion: head.main.revision,
  } satisfies CommitVersionGraphInput);
  if (committed.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: mapGraphDiagnostics(committed.diagnostics, 'commitGraphWrite'),
    };
  }

  return {
    status: 'committed',
    commitId: committed.commit.id,
    diagnostics: [],
  };
}

function metadataHeadCandidateMatchesCurrentHead(
  candidate: XlsxVersionMetadataHeadCandidate,
  documentId: string,
  head: VersionGraphCommitRef,
): boolean {
  return (
    candidate.documentId === documentId &&
    candidate.head.commitId === head.id &&
    optionalStringMatches(candidate.head.refName, VERSION_GRAPH_MAIN_REF) &&
    optionalStringMatches(candidate.head.resolvedFrom, VERSION_GRAPH_HEAD_REF) &&
    versionRecordRevisionMatches(candidate.head.refRevision, head.refRevision)
  );
}

function trustedVersionMetadataTrust(
  provenance: XlsxVersionImportRootProvenance,
): NonNullable<XlsxVersionImportRootProvenance['versionMetadataTrust']> {
  return {
    status: 'trusted',
    sidecarPart:
      provenance.versionMetadataTrust?.sidecarPart ?? 'customXml/mog-version-metadata.xml',
    redacted: true,
  };
}

async function readCommitSemanticState(
  graph: VersionGraphStore,
  commit: WorkbookCommit,
  namespace: VersionGraphNamespace,
): Promise<
  | { readonly ok: true; readonly semanticState: SemanticWorkbookStateEnvelope }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const record = await graph.getObjectRecord<unknown>({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: commit.payload.semanticChangeSetDigest,
    });
    const semanticState = semanticStateEnvelopeFromPayload(record.preimage.payload);
    if (semanticState) return { ok: true, semanticState };
  } catch {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          namespace,
          safeMessage: 'Trusted XLSX reimport base semantic change set could not be read.',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
          details: { source: 'xlsx-import-change' },
        }),
      ],
    };
  }

  return {
    ok: false,
    diagnostics: [
      versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
        operation: 'commitGraphWrite',
        namespace,
        safeMessage:
          'Trusted XLSX reimport requires a base commit with a full semantic state envelope.',
        recoverability: 'unsupported',
        mutationGuarantee: 'no-write-attempted',
        details: { source: 'xlsx-import-change' },
      }),
    ],
  };
}

function semanticStateEnvelopeFromPayload(payload: unknown): SemanticWorkbookStateEnvelope | null {
  if (!isRecord(payload)) return null;
  const semanticState = payload.semanticState;
  if (!isRecord(semanticState)) return null;
  if (!isRecord(semanticState.state)) return null;
  if (!isRecord(semanticState.stateDigest)) return null;
  return semanticState as unknown as SemanticWorkbookStateEnvelope;
}

function semanticDigestKey(digest: unknown): string {
  return JSON.stringify(digest);
}

function optionalStringMatches(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function versionRecordRevisionMatches(
  left: XlsxVersionMetadataHeadCandidate['head']['refRevision'],
  right: VersionGraphCommitRef['refRevision'] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind && left.value === right.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
