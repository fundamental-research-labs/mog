import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type ObjectDigest, type WorkbookCommitId } from './object-digest';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import {
  REF_NAMESPACES,
  parseRefName,
  validateRefName,
  type RefName,
  type RefNameDiagnostic,
  type RefNamespace,
} from './ref-name';

export type ProviderEpoch =
  | { readonly kind: 'counter'; readonly value: string }
  | { readonly kind: 'opaque'; readonly value: string };

export type RefVersion = { readonly kind: 'counter'; readonly value: string };

export type VersionDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface VersionDiagnostic {
  readonly code: string;
  readonly severity: VersionDiagnosticSeverity;
  readonly message: string;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly refVersion?: RefVersion;
  readonly refIncarnationId?: string;
  readonly previousRefIncarnationId?: string;
  readonly tombstoneRefVersion?: RefVersion;
  readonly operationId?: string;
  readonly objectDigest?: ObjectDigest;
  readonly details?: Record<string, string | boolean>;
}

export type VersionErrorCode =
  | 'invalidRefName'
  | 'invalidRefPrefix'
  | 'invalidCommitId'
  | 'invalidRefVersion'
  | 'unsupportedRefOption'
  | 'protectedRef'
  | 'refAlreadyExists'
  | 'refNotFound'
  | 'refTombstoned'
  | 'expectedHeadMismatch'
  | 'expectedRefVersionMismatch'
  | 'unsupportedRefMetadataMutation'
  | 'lastLiveRef'
  | 'versionCapabilityDisabled';

export interface VersionApiError {
  readonly code: VersionErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly VersionDiagnostic[];
}

export interface RefMutationConflict {
  readonly code:
    | 'expectedHeadMismatch'
    | 'expectedRefVersionMismatch'
    | 'expectedPreviousRefIncarnationIdMismatch'
    | 'refAlreadyExists'
    | 'refTombstoned';
  readonly expectedHead?: WorkbookCommitId;
  readonly actualHead?: WorkbookCommitId;
  readonly expectedRefVersion?: RefVersion;
  readonly actualRefVersion?: RefVersion;
  readonly actualRefIncarnationId?: string;
  readonly expectedPreviousRefIncarnationId?: string;
  readonly actualPreviousRefIncarnationId?: string;
  readonly tombstoneRefVersion?: RefVersion;
  readonly previousRefIncarnationId?: string;
}

