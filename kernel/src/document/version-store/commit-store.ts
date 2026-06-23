import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import { cloneDigest, dependencyKey } from './commit-store-utils';
import {
  collectDependencyRecords,
  dependenciesForPayload,
  diagnostic,
  parseCommitPayload,
  parseCompletenessDiagnostics,
  parseString,
  parseVersionAuthor,
} from './commit-store-payload';
import {
  VersionObjectStoreError,
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import { validateWorkbookParentCommitClosureForCreate } from './commit-store-parents';

export type WorkbookCommitCompletenessDiagnostic = {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type WorkbookCommitPayload = {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly snapshotRootDigest: ObjectDigest;
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly mutationSegmentDigests?: readonly ObjectDigest[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryDigest?: ObjectDigest;
  readonly verificationSummaryDigest?: ObjectDigest;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type WorkbookCommit = {
  readonly id: WorkbookCommitId;
  readonly record: VersionObjectRecord<WorkbookCommitPayload>;
  readonly payload: WorkbookCommitPayload;
};

export type WorkbookCommitStoreDiagnosticCode =
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT';

export type WorkbookCommitStoreDiagnostic = {
  readonly code: WorkbookCommitStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly documentId?: string;
  readonly expectedDocumentId?: string;
  readonly commitId?: WorkbookCommitId;
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly sourceDiagnostics?: readonly VersionObjectStoreDiagnostic[];
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type CreateWorkbookCommitInput = {
  readonly documentId: string;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords?: readonly VersionObjectRecord<unknown>[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type CreateWorkbookCommitResult =
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly objectBatch: readonly VersionObjectRecord<unknown>[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
      readonly mutationGuarantee: 'no-objects-written';
    };

export type ReadWorkbookCommitResult =
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
    };

export class InMemoryWorkbookCommitStore {
  private readonly objectStore: InMemoryVersionObjectStore;

  constructor(objectStore: InMemoryVersionObjectStore) {
    this.objectStore = objectStore;
  }

  async createWorkbookCommit(
    input: CreateWorkbookCommitInput,
  ): Promise<CreateWorkbookCommitResult> {
    const documentId = normalizeDocumentId(input.documentId);
    if (documentId !== this.objectStore.namespace.documentId) {
      return failedCreate([
        diagnostic(
          'VERSION_WRONG_DOCUMENT',
          'Commit documentId does not match the version object store namespace.',
          {
            documentId,
            expectedDocumentId: this.objectStore.namespace.documentId,
          },
        ),
      ]);
    }

    const parentResult = await validateWorkbookParentCommitClosureForCreate(
      this.objectStore,
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
    const commitRecord = await createVersionObjectRecord(this.objectStore.namespace, {
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
      this.objectStore.namespace.documentId,
    );
    if (validationDiagnostics.length > 0) {
      return failedCreate(validationDiagnostics);
    }

    const objectBatch = [
      records.snapshotRootRecord,
      records.semanticChangeSetRecord,
      ...records.mutationSegmentRecords,
      ...(records.redactionSummaryRecord === undefined ? [] : [records.redactionSummaryRecord]),
      ...(records.verificationSummaryRecord === undefined
        ? []
        : [records.verificationSummaryRecord]),
      commitRecord,
    ] satisfies readonly VersionObjectRecord<unknown>[];

    const putResult = await this.objectStore.putObjects(objectBatch);
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

  async readCommit(commitIdInput: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult> {
    let commitId: WorkbookCommitId;
    try {
      commitId = parseWorkbookCommitId(commitIdInput);
    } catch {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id must be commit:sha256:<64 hex>.'),
        ],
      };
    }

    try {
      const digest = objectDigestFromWorkbookCommitId(commitId);
      const record = await this.objectStore.getObjectRecord<WorkbookCommitPayload>({
        kind: 'commit',
        commitId,
        digest,
      });
      const validationDiagnostics = validateCommitRecord(
        commitId,
        record,
        this.objectStore.namespace.documentId,
      );
      if (validationDiagnostics.length > 0) {
        return { status: 'failed', diagnostics: validationDiagnostics };
      }

      const dependencyDiagnostics = await validateCommitDependenciesPresent(
        this.objectStore,
        commitId,
        record.preimage.dependencies,
      );
      if (dependencyDiagnostics.length > 0) {
        return { status: 'failed', diagnostics: dependencyDiagnostics };
      }

      return {
        status: 'success',
        commit: commitFromRecord(commitId, record),
        diagnostics: [],
      };
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [
          diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit object read failed.', {
            commitId,
            sourceDiagnostics:
              error instanceof VersionObjectStoreError ? [error.diagnostic] : undefined,
          }),
        ],
      };
    }
  }
}

export function createInMemoryWorkbookCommitStore(
  objectStore: InMemoryVersionObjectStore,
): InMemoryWorkbookCommitStore {
  return new InMemoryWorkbookCommitStore(objectStore);
}

function validateCommitRecord(
  commitId: WorkbookCommitId,
  record: VersionObjectRecord<WorkbookCommitPayload>,
  expectedDocumentId: string,
): readonly WorkbookCommitStoreDiagnostic[] {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const expectedDigest = objectDigestFromWorkbookCommitId(commitId);

  if (record.preimage.objectType !== 'workbook.commit.v1') {
    diagnostics.push(
      diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit id resolved to a non-commit object.', {
        commitId,
        objectDigest: record.digest,
        details: { objectType: record.preimage.objectType },
      }),
    );
  }
  if (record.digest.digest !== expectedDigest.digest) {
    diagnostics.push(
      diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit id digest does not match commit object.', {
        commitId,
        objectDigest: record.digest,
        details: { expectedDigest: expectedDigest.digest, receivedDigest: record.digest.digest },
      }),
    );
  }

  const payloadResult = parseCommitPayload(record.preimage.payload);
  if (!payloadResult.ok) {
    diagnostics.push(...payloadResult.diagnostics);
    return diagnostics;
  }

  const payload = payloadResult.payload;
  if (payload.documentId !== expectedDocumentId) {
    diagnostics.push(
      diagnostic('VERSION_WRONG_DOCUMENT', 'Commit payload documentId is outside this store.', {
        commitId,
        documentId: payload.documentId,
        expectedDocumentId,
      }),
    );
  }

  const expectedDependencies = dependenciesForPayload(payload);
  const expectedKeys = new Set(expectedDependencies.map(dependencyKey));
  const actualKeys = new Set(record.preimage.dependencies.map(dependencyKey));
  for (const dependency of expectedDependencies) {
    if (!actualKeys.has(dependencyKey(dependency))) {
      diagnostics.push(
        diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload reference is not a dependency.', {
          commitId,
          dependency,
        }),
      );
    }
  }
  for (const dependency of record.preimage.dependencies) {
    if (!expectedKeys.has(dependencyKey(dependency))) {
      diagnostics.push(
        diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit object has an unexpected dependency.', {
          commitId,
          dependency,
        }),
      );
    }
  }

  return diagnostics;
}

