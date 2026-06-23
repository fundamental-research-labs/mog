import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  objectDigestFromWorkbookCommitId,
  parseObjectDigest,
  type ObjectDigest,
  type VersionDependencyRef,
  type VersionObjectType,
} from './object-digest';
import { cloneDigest } from './commit-store-utils';
import type { VersionObjectRecord } from './object-store';
import { parseWorkbookCommitParentIds } from './commit-store-parents';
import type {
  CreateWorkbookCommitInput,
  WorkbookCommitCompletenessDiagnostic,
  WorkbookCommitPayload,
  WorkbookCommitStoreDiagnostic,
  WorkbookCommitStoreDiagnosticCode,
} from './commit-store';

export type CommitDependencyRecords = {
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords: readonly VersionObjectRecord<unknown>[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
  readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
};

export function collectDependencyRecords(
  input: CreateWorkbookCommitInput,
): CommitDependencyRecords {
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

export function parseCommitPayload(
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
        'resolvedMergeAttemptDigest',
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
  const parentResult = parseWorkbookCommitParentIds(payload.parentCommitIds);
  if (!parentResult.ok) return { ok: false, diagnostics: parentResult.diagnostics };

  const diagnostics: WorkbookCommitStoreDiagnostic[] = [];
  const parentCommitIds = parentResult.parentCommitIds;
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
  const resolvedMergeAttemptDigest = parseOptionalDigest(
    payload.resolvedMergeAttemptDigest,
    'resolvedMergeAttemptDigest',
    diagnostics,
  );
  const author = parseVersionAuthor(payload.author, 'author', diagnostics);
  const createdAt = parseString(payload.createdAt, 'createdAt', diagnostics);
  const completenessDiagnostics = parseCompletenessDiagnostics(
    payload.completenessDiagnostics,
    'completenessDiagnostics',
    diagnostics,
  );
  if (resolvedMergeAttemptDigest !== undefined && parentCommitIds.length !== 2) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        'resolvedMergeAttemptDigest',
        'Resolved merge-attempt identity is valid only on two-parent merge commits.',
      ),
    );
  }

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
      parentCommitIds,
      snapshotRootDigest,
      semanticChangeSetDigest,
      ...(mutationSegmentDigests.length === 0 ? {} : { mutationSegmentDigests }),
      author,
      createdAt,
      completenessDiagnostics,
      ...(redactionSummaryDigest === undefined ? {} : { redactionSummaryDigest }),
      ...(verificationSummaryDigest === undefined ? {} : { verificationSummaryDigest }),
      ...(resolvedMergeAttemptDigest === undefined ? {} : { resolvedMergeAttemptDigest }),
    },
  };
}

export function dependenciesForPayload(
  payload: WorkbookCommitPayload,
): readonly VersionDependencyRef[] {
  return [
    ...payload.parentCommitIds.map(
      (commitId): VersionDependencyRef => ({
        kind: 'commit',
        commitId,
        digest: objectDigestFromWorkbookCommitId(commitId),
      }),
    ),
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
    ...(payload.resolvedMergeAttemptDigest === undefined
      ? []
      : [
          {
            kind: 'object',
            objectType: 'workbook.resolvedMergeAttempt.v1',
            digest: cloneDigest(payload.resolvedMergeAttemptDigest),
          } satisfies VersionDependencyRef,
        ]),
  ];
}

export function diagnostic(
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

export function parseVersionAuthor(
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

export function parseCompletenessDiagnostics(
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

export function parseString(
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