export interface RefFailureResult {
  readonly ok: false;
  readonly error: VersionApiError;
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface LiveRefRecord {
  readonly state: 'live';
  readonly schemaVersion: 1;
  readonly versionDocumentId: string;
  readonly name: RefName;
  readonly kind: 'branch';
  readonly targetCommitId: WorkbookCommitId;
  readonly baseCommitId?: WorkbookCommitId;
  readonly providerRefId: string;
  readonly providerEpoch: ProviderEpoch;
  readonly refIncarnationId: string;
  readonly protected: boolean;
  readonly createdAt: string;
  readonly createdBy: VersionAuthor;
  readonly updatedAt: string;
  readonly updatedBy: VersionAuthor;
  readonly refVersion: RefVersion;
}

export interface TombstoneRefRecord {
  readonly state: 'tombstone';
  readonly schemaVersion: 1;
  readonly versionDocumentId: string;
  readonly name: RefName;
  readonly previousTargetCommitId: WorkbookCommitId;
  readonly previousProviderRefId: string;
  readonly previousProviderEpoch: ProviderEpoch;
  readonly previousRefIncarnationId: string;
  readonly deletedAt: string;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
  readonly deleteDiagnostics?: readonly VersionDiagnostic[];
  readonly refVersion: RefVersion;
}

export type RefRecord = LiveRefRecord | TombstoneRefRecord;

export interface InitializeMainInput {
  readonly targetCommitId: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly protected?: boolean;
}

export interface CreateBranchInput {
  readonly name: RefName | string;
  readonly targetCommitId: WorkbookCommitId | string;
  readonly expectedAbsent: true;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly protected?: boolean;
}

export interface UpdateRefInput {
  readonly name: RefName | string;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly expectedRefVersion: RefVersion;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly updatedBy: VersionAuthor;
}

export interface DeleteRefInput {
  readonly name: RefName | string;
  readonly expectedRefVersion: RefVersion;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
  readonly deleteDiagnostics?: readonly VersionDiagnostic[];
}

export interface ListRefsInput {
  readonly includeTombstones?: boolean;
  readonly prefix?: RefNamespace;
}

export type GetRefResult =
  | { readonly ok: true; readonly ref: LiveRefRecord | null; readonly diagnostics: readonly [] }
  | RefFailureResult;

export type ListRefsResult =
  | {
      readonly ok: true;
      readonly includeTombstones: false;
      readonly refs: readonly LiveRefRecord[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: true;
      readonly includeTombstones: true;
      readonly refs: readonly RefRecord[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly error: VersionApiError;
      readonly diagnostics: readonly VersionDiagnostic[];
    };

export type RefMutationResult =
  | { readonly ok: true; readonly ref: LiveRefRecord; readonly diagnostics: readonly [] }
  | RefFailureResult;

export type CreateBranchResult =
  | {
      readonly ok: true;
      readonly ref: LiveRefRecord;
      readonly attached: false;
      readonly diagnostics: readonly [];
    }
  | RefFailureResult;

export type DeleteRefResult =
  | { readonly ok: true; readonly ref: TombstoneRefRecord; readonly diagnostics: readonly [] }
  | RefFailureResult;

export interface InMemoryRefStoreOptions {
  readonly versionDocumentId: string;
  readonly now?: () => Date | string;
  readonly snapshot?: InMemoryRefStoreSnapshot;
}

const REF_VERSION_VALUE_RE = /^(0|[1-9][0-9]*)$/;
const RFC3339_MILLISECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class RefStoreValidationError extends Error {
  readonly code: VersionErrorCode;
  readonly diagnostics: readonly VersionDiagnostic[];

  constructor(code: VersionErrorCode, message: string, diagnostics: readonly VersionDiagnostic[]) {
    super(message);
    this.name = 'RefStoreValidationError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class InMemoryRefStore {
  private readonly records = new Map<string, RefRecord>();
  private readonly versionDocumentId: string;
  private readonly nowFn: () => Date | string;
  private nextGeneratedId = 0;
  // In-memory summary-row equivalent; durable backends need equivalent CAS before enabling delete.
  private liveRefCount = 0;

  constructor(options: InMemoryRefStoreOptions) {
    this.versionDocumentId = options.versionDocumentId;
    this.nowFn = options.now ?? (() => new Date());
    if (options.snapshot) {
      for (const record of options.snapshot.records) {
        if (record.versionDocumentId !== this.versionDocumentId) {
          throw new RefStoreValidationError('invalidRefName', 'Ref snapshot document mismatch.', [
            diagnostic('invalidRefName', 'Ref snapshot document mismatch.'),
          ]);
        }
        this.records.set(
          record.name,
          record.state === 'live' ? cloneLiveRefRecord(record) : cloneTombstoneRefRecord(record),
        );
      }
      this.liveRefCount = [...this.records.values()].filter(
        (record) => record.state === 'live',
      ).length;
      this.nextGeneratedId = options.snapshot.nextGeneratedId;
    }
  }

  exportSnapshot(): InMemoryRefStoreSnapshot {
    return Object.freeze({
      records: Object.freeze(
        [...this.records.values()]
          .sort((left, right) => compareAscii(left.name, right.name))
          .map((record) =>
            record.state === 'live' ? cloneLiveRefRecord(record) : cloneTombstoneRefRecord(record),
          ),
      ),
      nextGeneratedId: this.nextGeneratedId,
      liveRefCount: this.liveRefCount,
    });
  }

  initializeMain(input: InitializeMainInput): RefMutationResult {
    const targetCommitId = parseCommitForResult(input.targetCommitId, 'targetCommitId');
    if (!targetCommitId.ok) return targetCommitId.result;

    const baseCommitId =
      input.baseCommitId === undefined
        ? undefined
        : parseCommitForResult(input.baseCommitId, 'baseCommitId');
    if (baseCommitId !== undefined && !baseCommitId.ok) return baseCommitId.result;

    const name = parseRefName('main');
    const existing = this.records.get(name);
    if (existing?.state === 'live') {
      return refAlreadyExists(existing);
    }
    if (existing?.state === 'tombstone') {
      return refTombstoned(existing);
    }

    const now = this.now();
    const ref = freezeLiveRefRecord({
      state: 'live',
      schemaVersion: 1,
      versionDocumentId: this.versionDocumentId,
      name,
      kind: 'branch',
      targetCommitId: targetCommitId.commitId,
      baseCommitId: baseCommitId?.commitId,
      providerRefId: this.generateId('provider-ref'),
      providerEpoch: freezeProviderEpoch({ kind: 'counter', value: '0' }),
      refIncarnationId: this.generateId('ref-incarnation'),
      protected: input.protected ?? true,
      createdAt: now,
      createdBy: copyAuthor(input.createdBy),
      updatedAt: now,
      updatedBy: copyAuthor(input.createdBy),
      refVersion: freezeRefVersion({ kind: 'counter', value: '0' }),
    });

    this.records.set(name, ref);
    this.liveRefCount += 1;
    return { ok: true, ref: cloneLiveRefRecord(ref), diagnostics: [] };
  }

  createBranch(input: CreateBranchInput): CreateBranchResult {
    const parsedName = parseRefNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    if (input.expectedAbsent !== true) {
      return failure('unsupportedRefOption', 'createBranch requires expectedAbsent: true.', [
        diagnostic(
          'unsupportedRefOption',
          'createBranch requires expectedAbsent: true.',
          parsedName.name,
        ),
      ]);
    }

    if (parsedName.name === 'main') {
      return failure('protectedRef', 'main can only be created by root/import initialization.', [
        diagnostic(
          'protectedRef',
          'main can only be created by root/import initialization.',
          'main',
        ),
      ]);
    }

    const targetCommitId = parseCommitForResult(input.targetCommitId, 'targetCommitId');
    if (!targetCommitId.ok) return targetCommitId.result;

    const baseCommitId =
      input.baseCommitId === undefined
        ? undefined
        : parseCommitForResult(input.baseCommitId, 'baseCommitId');
    if (baseCommitId !== undefined && !baseCommitId.ok) return baseCommitId.result;

    const existing = this.records.get(parsedName.name);
    if (existing?.state === 'live') {
      return refAlreadyExists(existing);
    }
    if (existing?.state === 'tombstone') {
      return refTombstoned(existing);
    }

    const now = this.now();
    const ref = freezeLiveRefRecord({
      state: 'live',
      schemaVersion: 1,
      versionDocumentId: this.versionDocumentId,
      name: parsedName.name,
      kind: 'branch',
      targetCommitId: targetCommitId.commitId,
      baseCommitId: baseCommitId?.commitId,
      providerRefId: this.generateId('provider-ref'),
      providerEpoch: freezeProviderEpoch({ kind: 'counter', value: '0' }),
      refIncarnationId: this.generateId('ref-incarnation'),
      protected: input.protected ?? false,
      createdAt: now,
      createdBy: copyAuthor(input.createdBy),
      updatedAt: now,
      updatedBy: copyAuthor(input.createdBy),
      refVersion: freezeRefVersion({ kind: 'counter', value: '0' }),
    });

    this.records.set(parsedName.name, ref);
    this.liveRefCount += 1;
    return { ok: true, ref: cloneLiveRefRecord(ref), attached: false, diagnostics: [] };
  }

  getRef(name: RefName | string): GetRefResult {
    const parsedName = parseRefNameForResult(name);
    if (!parsedName.ok) return parsedName.result;

    const record = this.records.get(parsedName.name);
    if (record === undefined) {
      return { ok: true, ref: null, diagnostics: [] };
    }
    if (record.state === 'tombstone') {
      return refTombstoned(record);
    }
    return { ok: true, ref: cloneLiveRefRecord(record), diagnostics: [] };
  }

  listRefs(input: ListRefsInput = {}): ListRefsResult {
    const prefix = input.prefix;
    if (prefix !== undefined && !isRefNamespace(prefix)) {
      const diagnostics = [
        diagnostic(
          'invalidRefPrefix',
          'Ref list prefix must be scenario, agent, import, or review.',
          String(prefix),
        ),
      ];
      return failure('invalidRefPrefix', 'Invalid ref namespace prefix.', diagnostics);
    }

    const liveRefs = [...this.records.values()]
      .filter((record): record is LiveRefRecord => record.state === 'live')
      .filter((record) => matchesPrefix(record.name, prefix))
      .sort(compareLiveRefs)
      .map(cloneLiveRefRecord);

    if (input.includeTombstones !== true) {
      return {
        ok: true,
        includeTombstones: false,
        refs: liveRefs,
        diagnostics: [],
      };
    }

    const tombstones = [...this.records.values()]
      .filter((record): record is TombstoneRefRecord => record.state === 'tombstone')
      .filter((record) => matchesPrefix(record.name, prefix))
      .sort(compareTombstoneRefs)
      .map(cloneTombstoneRefRecord);

    return {
      ok: true,
      includeTombstones: true,
      refs: [...liveRefs, ...tombstones],
      diagnostics: [],
    };
  }

  updateRef(input: UpdateRefInput): RefMutationResult {
    return this.updateRefInternal(input, false);
  }

  advanceRefForGraphWrite(input: UpdateRefInput): RefMutationResult {
    return this.updateRefInternal(input, true);
  }

  private updateRefInternal(input: UpdateRefInput, allowProtected: boolean): RefMutationResult {
    const parsedName = parseRefNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    const nextCommitId = parseCommitForResult(input.nextCommitId, 'nextCommitId');
    if (!nextCommitId.ok) return nextCommitId.result;

    const expectedHead =
      input.expectedHead === undefined
        ? undefined
        : parseCommitForResult(input.expectedHead, 'expectedHead');
    if (expectedHead !== undefined && !expectedHead.ok) return expectedHead.result;

    const expectedRefVersion = parseRefVersionForResult(input.expectedRefVersion);
    if (!expectedRefVersion.ok) return expectedRefVersion.result;

    const record = this.records.get(parsedName.name);
    if (record === undefined) {
      return refNotFound(parsedName.name);
    }
    if (record.state === 'tombstone') {
      return refTombstoned(record);
    }
    if (record.protected && !allowProtected) {
      return protectedRef(record.name, 'update');
    }
    if (expectedHead !== undefined && record.targetCommitId !== expectedHead.commitId) {
      return expectedHeadMismatch(record, expectedHead.commitId);
    }
    if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
      return expectedRefVersionMismatch(record, expectedRefVersion.refVersion);
    }
    if (record.targetCommitId === nextCommitId.commitId) {
      const diagnostics = [
        diagnostic(
          'unsupportedRefMetadataMutation',
          'Ref metadata-only mutation is not supported in VC-05.',
          record.name,
          record.targetCommitId,
          record.refVersion,
        ),
      ];
      return failure(
        'unsupportedRefMetadataMutation',
        'Ref metadata-only mutation is not supported in VC-05.',
        diagnostics,
      );
    }

    const updated = freezeLiveRefRecord({
      ...record,
      targetCommitId: nextCommitId.commitId,
      updatedAt: this.now(),
      updatedBy: copyAuthor(input.updatedBy),
      refVersion: nextRefVersion(record.refVersion),
    });

    this.records.set(record.name, updated);
    return { ok: true, ref: cloneLiveRefRecord(updated), diagnostics: [] };
  }

  deleteRef(input: DeleteRefInput): DeleteRefResult {
    const parsedName = parseRefNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    const expectedHead =
      input.expectedHead === undefined
        ? undefined
        : parseCommitForResult(input.expectedHead, 'expectedHead');
    if (expectedHead !== undefined && !expectedHead.ok) return expectedHead.result;

    const expectedRefVersion = parseRefVersionForResult(input.expectedRefVersion);
    if (!expectedRefVersion.ok) return expectedRefVersion.result;

    const record = this.records.get(parsedName.name);
    if (record === undefined) {
      return refNotFound(parsedName.name);
    }
    if (record.state === 'tombstone') {
      return refTombstoned(record);
    }
    if (record.protected) {
      return protectedRef(record.name, 'delete');
    }
    if (this.liveRefCount <= 1) {
      const diagnostics = [
        diagnostic('lastLiveRef', 'Deleting the last live ref is not supported.', record.name),
      ];
      return failure('lastLiveRef', 'Deleting the last live ref is not supported.', diagnostics);
    }
    if (expectedHead !== undefined && record.targetCommitId !== expectedHead.commitId) {
      return expectedHeadMismatch(record, expectedHead.commitId);
    }
    if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
      return expectedRefVersionMismatch(record, expectedRefVersion.refVersion);
    }

    const tombstone = freezeTombstoneRefRecord({
      state: 'tombstone',
      schemaVersion: 1,
      versionDocumentId: this.versionDocumentId,
      name: record.name,
      previousTargetCommitId: record.targetCommitId,
      previousProviderRefId: record.providerRefId,
      previousProviderEpoch: cloneProviderEpoch(record.providerEpoch),
      previousRefIncarnationId: record.refIncarnationId,
      deletedAt: this.now(),
      deletedBy: copyAuthor(input.deletedBy),
      deleteReason: input.deleteReason,
      deleteDiagnostics: input.deleteDiagnostics?.map(cloneDiagnostic),
      refVersion: nextRefVersion(record.refVersion),
    });

    this.records.set(record.name, tombstone);
    this.liveRefCount -= 1;
    return { ok: true, ref: cloneTombstoneRefRecord(tombstone), diagnostics: [] };
  }

  private now(): string {
    return normalizeRfc3339Milliseconds(this.nowFn());
  }

  private generateId(prefix: string): string {
    this.nextGeneratedId += 1;
    return `${prefix}:${this.versionDocumentId}:${this.nextGeneratedId}`;
  }
}

export function createInMemoryRefStore(options: InMemoryRefStoreOptions): InMemoryRefStore {
  return new InMemoryRefStore(options);
}

export function parseRefVersion(value: unknown, paramName = 'refVersion'): RefVersion {
  if (!isPlainRecord(value)) {
    throw new RefStoreValidationError(
      'invalidRefVersion',
      `${paramName} must be a structured RefVersion.`,
      [diagnostic('invalidRefVersion', `${paramName} must be a structured RefVersion.`)],
    );
  }
  if (
    value.kind !== 'counter' ||
    typeof value.value !== 'string' ||
    !REF_VERSION_VALUE_RE.test(value.value)
  ) {
    throw new RefStoreValidationError(
      'invalidRefVersion',
      `${paramName} must be { kind: "counter", value: <non-negative base-10 integer> }.`,
      [
        diagnostic(
          'invalidRefVersion',
          `${paramName} must be { kind: "counter", value: <non-negative base-10 integer> }.`,
        ),
      ],
    );
  }

  return freezeRefVersion({ kind: 'counter', value: value.value });
}

export function normalizePersistedRefVersion(value: unknown, paramName = 'refVersion'): RefVersion {
  if (typeof value === 'string' && value.startsWith('rv:n:')) {
    return parseRefVersion({ kind: 'counter', value: value.slice('rv:n:'.length) }, paramName);
  }
  return parseRefVersion(value, paramName);
}

export function encodeRefVersionKey(refVersion: RefVersion): `rv:n:${string}` {
  const parsed = parseRefVersion(refVersion);
  return `rv:n:${parsed.value}`;
}

export function refVersionsEqual(left: RefVersion, right: RefVersion): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function parseRefNameForResult(
  value: RefName | string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: RefFailureResult } {
  const parsed = validateRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  const diagnostics = refNameDiagnosticsToVersionDiagnostics(parsed.diagnostics);
  return {
    ok: false,
    result: failure('invalidRefName', 'Invalid ref name.', diagnostics),
  };
}

function parseCommitForResult(
  value: WorkbookCommitId | string,
  paramName: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: RefFailureResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, paramName) };
  } catch {
    const diagnostics = [
      diagnostic(
        'invalidCommitId',
        `${paramName} must be commit:sha256:<64 lowercase hex>.`,
        undefined,
      ),
    ];
    return {
      ok: false,
      result: failure('invalidCommitId', `Invalid ${paramName}.`, diagnostics),
    };
  }
}

