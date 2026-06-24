import { workbookCommitIdFromObjectDigest } from '../object-digest';
import { cloneDigest } from './utils';
import {
  collectDependencyRecords,
  dependenciesForPayload,
  diagnostic,
  parseCompletenessDiagnostics,
  parseCommitAnnotation,
  parseString,
  parseVersionAuthor,
} from './payload';
import { validateWorkbookParentCommitClosureForCreate } from './parents';
import { commitFromRecord, validateCommitRecord } from './records';
import {
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionObjectRecord,
} from '../object-store';
import type {
  CreateWorkbookCommitInput,
  CreateWorkbookCommitResult,
  WorkbookCommitPayload,
  WorkbookCommitStoreDiagnostic,
} from './types';

export async function createWorkbookCommitInObjectStore(
  objectStore: InMemoryVersionObjectStore,
  input: CreateWorkbookCommitInput,
): Promise<CreateWorkbookCommitResult> {
  const documentId = normalizeDocumentId(input.documentId);
  if (documentId !== objectStore.namespace.documentId) {
    return failedCreate([
      diagnostic(
        'VERSION_WRONG_DOCUMENT',
        'Commit documentId does not match the version object store namespace.',
        {
          documentId,
          expectedDocumentId: objectStore.namespace.documentId,
        },
      ),
    ]);
  }

  const parentResult = await validateWorkbookParentCommitClosureForCreate(
    objectStore,
    input.parentCommitIds ?? [],
  );
  if (!parentResult.ok) {
    return failedCreate(parentResult.diagnostics);
  }
  const parentCommitIds = parentResult.parentCommitIds;

  const records = collectDependencyRecords(input);
  if (records.diagnostics.length > 0) {
    return failedCreate(records.diagnostics);
  }

  const payloadDiagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const author = parseVersionAuthor(input.author, 'author', payloadDiagnostics);
  const createdAt = parseString(input.createdAt, 'createdAt', payloadDiagnostics);
  const annotation = parseCommitAnnotation(input.annotation, 'annotation', payloadDiagnostics);
  const completenessDiagnostics = parseCompletenessDiagnostics(
    input.completenessDiagnostics ?? [],
    'completenessDiagnostics',
    payloadDiagnostics,
  );
  if (
    payloadDiagnostics.length > 0 ||
    author === undefined ||
    createdAt === undefined ||
    completenessDiagnostics === undefined
  ) {
    return failedCreate(payloadDiagnostics);
  }

  const payload: WorkbookCommitPayload = {
    schemaVersion: 1,
    documentId,
    parentCommitIds,
    snapshotRootDigest: cloneDigest(records.snapshotRootRecord.digest),
    semanticChangeSetDigest: cloneDigest(records.semanticChangeSetRecord.digest),
    ...(records.mutationSegmentRecords.length === 0
      ? {}
      : {
          mutationSegmentDigests: records.mutationSegmentRecords.map((record) =>
            cloneDigest(record.digest),
          ),
        }),
    author,
    createdAt,
    ...(annotation ? { annotation } : {}),
    completenessDiagnostics,
    ...(records.redactionSummaryRecord === undefined
      ? {}
      : { redactionSummaryDigest: cloneDigest(records.redactionSummaryRecord.digest) }),
    ...(records.verificationSummaryRecord === undefined
      ? {}
      : { verificationSummaryDigest: cloneDigest(records.verificationSummaryRecord.digest) }),
    ...(input.resolvedMergeAttemptDigest === undefined
      ? {}
      : { resolvedMergeAttemptDigest: cloneDigest(input.resolvedMergeAttemptDigest) }),
  };

  const dependencies = dependenciesForPayload(payload);
  const commitRecord = await createVersionObjectRecord(objectStore.namespace, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies,
    payload,
  });
  const commitId = workbookCommitIdFromObjectDigest(commitRecord.digest);

  const validationDiagnostics = validateCommitRecord(
    commitId,
    commitRecord,
    objectStore.namespace.documentId,
  );
  if (validationDiagnostics.length > 0) {
    return failedCreate(validationDiagnostics);
  }

  const objectBatch = [
    records.snapshotRootRecord,
    records.semanticChangeSetRecord,
    ...records.mutationSegmentRecords,
    ...(records.redactionSummaryRecord === undefined ? [] : [records.redactionSummaryRecord]),
    ...(records.verificationSummaryRecord === undefined ? [] : [records.verificationSummaryRecord]),
    commitRecord,
  ] satisfies readonly VersionObjectRecord<unknown>[];

  const putResult = await objectStore.putObjects(objectBatch);
  if (putResult.status !== 'success') {
    return failedCreate([
      diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit object batch write failed.', {
        sourceDiagnostics: putResult.diagnostics,
      }),
    ]);
  }

  return {
    status: 'success',
    commit: commitFromRecord(commitId, commitRecord),
    objectBatch,
    diagnostics: [],
  };
}

function failedCreate(
  diagnostics: readonly WorkbookCommitStoreDiagnostic[],
): CreateWorkbookCommitResult {
  return {
    status: 'failed',
    diagnostics,
    mutationGuarantee: 'no-objects-written',
  };
}

function normalizeDocumentId(documentId: unknown): string {
  return typeof documentId === 'string' ? documentId.normalize('NFC') : '';
}