async function validateCommitDependenciesPresent(
  objectStore: InMemoryVersionObjectStore,
  commitId: WorkbookCommitId,
  dependencies: readonly VersionDependencyRef[],
): Promise<readonly WorkbookCommitStoreDiagnostic[]> {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  for (const dependency of dependencies) {
    try {
      await objectStore.getObjectRecord(dependency);
    } catch (error) {
      const source = error instanceof VersionObjectStoreError ? error.diagnostic : undefined;
      const missing =
        source?.code === 'VERSION_OBJECT_NOT_FOUND' ||
        source?.code === 'VERSION_OBJECT_TYPE_MISMATCH';
      const code = missing
        ? dependency.kind === 'commit'
          ? 'VERSION_MISSING_PARENT'
          : 'VERSION_MISSING_DEPENDENCY'
        : 'VERSION_OBJECT_STORE_FAILURE';
      diagnostics.push(
        diagnostic(
          code,
          missing
            ? 'Commit dependency object is missing or has the wrong object type.'
            : 'Commit dependency object failed integrity validation.',
          {
            commitId,
            objectDigest: dependency.digest,
            dependency,
            ...(source === undefined ? {} : { sourceDiagnostics: [source] }),
          },
        ),
      );
    }
  }
  return diagnostics;
}

function commitFromRecord(
  commitId: WorkbookCommitId,
  record: VersionObjectRecord<WorkbookCommitPayload>,
): WorkbookCommit {
  return {
    id: commitId,
    record,
    payload: record.preimage.payload,
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