function parseRefVersionForResult(
  value: RefVersion,
):
  | { readonly ok: true; readonly refVersion: RefVersion }
  | { readonly ok: false; readonly result: RefFailureResult } {
  try {
    return { ok: true, refVersion: parseRefVersion(value) };
  } catch (error) {
    const diagnostics =
      error instanceof RefStoreValidationError
        ? error.diagnostics
        : [diagnostic('invalidRefVersion', 'Invalid RefVersion.')];
    return {
      ok: false,
      result: failure('invalidRefVersion', 'Invalid RefVersion.', diagnostics),
    };
  }
}

function refAlreadyExists(record: LiveRefRecord): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'refAlreadyExists',
      `Ref ${record.name} already exists.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure('refAlreadyExists', `Ref ${record.name} already exists.`, diagnostics, {
    code: 'refAlreadyExists',
    actualHead: record.targetCommitId,
    actualRefVersion: cloneRefVersion(record.refVersion),
    actualRefIncarnationId: record.refIncarnationId,
  });
}

function refTombstoned(record: TombstoneRefRecord): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'refTombstoned',
      `Ref ${record.name} is tombstoned.`,
      record.name,
      record.previousTargetCommitId,
      record.refVersion,
      undefined,
      record.previousRefIncarnationId,
      record.refVersion,
    ),
  ];
  return failure('refTombstoned', `Ref ${record.name} is tombstoned.`, diagnostics, {
    code: 'refTombstoned',
    tombstoneRefVersion: cloneRefVersion(record.refVersion),
    previousRefIncarnationId: record.previousRefIncarnationId,
  });
}

function refNotFound(name: RefName): RefFailureResult {
  const diagnostics = [diagnostic('refNotFound', `Ref ${name} does not exist.`, name)];
  return failure('refNotFound', `Ref ${name} does not exist.`, diagnostics);
}

function protectedRef(name: RefName, action: 'update' | 'delete'): RefFailureResult {
  const diagnostics = [
    diagnostic('protectedRef', `Protected ref ${name} cannot be ${action}d.`, name),
  ];
  return failure('protectedRef', `Protected ref ${name} cannot be ${action}d.`, diagnostics);
}

function expectedHeadMismatch(
  record: LiveRefRecord,
  expectedHead: WorkbookCommitId,
): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'expectedHeadMismatch',
      `Ref ${record.name} is at a different head than expected.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure(
    'expectedHeadMismatch',
    `Ref ${record.name} is at a different head than expected.`,
    diagnostics,
    {
      code: 'expectedHeadMismatch',
      expectedHead,
      actualHead: record.targetCommitId,
      actualRefVersion: cloneRefVersion(record.refVersion),
      actualRefIncarnationId: record.refIncarnationId,
    },
  );
}

