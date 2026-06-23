import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type ObjectDigest, type WorkbookCommitId } from './object-digest';
import { compareAscii, compareLiveRefs, compareTombstoneRefs } from './ref-store-ordering';
import {
  isCanonicalRefNamespace,
  matchesRefNamespacePrefix,
  parseCanonicalRefName,
} from './ref-store-ref-names';
import {
  RefStoreValidationError,
  cloneDiagnostic,
  cloneLiveRefRecord,
  cloneProviderEpoch,
  cloneRefVersion,
  cloneTombstoneRefRecord,
  copyAuthor,
  freezeLiveRefRecord,
  freezeProviderEpoch,
  freezeRefVersion,
  freezeTombstoneRefRecord,
  isPlainRecord,
  nextProviderEpoch,
  nextRefVersion,
  parseRefVersion,
  refVersionsEqual,
} from './ref-store-revisions';
export {
  RefStoreValidationError,
  encodeRefVersionKey,
  normalizePersistedRefVersion,
  parseRefVersion,
  refVersionsEqual,
} from './ref-store-revisions';
import type { InMemoryRefStoreSnapshot } from './ref-store-snapshot';
import { parseRefName, type RefName, type RefNamespace } from './ref-name';

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
  | 'expectedPreviousRefIncarnationIdMismatch'
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
  readonly reuseTombstone?: TombstoneRefReuseMetadata;
}

export interface TombstoneRefReuseMetadata {
  readonly expectedTombstoneRefVersion: RefVersion;
  readonly expectedPreviousRefIncarnationId: string;
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

export interface GetRefOptions {
  readonly includeTombstone?: false;
}

export interface GetRefWithTombstoneOptions {
  readonly includeTombstone: true;
}

export type GetRefResult =
  | { readonly ok: true; readonly ref: LiveRefRecord | null; readonly diagnostics: readonly [] }
  | RefFailureResult;

export type GetRefWithTombstoneResult =
  | {
      readonly ok: true;
      readonly includeTombstone: true;
      readonly ref: RefRecord | null;
      readonly diagnostics: readonly [];
    }
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

const RFC3339_MILLISECONDS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

    const ref = this.createLiveRef({
      name,
      targetCommitId: targetCommitId.commitId,
      baseCommitId: baseCommitId?.commitId,
      protected: input.protected ?? true,
      author: input.createdBy,
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
      const reuse = validateTombstoneReuseMetadata(existing, input.reuseTombstone);
      if (!reuse.ok) return reuse.result;
      const ref = this.createLiveRef({
        name: parsedName.name,
        targetCommitId: targetCommitId.commitId,
        baseCommitId: baseCommitId?.commitId,
        protected: input.protected ?? false,
        author: input.createdBy,
        providerEpoch: nextProviderEpoch(existing.previousProviderEpoch),
        refVersion: nextRefVersion(existing.refVersion),
      });

      this.records.set(parsedName.name, ref);
      this.liveRefCount += 1;
      return { ok: true, ref: cloneLiveRefRecord(ref), attached: false, diagnostics: [] };
    }

    const ref = this.createLiveRef({
      name: parsedName.name,
      targetCommitId: targetCommitId.commitId,
      baseCommitId: baseCommitId?.commitId,
      protected: input.protected ?? false,
      author: input.createdBy,
    });

    this.records.set(parsedName.name, ref);
    this.liveRefCount += 1;
    return { ok: true, ref: cloneLiveRefRecord(ref), attached: false, diagnostics: [] };
  }

  getRef(name: RefName | string): GetRefResult;
  getRef(name: RefName | string, options: GetRefOptions): GetRefResult;
  getRef(
    name: RefName | string,
    options: GetRefWithTombstoneOptions,
  ): GetRefWithTombstoneResult;
  getRef(
    name: RefName | string,
    options: GetRefOptions | GetRefWithTombstoneOptions = {},
  ): GetRefResult | GetRefWithTombstoneResult {
    const parsedName = parseRefNameForResult(name);
    if (!parsedName.ok) return parsedName.result;

    const record = this.records.get(parsedName.name);
    if (record === undefined) {
      if (options.includeTombstone === true) {
        return { ok: true, includeTombstone: true, ref: null, diagnostics: [] };
      }
      return { ok: true, ref: null, diagnostics: [] };
    }
    if (record.state === 'tombstone') {
      if (options.includeTombstone === true) {
        return {
          ok: true,
          includeTombstone: true,
          ref: cloneTombstoneRefRecord(record),
          diagnostics: [],
        };
      }
      return refTombstoned(record);
    }
    if (options.includeTombstone === true) {
      return {
        ok: true,
        includeTombstone: true,
        ref: cloneLiveRefRecord(record),
        diagnostics: [],
      };
    }
    return { ok: true, ref: cloneLiveRefRecord(record), diagnostics: [] };
  }

