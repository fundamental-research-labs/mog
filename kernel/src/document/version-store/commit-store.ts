import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  objectDigestFromWorkbookCommitId,
  parseObjectDigest,
  parseWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
  type WorkbookCommitId,
} from './object-digest';
import {
  VersionObjectStoreError,
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';

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
  readonly message?: string;
  readonly completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryDigest?: ObjectDigest;
  readonly verificationSummaryDigest?: ObjectDigest;
};

export type WorkbookCommit = {
  readonly id: WorkbookCommitId;
  readonly record: VersionObjectRecord<WorkbookCommitPayload>;
  readonly payload: WorkbookCommitPayload;
};

export type WorkbookCommitStoreDiagnosticCode =
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_OBJECT_STORE_FAILURE'
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
  readonly message?: string;
  readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
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

    const parentCommitIds = input.parentCommitIds ?? [];
    if (parentCommitIds.length > 0) {
      return failedCreate([
        diagnostic(
          'VERSION_UNSUPPORTED_PARENT_COMMIT',
          'This commit-store slice only supports root commits.',
          {
            details: { parentCommitCount: parentCommitIds.length },
          },
        ),
      ]);
    }

    const records = collectDependencyRecords(input);
    if (records.diagnostics.length > 0) {
      return failedCreate(records.diagnostics);
    }

    const payload: WorkbookCommitPayload = {
      schemaVersion: 1,
      documentId,
      parentCommitIds: [],
      snapshotRootDigest: cloneDigest(records.snapshotRootRecord.digest),
      semanticChangeSetDigest: cloneDigest(records.semanticChangeSetRecord.digest),
      ...(records.mutationSegmentRecords.length === 0
        ? {}
        : {
            mutationSegmentDigests: records.mutationSegmentRecords.map((record) =>
              cloneDigest(record.digest),
            ),
          }),
      author: cloneAuthor(input.author),
      createdAt: input.createdAt,
      ...(input.message === undefined ? {} : { message: input.message }),
      completenessDiagnostics: (input.completenessDiagnostics ?? []).map(
        cloneCompletenessDiagnostic,
      ),
      ...(records.redactionSummaryRecord === undefined
        ? {}
        : { redactionSummaryDigest: cloneDigest(records.redactionSummaryRecord.digest) }),
      ...(records.verificationSummaryRecord === undefined
        ? {}
        : { verificationSummaryDigest: cloneDigest(records.verificationSummaryRecord.digest) }),
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

type CommitDependencyRecords = {
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
  readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
};

function collectDependencyRecords(input: CreateWorkbookCommitInput): CommitDependencyRecords {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const snapshotRootRecord = validateDependencyRecord(
    input.snapshotRootRecord,
    'workbook.snapshotRoot.v1',
    'snapshotRootRecord',
    diagnostics,
  );
  const semanticChangeSetRecord = validateDependencyRecord(
    input.semanticChangeSetRecord,
    'workbook.semanticChangeSet.v1',
    'semanticChangeSetRecord',
    diagnostics,
  );
  const mutationSegmentRecords = (input.mutationSegmentRecords ?? []).flatMap((record, index) => {
    const validated = validateDependencyRecord(
      record,
      'workbook.mutationSegment.v1',
      `mutationSegmentRecords[${index}]`,
      diagnostics,
    );
    return validated === undefined ? [] : [validated];
  });
  const redactionSummaryRecord =
    input.redactionSummaryRecord === undefined
      ? undefined
      : validateDependencyRecord(
          input.redactionSummaryRecord,
          'workbook.redactionSummary.v1',
          'redactionSummaryRecord',
          diagnostics,
        );
  const verificationSummaryRecord =
    input.verificationSummaryRecord === undefined
      ? undefined
      : validateDependencyRecord(
          input.verificationSummaryRecord,
          'workbook.verificationSummary.v1',
          'verificationSummaryRecord',
          diagnostics,
        );

  return {
    snapshotRootRecord: snapshotRootRecord as VersionObjectRecord<unknown>,
    semanticChangeSetRecord: semanticChangeSetRecord as VersionObjectRecord<unknown>,
    mutationSegmentRecords,
    ...(redactionSummaryRecord === undefined ? {} : { redactionSummaryRecord }),
    ...(verificationSummaryRecord === undefined ? {} : { verificationSummaryRecord }),
    diagnostics,
  };
}

function validateDependencyRecord(
  record: VersionObjectRecord<unknown> | undefined,
  expectedObjectType: VersionObjectType,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionObjectRecord<unknown> | undefined {
  if (!isVersionObjectRecord(record)) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit dependency object record is missing.', {
        details: { path, expectedObjectType },
      }),
    );
    return undefined;
  }
  if (record.preimage.objectType !== expectedObjectType) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit dependency object record has wrong type.', {
        objectDigest: record.digest,
        details: {
          path,
          expectedObjectType,
          receivedObjectType: record.preimage.objectType,
        },
      }),
    );
    return undefined;
  }
  return record;
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
  dependencies: readonly VersionDependencyRef[],
): Promise<readonly WorkbookCommitStoreDiagnostic[]> {
  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  for (const dependency of dependencies) {
    try {
      if (!(await objectStore.hasObject(dependency))) {
        diagnostics.push(
          diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit dependency object is missing.', {
            dependency,
          }),
        );
      }
    } catch (error) {
      diagnostics.push(
        diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit dependency validation failed.', {
          sourceDiagnostics:
            error instanceof VersionObjectStoreError ? [error.diagnostic] : undefined,
        }),
      );
    }
  }
  return diagnostics;
}

