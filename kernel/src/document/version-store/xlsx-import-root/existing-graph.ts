import type { CommitVersionGraphInput } from '../graph';
import { createInMemoryVersionGraphStore } from '../graph';
import { createVersionObjectRecord } from '../object-store';
import { mapGraphDiagnostics, versionStoreDiagnostic } from '../provider';
import { evaluateVersionHistoryRootPolicy } from '../version-history-root-policy';
import {
  createOrReadExternalChangeBranch,
  createOrReadImportNewRootBranch,
  externalChangeBranchName,
  importNewRootBranchName,
} from './branches';
import { XLSX_IMPORT_CHANGE_AUTHOR } from './constants';
import {
  importRootProvenanceWithoutTrustedCandidate,
  trustedVersionMetadataHeadCandidate,
  trustedVersionMetadataTrust,
  untrustedImportRootProvenance,
} from './provenance';
import type {
  XlsxVersionExistingGraphImportInput,
  XlsxVersionExistingGraphImportResult,
} from './results';
import { readCommitSemanticState, semanticDigestKey } from './semantic-state';
import { captureXlsxImportSnapshotRootRecord } from './snapshot-root';
import { readTrustedBaseCommit } from './trusted-base';
import { buildXlsxVersionImportRootWrite } from './write';

export async function applyXlsxVersionImportChangeToExistingGraph(
  input: XlsxVersionExistingGraphImportInput,
): Promise<XlsxVersionExistingGraphImportResult> {
  const candidate = trustedVersionMetadataHeadCandidate(input.provenance);
  if (!candidate) {
    return applyXlsxVersionImportNewRootToExistingGraph({
      ...input,
      provenance: importRootProvenanceWithoutTrustedCandidate(input.provenance),
    });
  }

  const visibleHead = await input.graph.readHead();
  if (visibleHead.status !== 'success') {
    return {
      status: 'failed',
      diagnostics: mapGraphDiagnostics(visibleHead.diagnostics, 'commitGraphWrite'),
    };
  }

  const trustedBase = await readTrustedBaseCommit(input, candidate, visibleHead.head.id);
  if (trustedBase.status === 'skipped') {
    return applyXlsxVersionImportNewRootToExistingGraph({
      ...input,
      provenance: untrustedImportRootProvenance(input.provenance, trustedBase.reason),
    });
  }
  if (trustedBase.status !== 'success') return trustedBase;

  if (input.historyRootPolicy) {
    const externalChangePolicy = evaluateVersionHistoryRootPolicy({
      kind: 'external-change',
      policy: input.historyRootPolicy,
      operation: 'commitGraphWrite',
      hasExistingVisibleHistory: true,
      trustedBase: true,
    });
    if (!externalChangePolicy.ok) {
      return { status: 'failed', diagnostics: externalChangePolicy.diagnostics };
    }
  }

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

  const snapshotRootRecord = await captureXlsxImportSnapshotRootRecord(
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
  if (input.historyRootPolicy) {
    const rootPolicy = evaluateVersionHistoryRootPolicy({
      kind: 'existing-no-history',
      policy: input.historyRootPolicy,
      operation: 'commitGraphWrite',
      hasExistingVisibleHistory: true,
      trustedBase: false,
    });
    if (!rootPolicy.ok) {
      return { status: 'failed', diagnostics: rootPolicy.diagnostics };
    }
  }

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