  listRefs(input: ListRefsInput = {}): ListRefsResult {
    const prefix = input.prefix;
    if (prefix !== undefined && !isCanonicalRefNamespace(prefix)) {
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
      .filter((record) => matchesRefNamespacePrefix(record.name, prefix))
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
      .filter((record) => matchesRefNamespacePrefix(record.name, prefix))
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

  private createLiveRef(input: {
    readonly name: RefName;
    readonly targetCommitId: WorkbookCommitId;
    readonly baseCommitId?: WorkbookCommitId;
    readonly protected: boolean;
    readonly author: VersionAuthor;
    readonly providerEpoch?: ProviderEpoch;
    readonly refVersion?: RefVersion;
  }): LiveRefRecord {
    const now = this.now();
    return freezeLiveRefRecord({
      state: 'live',
      schemaVersion: 1,
      versionDocumentId: this.versionDocumentId,
      name: input.name,
      kind: 'branch',
      targetCommitId: input.targetCommitId,
      baseCommitId: input.baseCommitId,
      providerRefId: this.generateId('provider-ref'),
      providerEpoch: input.providerEpoch ?? freezeProviderEpoch({ kind: 'counter', value: '0' }),
      refIncarnationId: this.generateId('ref-incarnation'),
      protected: input.protected,
      createdAt: now,
      createdBy: copyAuthor(input.author),
      updatedAt: now,
      updatedBy: copyAuthor(input.author),
      refVersion: input.refVersion ?? freezeRefVersion({ kind: 'counter', value: '0' }),
    });
  }

  private generateId(prefix: string): string {
    this.nextGeneratedId += 1;
    return `${prefix}:${this.versionDocumentId}:${this.nextGeneratedId}`;
  }
}

export function createInMemoryRefStore(options: InMemoryRefStoreOptions): InMemoryRefStore {
  return new InMemoryRefStore(options);
}

function parseRefNameForResult(
  value: RefName | string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: RefFailureResult } {
  const parsed = parseCanonicalRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  return {
    ok: false,
    result: failure('invalidRefName', 'Invalid ref name.', parsed.diagnostics),
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
  value: unknown,
  paramName = 'refVersion',
):
  | { readonly ok: true; readonly refVersion: RefVersion }
  | { readonly ok: false; readonly result: RefFailureResult } {
  try {
    return { ok: true, refVersion: parseRefVersion(value, paramName) };
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

function validateTombstoneReuseMetadata(
  record: TombstoneRefRecord,
  value: unknown,
): { readonly ok: true } | { readonly ok: false; readonly result: RefFailureResult } {
  if (value === undefined) return { ok: false, result: refTombstoned(record) };
  const message =
    'createBranch reuseTombstone requires expectedTombstoneRefVersion and expectedPreviousRefIncarnationId.';
  if (!isPlainRecord(value)) {
    return { ok: false, result: unsupportedTombstoneReuseMetadata(record, message) };
  }

  const expectedRefVersion = parseRefVersionForResult(
    value.expectedTombstoneRefVersion,
    'reuseTombstone.expectedTombstoneRefVersion',
  );
  if (!expectedRefVersion.ok) return expectedRefVersion;

  const expectedPreviousRefIncarnationId = value.expectedPreviousRefIncarnationId;
  if (
    typeof expectedPreviousRefIncarnationId !== 'string' ||
    expectedPreviousRefIncarnationId === ''
  ) {
    return { ok: false, result: unsupportedTombstoneReuseMetadata(record, message) };
  }
  if (!refVersionsEqual(record.refVersion, expectedRefVersion.refVersion)) {
    return {
      ok: false,
      result: expectedTombstoneRefVersionMismatch(record, expectedRefVersion.refVersion),
    };
  }
  if (record.previousRefIncarnationId !== expectedPreviousRefIncarnationId) {
    return {
      ok: false,
      result: expectedPreviousRefIncarnationIdMismatch(record, expectedPreviousRefIncarnationId),
    };
  }
  return { ok: true };
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
    tombstoneDiagnostic(
      record,
      'refTombstoned',
      `Ref ${record.name} is tombstoned.`,
    ),
  ];
  return failure('refTombstoned', `Ref ${record.name} is tombstoned.`, diagnostics, {
    code: 'refTombstoned',
    tombstoneRefVersion: cloneRefVersion(record.refVersion),
    previousRefIncarnationId: record.previousRefIncarnationId,
  });
}

function unsupportedTombstoneReuseMetadata(
  record: TombstoneRefRecord,
  message: string,
): RefFailureResult {
  return failure('unsupportedRefOption', message, [
    tombstoneDiagnostic(record, 'unsupportedRefOption', message, { option: 'reuseTombstone' }),
  ]);
}

function expectedTombstoneRefVersionMismatch(
  record: TombstoneRefRecord,
  expectedRefVersion: RefVersion,
): RefFailureResult {
  const message = `Tombstone for ref ${record.name} is at a different version than expected.`;
  return failure(
    'expectedRefVersionMismatch',
    message,
    [
      tombstoneDiagnostic(
        record,
        'expectedRefVersionMismatch',
        message,
      ),
    ],
    {
      code: 'expectedRefVersionMismatch',
      expectedRefVersion: cloneRefVersion(expectedRefVersion),
      actualRefVersion: cloneRefVersion(record.refVersion),
      tombstoneRefVersion: cloneRefVersion(record.refVersion),
      previousRefIncarnationId: record.previousRefIncarnationId,
    },
  );
}

function expectedPreviousRefIncarnationIdMismatch(
  record: TombstoneRefRecord,
  expectedPreviousRefIncarnationId: string,
): RefFailureResult {
  const message = `Tombstone for ref ${record.name} has a different previous incarnation than expected.`;
  return failure(
    'expectedPreviousRefIncarnationIdMismatch',
    message,
    [
      tombstoneDiagnostic(
        record,
        'expectedPreviousRefIncarnationIdMismatch',
        message,
        { expectedPreviousRefIncarnationId },
      ),
    ],
    {
      code: 'expectedPreviousRefIncarnationIdMismatch',
      expectedPreviousRefIncarnationId,
      actualPreviousRefIncarnationId: record.previousRefIncarnationId,
      tombstoneRefVersion: cloneRefVersion(record.refVersion),
      previousRefIncarnationId: record.previousRefIncarnationId,
    },
  );
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

function tombstoneDiagnostic(
  record: TombstoneRefRecord,
  code: string,
  message: string,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return diagnostic(
    code,
    message,
    record.name,
    record.previousTargetCommitId,
    record.refVersion,
    undefined,
    record.previousRefIncarnationId,
    record.refVersion,
    details,
  );
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
