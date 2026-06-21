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
      author,
      createdAt,
      completenessDiagnostics,
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
  const unsupportedPayloadKey = Object.keys(payload).find(
    (key) =>
      ![
        'schemaVersion',
        'documentId',
        'parentCommitIds',
        'snapshotRootDigest',
        'semanticChangeSetDigest',
        'mutationSegmentDigests',
        'author',
        'createdAt',
        'completenessDiagnostics',
        'redactionSummaryDigest',
        'verificationSummaryDigest',
      ].includes(key),
  );
  if (unsupportedPayloadKey !== undefined) {
    return {
      ok: false,
      diagnostics: [
        diagnostic('VERSION_INVALID_COMMIT_PAYLOAD', 'Commit payload has an unsupported field.', {
          details: { path: unsupportedPayloadKey },
        }),
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
  const author = parseVersionAuthor(payload.author, 'author', diagnostics);
  const createdAt = parseString(payload.createdAt, 'createdAt', diagnostics);
  const completenessDiagnostics = parseCompletenessDiagnostics(
    payload.completenessDiagnostics,
    'completenessDiagnostics',
    diagnostics,
  );

  if (
    diagnostics.length > 0 ||
    snapshotRootDigest === undefined ||
    semanticChangeSetDigest === undefined ||
    author === undefined ||
    createdAt === undefined ||
    completenessDiagnostics === undefined
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
      author,
      createdAt,
      completenessDiagnostics,
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

function parseVersionAuthor(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionAuthor | undefined {
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(`${path}`, 'Commit author must be an object.'));
    return undefined;
  }

  const unsupportedKey = Object.keys(value).find(
    (key) => !['authorId', 'actorKind', 'displayName', 'clientId', 'sessionId'].includes(key),
  );
  if (unsupportedKey !== undefined) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${unsupportedKey}`,
        'Commit author has an unsupported field.',
      ),
    );
    return undefined;
  }

  const authorId = parseString(value.authorId, `${path}.authorId`, diagnostics);
  const actorKind = parseVersionActorKind(value.actorKind, `${path}.actorKind`, diagnostics);
  const displayName = parseOptionalString(value.displayName, `${path}.displayName`, diagnostics);
  const clientId = parseOptionalString(value.clientId, `${path}.clientId`, diagnostics);
  const sessionId = parseOptionalString(value.sessionId, `${path}.sessionId`, diagnostics);

  if (authorId === undefined || actorKind === undefined) {
    return undefined;
  }

  return {
    authorId,
    actorKind,
    ...(displayName === undefined ? {} : { displayName }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function parseVersionActorKind(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): VersionAuthor['actorKind'] | undefined {
  if (
    value === 'user' ||
    value === 'service' ||
    value === 'system' ||
    value === 'migration' ||
    value === 'automation'
  ) {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Commit author actorKind is invalid.'));
  return undefined;
}

function parseCompletenessDiagnostics(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): readonly WorkbookCommitCompletenessDiagnostic[] | undefined {
  const diagnosticStart = diagnostics.length;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostics must be an array.'));
    return undefined;
  }

  const parsed: WorkbookCommitCompletenessDiagnostic[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = parseCompletenessDiagnostic(value[index], `${path}[${index}]`, diagnostics);
    if (item !== undefined) {
      parsed.push(item);
    }
  }
  return diagnostics.length > diagnosticStart ? undefined : parsed;
}

function parseCompletenessDiagnostic(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): WorkbookCommitCompletenessDiagnostic | undefined {
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostic must be an object.'));
    return undefined;
  }

  const unsupportedKey = Object.keys(value).find(
    (key) => !['code', 'severity', 'message', 'path', 'details'].includes(key),
  );
  if (unsupportedKey !== undefined) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${unsupportedKey}`,
        'Completeness diagnostic has an unsupported field.',
      ),
    );
    return undefined;
  }

  const code = parseString(value.code, `${path}.code`, diagnostics);
  const severity = parseCompletenessSeverity(value.severity, `${path}.severity`, diagnostics);
  const message = parseString(value.message, `${path}.message`, diagnostics);
  const diagnosticPath = parseOptionalString(value.path, `${path}.path`, diagnostics);
  const details = parseOptionalDiagnosticDetails(value.details, `${path}.details`, diagnostics);

  if (code === undefined || severity === undefined || message === undefined) {
    return undefined;
  }

  return {
    code,
    severity,
    message,
    ...(diagnosticPath === undefined ? {} : { path: diagnosticPath }),
    ...(details === undefined ? {} : { details }),
  };
}

function parseCompletenessSeverity(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): WorkbookCommitCompletenessDiagnostic['severity'] | undefined {
  if (value === 'info' || value === 'warning' || value === 'error') {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostic severity is invalid.'));
  return undefined;
}

function parseOptionalDiagnosticDetails(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Diagnostic details must be an object.'));
    return undefined;
  }

  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, detailValue] of Object.entries(value)) {
    if (
      detailValue === null ||
      typeof detailValue === 'string' ||
      typeof detailValue === 'boolean' ||
      (typeof detailValue === 'number' && Number.isFinite(detailValue))
    ) {
      details[key] = detailValue;
      continue;
    }
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${key}`,
        'Diagnostic detail values must be string, number, boolean, or null.',
      ),
    );
  }
  return details;
}

function parseString(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Commit payload field must be a string.'));
  return undefined;
}

function parseOptionalString(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseString(value, path, diagnostics);
}

function invalidPayloadDiagnostic(path: string, message: string): WorkbookCommitStoreDiagnostic {
  return diagnostic('VERSION_INVALID_COMMIT_PAYLOAD', message, { details: { path } });
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