function parseCommitPayload(
  payload: unknown,
):
  | { readonly ok: true; readonly payload: WorkbookCommitPayload }
  | { readonly ok: false; readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[] } {
  if (!isPlainRecord(payload) || payload.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Commit payload schema is invalid.'),
      ],
    };
  }
  if (typeof payload.documentId !== 'string') {
    return {
      ok: false,
      diagnostics: [diagnostic('VERSION_WRONG_DOCUMENT', 'Commit payload documentId is invalid.')],
    };
  }
  if (!Array.isArray(payload.parentCommitIds)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit parentCommitIds must be an array.'),
      ],
    };
  }
  if (payload.parentCommitIds.length > 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_PARENT_COMMIT',
          'This commit-store slice only supports root commits.',
          { details: { parentCommitCount: payload.parentCommitIds.length } },
        ),
      ],
    };
  }

  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const snapshotRootDigest = parsePayloadDigest(
    payload.snapshotRootDigest,
    'snapshotRootDigest',
    diagnostics,
  );
  const semanticChangeSetDigest = parsePayloadDigest(
    payload.semanticChangeSetDigest,
    'semanticChangeSetDigest',
    diagnostics,
  );
  const mutationSegmentDigests = parseOptionalDigestArray(
    payload.mutationSegmentDigests,
    'mutationSegmentDigests',
    diagnostics,
  );
  const redactionSummaryDigest = parseOptionalDigest(
    payload.redactionSummaryDigest,
    'redactionSummaryDigest',
    diagnostics,
  );
  const verificationSummaryDigest = parseOptionalDigest(
    payload.verificationSummaryDigest,
    'verificationSummaryDigest',
    diagnostics,
  );

  if (
    diagnostics.length > 0 ||
    snapshotRootDigest === undefined ||
    semanticChangeSetDigest === undefined
  ) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    payload: {
      schemaVersion: 1,
      documentId: payload.documentId,
      parentCommitIds: [],
      snapshotRootDigest,
      semanticChangeSetDigest,
      ...(mutationSegmentDigests.length === 0 ? {} : { mutationSegmentDigests }),
      author: payload.author as VersionAuthor,
      createdAt: String(payload.createdAt),
      ...(typeof payload.message === 'string' ? { message: payload.message } : {}),
      completenessDiagnostics: Array.isArray(payload.completenessDiagnostics)
        ? (payload.completenessDiagnostics as readonly WorkbookCommitCompletenessDiagnostic[])
        : [],
      ...(redactionSummaryDigest === undefined ? {} : { redactionSummaryDigest }),
      ...(verificationSummaryDigest === undefined ? {} : { verificationSummaryDigest }),
    },
  };
}

