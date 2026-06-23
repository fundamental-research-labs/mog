import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import { diagnostic, failure } from './ref-store-diagnostics';
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
  cloneTombstoneRefRecord,
  copyAuthor,
  freezeLiveRefRecord,
  freezeProviderEpoch,
  freezeRefVersion,
  freezeTombstoneRefRecord,
  nextProviderEpoch,
  nextRefVersion,
  refVersionsEqual,
} from './ref-store-revisions';
import {
  normalizeLiveRefRecordTimestamps,
  normalizeRfc3339Milliseconds,
  normalizeTombstoneRefRecordTimestamp,
} from './ref-store-timestamps';
import {
  expectedHeadMismatch,
  expectedRefVersionMismatch,
  protectedRef,
  refAlreadyExists,
  refNotFound,
  unsupportedRefMetadataMutation,
} from './ref-store-conflicts';
import { refTombstoned, validateTombstoneReuseMetadata } from './ref-store-tombstones';
import {
  parseCommitForResult,
  parseRefNameForResult,
  parseRefVersionForResult,
} from './ref-store-validation';
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
        const parsedName = parseCanonicalRefName(record.name);
        if (!parsedName.ok) {
          throw new RefStoreValidationError(
            'invalidRefName',
            'Invalid ref name in snapshot.',
            parsedName.diagnostics,
          );
        }
        if (record.versionDocumentId !== this.versionDocumentId) {
          throw new RefStoreValidationError('invalidRefName', 'Ref snapshot document mismatch.', [
            diagnostic('invalidRefName', 'Ref snapshot document mismatch.'),
          ]);
        }
        const normalizedRecord =
          record.state === 'live'
            ? normalizeLiveRefRecordTimestamps({ ...record, name: parsedName.name })
            : normalizeTombstoneRefRecordTimestamp({ ...record, name: parsedName.name });
        this.records.set(
          parsedName.name,
          normalizedRecord.state === 'live'
            ? cloneLiveRefRecord(normalizedRecord)
            : cloneTombstoneRefRecord(normalizedRecord),
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
  getRef(name: RefName | string, options: GetRefWithTombstoneOptions): GetRefWithTombstoneResult;
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
      return unsupportedRefMetadataMutation(record);
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
    return normalizeRfc3339Milliseconds(this.nowFn(), 'now');
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
