import type { ImportDiagnosticDto } from '@mog-sdk/contracts/data/diagnostics';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { SemanticWorkbookStateEnvelope } from '../../bridges/compute/compute-types.gen';
import type { WorkbookCommit } from './commit-store';
import type { CommitVersionGraphInput, VersionGraphBranchRefName } from './graph-store';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
} from './graph-store';
import { isObjectDigest, type ObjectDigest, type WorkbookCommitId } from './object-digest';
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
    readonly status: 'absent' | 'trusted' | 'trusted-stale-base' | 'untrusted';
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
const XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX = 'import/external-change';
const XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX = 'import/new-root';

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
    readonly semanticChangeSetDigest?: unknown;
    readonly snapshotRootDigest?: unknown;
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
  if (!candidate) return applyXlsxVersionImportNewRootToExistingGraph(input);

  const visibleHead = await input.graph.readHead();
  if (visibleHead.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: mapGraphDiagnostics(visibleHead.diagnostics, 'commitGraphWrite'),
    };
  }

  const trustedBase = await readTrustedBaseCommit(input, candidate);
  if (trustedBase.status === 'skipped') {
    return applyXlsxVersionImportNewRootToExistingGraph({
      ...input,
      provenance: untrustedImportRootProvenance(input.provenance),
    });
  }
  if (trustedBase.status !== 'success') return trustedBase;

  const parentCommit = trustedBase.commit;
  const previousSemanticState = await readCommitSemanticState(
    input.graph,
    parentCommit,
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
  const targetBranch = await createOrReadExternalChangeBranch({
    graph: input.graph,
    namespace: input.namespace,
    baseCommitId: parentCommit.id,
    branchName: externalChangeBranchName(parentCommit.id, semanticDiff.afterDigest),
  });
  if (targetBranch.status !== 'success') return targetBranch;

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
    targetRef: targetBranch.branch.refName,
    expectedHeadCommitId: parentCommit.id,
    expectedTargetRefVersion: targetBranch.branch.ref.refVersion,
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

async function applyXlsxVersionImportNewRootToExistingGraph(
  input: XlsxVersionExistingGraphImportInput,
): Promise<XlsxVersionExistingGraphImportResult> {
  const rootWrite = await buildXlsxVersionImportRootWrite({
    namespace: input.namespace,
    snapshotRootByteSyncPort: input.snapshotRootByteSyncPort,
    semanticStateReader: input.semanticStateReader,
    provenance: input.provenance,
    createdAt: input.createdAt,
  });
  const rootGraph = createInMemoryVersionGraphStore({ namespace: input.namespace });
  const initialized = await rootGraph.initializeGraph(rootWrite);
  if (initialized.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: mapGraphDiagnostics(initialized.diagnostics, 'commitGraphWrite'),
    };
  }

  const snapshot = await rootGraph.exportSnapshot();
  const persistedObjects = await input.graph.putObjects(snapshot.objectRecords);
  if (persistedObjects.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: [
        versionStoreDiagnostic('VERSION_OBJECT_STORE_FAILURE', {
          operation: 'commitGraphWrite',
          namespace: input.namespace,
          safeMessage: 'XLSX reimport root objects could not be persisted.',
          recoverability: 'retry',
          mutationGuarantee: 'no-write-attempted',
          details: { source: 'xlsx-import-root' },
        }),
      ],
    };
  }

  const targetBranch = await createOrReadImportNewRootBranch({
    graph: input.graph,
    namespace: input.namespace,
    rootCommitId: initialized.commit.id,
    branchName: importNewRootBranchName(
      initialized.commit.id,
      input.provenance.versionMetadataTrust?.status ?? 'absent',
    ),
  });
  if (targetBranch.status !== 'success') return targetBranch;

  return {
    status: 'committed',
    commitId: initialized.commit.id,
    diagnostics: [],
  };
}

async function readTrustedBaseCommit(
  input: XlsxVersionExistingGraphImportInput,
  candidate: XlsxVersionMetadataHeadCandidate,
): Promise<
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly diagnostics: readonly [];
    }
  | { readonly status: 'skipped'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly status: 'failed'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (
    candidate.documentId !== input.namespace.documentId ||
    !metadataHeadCandidateNamesSupportedRef(candidate)
  ) {
    return { status: 'skipped', diagnostics: [] };
  }

  const read = await input.graph.readCommit(candidate.head.commitId);
  if (read.status !== 'success') {
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

  if (!metadataHeadCandidateMatchesTrustedBase(candidate, read.commit)) {
    return { status: 'skipped', diagnostics: [] };
  }

  return { status: 'success', commit: read.commit, diagnostics: [] };
}

function metadataHeadCandidateNamesSupportedRef(
  candidate: XlsxVersionMetadataHeadCandidate,
): boolean {
  return (
    optionalStringMatches(candidate.head.refName, VERSION_GRAPH_MAIN_REF) &&
    optionalStringMatches(candidate.head.resolvedFrom, VERSION_GRAPH_HEAD_REF)
  );
}

function metadataHeadCandidateMatchesTrustedBase(
  candidate: XlsxVersionMetadataHeadCandidate,
  baseCommit: WorkbookCommit,
): boolean {
  return (
    candidate.head.commitId === baseCommit.id &&
    isObjectDigest(candidate.head.semanticChangeSetDigest) &&
    isObjectDigest(candidate.head.snapshotRootDigest) &&
    objectDigestMatches(
      candidate.head.semanticChangeSetDigest,
      baseCommit.payload.semanticChangeSetDigest,
    ) &&
    objectDigestMatches(candidate.head.snapshotRootDigest, baseCommit.payload.snapshotRootDigest)
  );
}

async function createOrReadExternalChangeBranch(input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly baseCommitId: WorkbookCommitId;
  readonly branchName: string;
}): Promise<
  | {
      readonly status: 'success';
      readonly branch: {
        readonly refName: VersionGraphBranchRefName;
        readonly ref: { readonly refVersion: VersionRecordRevision };
      };
      readonly diagnostics: readonly [];
    }
  | Extract<XlsxVersionExistingGraphImportResult, { readonly status: 'failed' }>