function expectedRefVersionMismatch(
  record: LiveRefRecord,
  expectedRefVersion: RefVersion,
): RefFailureResult {
  const diagnostics = [
    diagnostic(
      'expectedRefVersionMismatch',
      `Ref ${record.name} is at a different version than expected.`,
      record.name,
      record.targetCommitId,
      record.refVersion,
      record.refIncarnationId,
    ),
  ];
  return failure(
    'expectedRefVersionMismatch',
    `Ref ${record.name} is at a different version than expected.`,
    diagnostics,
    {
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: cloneRefVersion(expectedRefVersion),
      actualRefVersion: cloneRefVersion(record.refVersion),
      actualHead: record.targetCommitId,
      actualRefIncarnationId: record.refIncarnationId,
    },
  );
}

function failure(
  code: VersionErrorCode,
  message: string,
  diagnostics: readonly VersionDiagnostic[],
  conflict?: RefMutationConflict,
): RefFailureResult {
  return {
    ok: false,
    error: {
      code,
      message,
      diagnostics,
    },
    conflict,
    diagnostics,
  };
}

function refNameDiagnosticsToVersionDiagnostics(
  diagnostics: readonly RefNameDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(
      item.code,
      item.message,
      item.value,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        issue: item.issue,
      },
    ),
  );
}