function dependenciesForPayload(payload: WorkbookCommitPayload): readonly VersionDependencyRef[] {
  return [
    {
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: cloneDigest(payload.semanticChangeSetDigest),
    },
    {
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: cloneDigest(payload.snapshotRootDigest),
    },
    ...(payload.mutationSegmentDigests ?? []).map(
      (digest): VersionDependencyRef => ({
        kind: 'object',
        objectType: 'workbook.mutationSegment.v1',
        digest: cloneDigest(digest),
      }),
    ),
    ...(payload.redactionSummaryDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.redactionSummary.v1',
            digest: cloneDigest(payload.redactionSummaryDigest),
          } satisfies VersionDependencyRef,
        ]),
    ...(payload.verificationSummaryDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.verificationSummary.v1',
            digest: cloneDigest(payload.verificationSummaryDigest),
          } satisfies VersionDependencyRef,
        ]),
  ];
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

function diagnostic(
  code: WorkbookCommitStoreDiagnosticCode,
  message: string,
  options: Omit<WorkbookCommitStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): WorkbookCommitStoreDiagnostic {
  return {
    code,
    severity: code === 'VERSION_OBJECT_STORE_FAILURE' ? 'corruption' : 'error',
    message,
    ...options,
  };
}

function normalizeDocumentId(documentId: unknown): string {
  return typeof documentId === 'string' ? documentId.normalize('NFC') : '';
}

function parsePayloadDigest(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): ObjectDigest | undefined {
  const digest = parseOptionalDigest(value, path, diagnostics);
  if (digest === undefined) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest reference is missing.', {
        details: { path },
      }),
    );
  }
  return digest;
}

function parseOptionalDigest(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): ObjectDigest | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return parseObjectDigest(value, path);
  } catch {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest reference is invalid.', {
        details: { path },
      }),
    );
    return undefined;
  }
}

function parseOptionalDigestArray(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): readonly ObjectDigest[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest list is invalid.', {
        details: { path },
      }),
    );
    return [];
  }
  return value.flatMap((entry, index) => {
    const digest = parseOptionalDigest(entry, `${path}[${index}]`, diagnostics);
    return digest === undefined ? [] : [digest];
  });
}

function dependencyKey(dependency: VersionDependencyRef): string {
  if (dependency.kind === 'object') {
    return [
      dependency.kind,
      dependency.objectType,
      dependency.digest.algorithm,
      dependency.digest.digest,
    ].join('\u0000');
  }
  return [
    dependency.kind,
    dependency.commitId,
    dependency.digest.algorithm,
    dependency.digest.digest,
  ].join('\u0000');
}

function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return { algorithm: digest.algorithm, digest: digest.digest };
}

function cloneAuthor(author: VersionAuthor): VersionAuthor {
  return { ...author };
}

function cloneCompletenessDiagnostic(
  diagnosticValue: WorkbookCommitCompletenessDiagnostic,
): WorkbookCommitCompletenessDiagnostic {
  return {
    code: diagnosticValue.code,
    severity: diagnosticValue.severity,
    message: diagnosticValue.message,
    ...(diagnosticValue.path === undefined ? {} : { path: diagnosticValue.path }),
    ...(diagnosticValue.details === undefined ? {} : { details: { ...diagnosticValue.details } }),
  };
}

function isVersionObjectRecord(value: unknown): value is VersionObjectRecord<unknown> {
  return (
    isPlainRecord(value) &&
    isPlainRecord(value.preimage) &&
    typeof value.preimage.objectType === 'string' &&
    isPlainRecord(value.digest) &&
    typeof value.payloadByteLength === 'number' &&
    typeof value.preimageByteLength === 'number'
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