> {
  const created = await input.graph.createBranch({
    name: input.branchName,
    targetCommitId: input.baseCommitId,
    expectedAbsent: true,
    baseCommitId: input.baseCommitId,
    createdBy: XLSX_IMPORT_CHANGE_AUTHOR,
  });
  if (created.ok) {
    return { status: 'success', branch: created.branch, diagnostics: [] };
  }

  const existing = await input.graph.readBranch(input.branchName);
  if (
    existing.ok &&
    existing.branch !== null &&
    existing.branch.ref.targetCommitId === input.baseCommitId
  ) {
    return { status: 'success', branch: existing.branch, diagnostics: [] };
  }

  return {
    status: 'failed',
    diagnostics: [
      versionStoreDiagnostic('VERSION_REF_CONFLICT', {
        operation: 'commitGraphWrite',
        namespace: input.namespace,
        safeMessage: 'Trusted XLSX reimport external-change branch could not be created.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        details: {
          source: 'xlsx-import-change',
          branchNamespace: XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX,
        },
      }),
    ],
  };
}

async function createOrReadImportNewRootBranch(input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly rootCommitId: WorkbookCommitId;
  readonly branchName: string;
}): Promise<
  | {
      readonly status: 'success';
      readonly branch: {
        readonly refName: VersionGraphBranchRefName;
        readonly ref: { readonly refVersion: VersionRecordRevision };
      };
      readonly diagnostics: readonly [];
    }
  | Extract<XlsxVersionExistingGraphImportResult, { readonly status: 'failed' }>
> {
  const created = await input.graph.createBranch({
    name: input.branchName,
    targetCommitId: input.rootCommitId,
    expectedAbsent: true,
    createdBy: XLSX_IMPORT_ROOT_AUTHOR,
  });
  if (created.ok) {
    return { status: 'success', branch: created.branch, diagnostics: [] };
  }

  const existing = await input.graph.readBranch(input.branchName);
  if (
    existing.ok &&
    existing.branch !== null &&
    existing.branch.ref.targetCommitId === input.rootCommitId
  ) {
    return { status: 'success', branch: existing.branch, diagnostics: [] };
  }

  return {
    status: 'failed',
    diagnostics: [
      versionStoreDiagnostic('VERSION_REF_CONFLICT', {
        operation: 'commitGraphWrite',
        namespace: input.namespace,
        safeMessage: 'XLSX reimport import-root branch could not be created.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
        details: {
          source: 'xlsx-import-root',
          branchNamespace: XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX,
        },
      }),
    ],
  };
}

function externalChangeBranchName(baseCommitId: WorkbookCommitId, afterDigest: unknown): string {
  const baseSegment = baseCommitId.slice('commit:sha256:'.length, 'commit:sha256:'.length + 16);
  const afterSegment = digestBranchSegment(afterDigest);
  return `${XLSX_EXTERNAL_CHANGE_BRANCH_PREFIX}/${baseSegment}/${afterSegment}`;
}

function importNewRootBranchName(rootCommitId: WorkbookCommitId, trustStatus: string): string {
  const rootSegment = rootCommitId.slice('commit:sha256:'.length, 'commit:sha256:'.length + 16);
  return `${XLSX_IMPORT_NEW_ROOT_BRANCH_PREFIX}/${safeBranchSegment(trustStatus)}/${rootSegment}`;
}

function trustedVersionMetadataTrust(
  provenance: XlsxVersionImportRootProvenance,
): NonNullable<XlsxVersionImportRootProvenance['versionMetadataTrust']> {
  const status =
    provenance.versionMetadataTrust?.status === 'trusted-stale-base'
      ? 'trusted-stale-base'
      : 'trusted';
  return {
    status,
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

function objectDigestMatches(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function digestBranchSegment(value: unknown): string {
  if (isObjectDigest(value)) return value.digest.slice(0, 16);
  if (isRecord(value) && typeof value.value === 'string') {
    return safeBranchSegment(value.value);
  }
  if (isRecord(value) && typeof value.digest === 'string') {
    return safeBranchSegment(value.digest);
  }
  return 'unknown-digest';
}

function untrustedImportRootProvenance(
  provenance: XlsxVersionImportRootProvenance,
): XlsxVersionImportRootProvenance {
  if (
    provenance.versionMetadataTrust?.status !== 'trusted' &&
    provenance.versionMetadataTrust?.status !== 'trusted-stale-base'
  ) {
    return provenance;
  }
  const { versionMetadataHeadCandidate: _candidate, ...rest } = provenance;
  return {
    ...rest,
    versionMetadataTrust: {
      status: 'untrusted',
      sidecarPart: provenance.versionMetadataTrust.sidecarPart,
      reason: 'head-unverified',
      redacted: true,
    },
  };
}

function safeBranchSegment(value: string): string {
  const segment = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 16);
  return segment.length > 0 ? segment : 'unknown-digest';
}

function optionalStringMatches(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