function diagnostic(
  code: string,
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
  refVersion?: RefVersion,
  refIncarnationId?: string,
  previousRefIncarnationId?: string,
  tombstoneRefVersion?: RefVersion,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    refName,
    commitId,
    refVersion: refVersion === undefined ? undefined : cloneRefVersion(refVersion),
    refIncarnationId,
    previousRefIncarnationId,
    tombstoneRefVersion:
      tombstoneRefVersion === undefined ? undefined : cloneRefVersion(tombstoneRefVersion),
    details: details === undefined ? undefined : Object.freeze({ ...details }),
  });
}

function matchesPrefix(name: RefName, prefix: RefNamespace | undefined): boolean {
  if (prefix === undefined) {
    return true;
  }
  return name.startsWith(`${prefix}/`);
}

function isRefNamespace(value: unknown): value is RefNamespace {
  return typeof value === 'string' && (REF_NAMESPACES as readonly string[]).includes(value);
}

function compareLiveRefs(left: LiveRefRecord, right: LiveRefRecord): number {
  return compareAscii(left.name, right.name);
}

function compareTombstoneRefs(left: TombstoneRefRecord, right: TombstoneRefRecord): number {
  const leftDeletedAt = Date.parse(left.deletedAt);
  const rightDeletedAt = Date.parse(right.deletedAt);
  if (leftDeletedAt !== rightDeletedAt) {
    return rightDeletedAt - leftDeletedAt;
  }

  const nameCompare = compareAscii(left.name, right.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return compareCounterValues(left.refVersion.value, right.refVersion.value);
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCounterValues(left: string, right: string): number {
  const trimmedLeft = left.replace(/^0+(?=\d)/, '');
  const trimmedRight = right.replace(/^0+(?=\d)/, '');
  if (trimmedLeft.length !== trimmedRight.length) {
    return trimmedLeft.length - trimmedRight.length;
  }
  return compareAscii(trimmedLeft, trimmedRight);
}

function nextRefVersion(current: RefVersion): RefVersion {
  return freezeRefVersion({ kind: 'counter', value: incrementDecimalString(current.value) });
}

function incrementDecimalString(value: string): string {
  let carry = 1;
  let result = '';

  for (let i = value.length - 1; i >= 0; i--) {
    const digit = value.charCodeAt(i) - 48 + carry;
    if (digit === 10) {
      result = `0${result}`;
      carry = 1;
    } else {
      result = `${digit}${result}`;
      carry = 0;
    }
  }

  return carry === 1 ? `1${result}` : result;
}

function normalizeRfc3339Milliseconds(value: Date | string): string {
  const timestamp = typeof value === 'string' ? value : value.toISOString();
  if (!RFC3339_MILLISECONDS_RE.test(timestamp)) {
    throw new RefStoreValidationError(
      'versionCapabilityDisabled',
      'Ref store clock must return an RFC 3339 UTC timestamp with millisecond precision.',
      [
        diagnostic(
          'invalidTimestamp',
          'Ref store clock must return an RFC 3339 UTC timestamp with millisecond precision.',
        ),
      ],
    );
  }
  return timestamp;
}

function freezeLiveRefRecord(record: LiveRefRecord): LiveRefRecord {
  return Object.freeze({
    ...record,
    providerEpoch: freezeProviderEpoch(record.providerEpoch),
    refVersion: freezeRefVersion(record.refVersion),
    createdBy: copyAuthor(record.createdBy),
    updatedBy: copyAuthor(record.updatedBy),
  });
}

function freezeTombstoneRefRecord(record: TombstoneRefRecord): TombstoneRefRecord {
  return Object.freeze({
    ...record,
    previousProviderEpoch: freezeProviderEpoch(record.previousProviderEpoch),
    refVersion: freezeRefVersion(record.refVersion),
    deletedBy: copyAuthor(record.deletedBy),
    deleteDiagnostics: record.deleteDiagnostics?.map(cloneDiagnostic),
  });
}

function cloneLiveRefRecord(record: LiveRefRecord): LiveRefRecord {
  return freezeLiveRefRecord({ ...record });
}

function cloneTombstoneRefRecord(record: TombstoneRefRecord): TombstoneRefRecord {
  return freezeTombstoneRefRecord({ ...record });
}

function freezeProviderEpoch(providerEpoch: ProviderEpoch): ProviderEpoch {
  return Object.freeze({ ...providerEpoch });
}

function cloneProviderEpoch(providerEpoch: ProviderEpoch): ProviderEpoch {
  return freezeProviderEpoch(providerEpoch);
}

function freezeRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return freezeRefVersion(refVersion);
}

function cloneDiagnostic(item: VersionDiagnostic): VersionDiagnostic {
  return diagnostic(
    item.code,
    item.message,
    item.refName,
    item.commitId,
    item.refVersion,
    item.refIncarnationId,
    item.previousRefIncarnationId,
    item.tombstoneRefVersion,
    item.details,
  );
}

function copyAuthor(author: VersionAuthor): VersionAuthor {
  return Object.freeze({ ...author });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
