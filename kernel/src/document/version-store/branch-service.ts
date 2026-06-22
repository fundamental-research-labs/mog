import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import {
  REF_NAME_STORAGE_PREFIX,
  refNameStorageKey,
  validateRefName,
  type RefName,
  type RefNameDiagnostic,
  type RefNamespace,
} from './ref-name';
import {
  createInMemoryRefStore,
  parseRefVersion,
  type CreateBranchResult as RefStoreCreateBranchResult,
  type DeleteRefResult as RefStoreDeleteRefResult,
  type GetRefResult as RefStoreGetRefResult,
  type ListRefsResult as RefStoreListRefsResult,
  type LiveRefRecord,
  type RefMutationConflict,
  type RefMutationResult as RefStoreMutationResult,
  type RefVersion,
  type TombstoneRefRecord,
  type VersionDiagnostic,
} from './ref-store';

export type BranchRefName = `${typeof REF_NAME_STORAGE_PREFIX}${string}`;

export type BranchServiceErrorCode =
  | 'invalidRefName'
  | 'invalidCommitId'
  | 'invalidRefVersion'
  | 'invalidRefPrefix'
  | 'reservedNamespace'
  | 'unsupportedDetachedHead'
  | 'unsupportedRefOption'
  | 'missingExpectedHead'
  | 'missingExpectedRefVersion'
  | 'casConflict'
  | 'protectedRef'
  | 'refAlreadyExists'
  | 'refNotFound'
  | 'refTombstoned'
  | 'lastLiveRef'
  | 'unsupportedRefMetadataMutation'
  | 'versionCapabilityDisabled';

export interface BranchServiceError {
  readonly code: BranchServiceErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly VersionDiagnostic[];
}

export interface BranchFailureResult {
  readonly ok: false;
  readonly error: BranchServiceError;
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface BranchRecord {
  readonly name: RefName;
  readonly refName: BranchRefName;
  readonly ref: LiveRefRecord;
}

export interface DeletedBranchRecord {
  readonly name: RefName;
  readonly refName: BranchRefName;
  readonly ref: TombstoneRefRecord;
}

export interface CreateBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly targetCommitId: WorkbookCommitId | string;
  readonly expectedAbsent: true;
  readonly baseCommitId?: WorkbookCommitId | string;
  readonly createdBy: VersionAuthor;
  readonly protected?: boolean;
}

export interface ReadBranchInput {
  readonly name: RefName | BranchRefName | string;
}

export interface ListBranchesInput {
  readonly prefix?: RefNamespace;
}

export interface FastForwardBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly nextCommitId: WorkbookCommitId | string;
  readonly expectedOldCommitId?: WorkbookCommitId | string;
  readonly expectedRefVersion?: RefVersion;
  readonly updatedBy: VersionAuthor;
}

export interface DeleteBranchInput {
  readonly name: RefName | BranchRefName | string;
  readonly expectedHead?: WorkbookCommitId | string;
  readonly expectedRefVersion?: RefVersion;
  readonly deletedBy: VersionAuthor;
  readonly deleteReason?: string;
}

export interface CreateDetachedHeadInput {
  readonly commitId: WorkbookCommitId | string;
}

export type CreateBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type ReadBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord | null;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type ListBranchesResult =
  | {
      readonly ok: true;
      readonly branches: readonly BranchRecord[];
      readonly diagnostics: readonly VersionDiagnostic[];
    }
  | BranchFailureResult;

export type FastForwardBranchResult =
  | {
      readonly ok: true;
      readonly branch: BranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type DeleteBranchResult =
  | {
      readonly ok: true;
      readonly branch: DeletedBranchRecord;
      readonly diagnostics: readonly [];
    }
  | BranchFailureResult;

export type CreateDetachedHeadResult = BranchFailureResult;

export type BranchHead =
  | {
      readonly mode: 'attached';
      readonly refName: BranchRefName;
      readonly branchName: RefName;
      readonly commitId: WorkbookCommitId;
      readonly refVersion: RefVersion;
      readonly refIncarnationId: string;
    }
  | {
      readonly mode: 'detached';
      readonly commitId: WorkbookCommitId;
      readonly materializationId: string;
    };

export type GetBranchHeadResult =
  | {
      readonly ok: true;
      readonly head: BranchHead | null;
      readonly diagnostics: readonly VersionDiagnostic[];
    }
  | BranchFailureResult;

export interface BranchRefStore {
  createBranch(input: {
    readonly name: RefName;
    readonly targetCommitId: WorkbookCommitId;
    readonly expectedAbsent: true;
    readonly baseCommitId?: WorkbookCommitId;
    readonly createdBy: VersionAuthor;
    readonly protected?: boolean;
  }): RefStoreCreateBranchResult;
  getRef(name: RefName): RefStoreGetRefResult;
  listRefs(input?: { readonly includeTombstones?: false; readonly prefix?: RefNamespace }):
    | RefStoreListRefsResult
    | {
        readonly ok: true;
        readonly includeTombstones: false;
        readonly refs: readonly LiveRefRecord[];
        readonly diagnostics: readonly VersionDiagnostic[];
      };
  updateRef(input: {
    readonly name: RefName;
    readonly nextCommitId: WorkbookCommitId;
    readonly expectedHead: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly updatedBy: VersionAuthor;
  }): RefStoreMutationResult;
  deleteRef(input: {
    readonly name: RefName;
    readonly expectedHead?: WorkbookCommitId;
    readonly expectedRefVersion: RefVersion;
    readonly deletedBy: VersionAuthor;
    readonly deleteReason?: string;
  }): RefStoreDeleteRefResult;
}

export interface InMemoryBranchServiceOptions {
  readonly refStore?: BranchRefStore;
  readonly headRefName?: RefName | BranchRefName | string | null;
}

const RESERVED_REF_PREFIXES = Object.freeze(['refs/system', 'refs/imports', 'refs/hidden']);

export class InMemoryBranchService {
  private readonly refStore: BranchRefStore;
  private readonly headRefName: RefName | null;

  constructor(options: InMemoryBranchServiceOptions = {}) {
    this.refStore =
      options.refStore ?? createInMemoryRefStore({ versionDocumentId: 'version-doc' });

    if (options.headRefName === null) {
      this.headRefName = null;
      return;
    }

    const parsedHead =
      options.headRefName === undefined
        ? parseBranchName('main')
        : parseBranchName(options.headRefName);
    this.headRefName = parsedHead.ok ? parsedHead.name : null;
  }

  createBranch(input: CreateBranchInput): CreateBranchResult {
    const parsedName = parseBranchNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    if (input.expectedAbsent !== true) {
      return failure('unsupportedRefOption', 'createBranch requires expectedAbsent: true.', [
        diagnostic(
          'missingExpectedAbsent',
          'createBranch requires expectedAbsent: true.',
          parsedName.name,
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

    const result = this.refStore.createBranch({
      name: parsedName.name,
      targetCommitId: targetCommitId.commitId,
      expectedAbsent: true,
      baseCommitId: baseCommitId?.commitId,
      createdBy: input.createdBy,
      protected: input.protected,
    });

    if (!result.ok) {
      return fromRefStoreFailure(result);
    }

    return { ok: true, branch: branchFromLiveRef(result.ref), diagnostics: [] };
  }

  createDetachedHead(input: CreateDetachedHeadInput): CreateDetachedHeadResult {
    const commit = parseCommitForResult(input.commitId, 'commitId');
    if (!commit.ok) return commit.result;

    return unsupportedDetachedHead(
      'Direct detached HEAD creation is not supported by the internal branch service.',
      undefined,
      commit.commitId,
    );
  }

  readBranch(input: ReadBranchInput | RefName | BranchRefName | string): ReadBranchResult {
    const name =
      typeof input === 'object' && input !== null && 'name' in input ? input.name : input;
    const parsedName = parseBranchNameForResult(name);
    if (!parsedName.ok) return parsedName.result;

    const result = this.refStore.getRef(parsedName.name);
    if (!result.ok) {
      return fromRefStoreFailure(result);
    }
    return {
      ok: true,
      branch: result.ref === null ? null : branchFromLiveRef(result.ref),
      diagnostics: [],
    };
  }

  listBranches(input: ListBranchesInput = {}): ListBranchesResult {
    const result = this.refStore.listRefs({
      includeTombstones: false,
      prefix: input.prefix,
    });
    if (!result.ok) {
      return fromRefStoreFailure(result);
    }

    const diagnostics: VersionDiagnostic[] = [];
    const branches: BranchRecord[] = [];
    for (const ref of result.refs) {
      if (ref.state !== 'live') {
        continue;
      }
      const visible = visibleBranchFromLiveRef(ref);
      if (visible.ok) {
        branches.push(visible.branch);
      } else {
        diagnostics.push(...visible.diagnostics);
      }
    }

    return { ok: true, branches, diagnostics };
  }

  fastForwardBranch(input: FastForwardBranchInput): FastForwardBranchResult {
    const parsedName = parseBranchNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    if (input.expectedOldCommitId === undefined) {
      return failure('missingExpectedHead', 'Fast-forward update requires expectedOldCommitId.', [
        diagnostic(
          'missingExpectedHead',
          'Fast-forward update requires expectedOldCommitId.',
          parsedName.name,
          undefined,
          undefined,
          undefined,
          { missingField: 'expectedOldCommitId' },
        ),
      ]);
    }

    if (input.expectedRefVersion === undefined) {
      return failure(
        'missingExpectedRefVersion',
        'Fast-forward update requires expectedRefVersion.',
        [
          diagnostic(
            'missingExpectedRefVersion',
            'Fast-forward update requires expectedRefVersion.',
            parsedName.name,
            undefined,
            undefined,
            undefined,
            { missingField: 'expectedRefVersion' },
          ),
        ],
      );
    }

    const nextCommitId = parseCommitForResult(input.nextCommitId, 'nextCommitId');
    if (!nextCommitId.ok) return nextCommitId.result;

    const expectedOldCommitId = parseCommitForResult(
      input.expectedOldCommitId,
      'expectedOldCommitId',
    );
    if (!expectedOldCommitId.ok) return expectedOldCommitId.result;

    const expectedRefVersion = parseRefVersionForResult(input.expectedRefVersion);
    if (!expectedRefVersion.ok) return expectedRefVersion.result;

    const result = this.refStore.updateRef({
      name: parsedName.name,
      nextCommitId: nextCommitId.commitId,
      expectedHead: expectedOldCommitId.commitId,
      expectedRefVersion: expectedRefVersion.refVersion,
      updatedBy: input.updatedBy,
    });

    if (!result.ok) {
      if (
        result.error.code === 'expectedHeadMismatch' ||
        result.error.code === 'expectedRefVersionMismatch'
      ) {
        return casConflict(parsedName.name, result);
      }
      return fromRefStoreFailure(result);
    }

    return { ok: true, branch: branchFromLiveRef(result.ref), diagnostics: [] };
  }

  deleteBranch(input: DeleteBranchInput): DeleteBranchResult {
    const parsedName = parseBranchNameForResult(input.name);
    if (!parsedName.ok) return parsedName.result;

    if (input.expectedRefVersion === undefined) {
      return failure(
        'missingExpectedRefVersion',
        'Branch delete requires expectedRefVersion.',
        [
          diagnostic(
            'missingExpectedRefVersion',
            'Branch delete requires expectedRefVersion.',
            parsedName.name,
            undefined,
            undefined,
            undefined,
            { missingField: 'expectedRefVersion' },
          ),
        ],
      );
    }

    const expectedHead =
      input.expectedHead === undefined
        ? undefined
        : parseCommitForResult(input.expectedHead, 'expectedHead');
    if (expectedHead !== undefined && !expectedHead.ok) return expectedHead.result;

    const expectedRefVersion = parseRefVersionForResult(input.expectedRefVersion);
    if (!expectedRefVersion.ok) return expectedRefVersion.result;

    const result = this.refStore.deleteRef({
      name: parsedName.name,
      ...(expectedHead ? { expectedHead: expectedHead.commitId } : {}),
      expectedRefVersion: expectedRefVersion.refVersion,
      deletedBy: input.deletedBy,
      ...(input.deleteReason ? { deleteReason: input.deleteReason } : {}),
    });

    if (!result.ok) {
      if (
        result.error.code === 'expectedHeadMismatch' ||
        result.error.code === 'expectedRefVersionMismatch'
      ) {
        return casConflict(parsedName.name, result);
      }
      return fromRefStoreFailure(result);
    }

    return { ok: true, branch: branchFromTombstoneRef(result.ref), diagnostics: [] };
  }

  getHead(): GetBranchHeadResult {
    if (this.headRefName === null) {
      return { ok: true, head: null, diagnostics: [] };
    }

    const result = this.refStore.getRef(this.headRefName);
    if (!result.ok) {
      return fromRefStoreFailure(result);
    }
    if (result.ref === null) {
      return failure('refNotFound', 'Symbolic HEAD points at a missing branch.', [
        diagnostic('refNotFound', 'Symbolic HEAD points at a missing branch.', this.headRefName),
      ]);
    }

    return {
      ok: true,
      head: {
        mode: 'attached',
        refName: refNameStorageKey(result.ref.name) as BranchRefName,
        branchName: result.ref.name,
        commitId: result.ref.targetCommitId,
        refVersion: cloneRefVersion(result.ref.refVersion),
        refIncarnationId: result.ref.refIncarnationId,
      },
      diagnostics: [],
    };
  }
}

export function createInMemoryBranchService(
  options: InMemoryBranchServiceOptions = {},
): InMemoryBranchService {
  return new InMemoryBranchService(options);
}

function parseBranchNameForResult(
  value: RefName | BranchRefName | string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  const parsed = parseBranchName(value);
  if (parsed.ok) {
    return parsed;
  }
  return { ok: false, result: parsed.result };
}

function parseBranchName(
  value: unknown,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  if (typeof value === 'string') {
    if (value === 'HEAD' || value === 'detached') {
      return {
        ok: false,
        result: unsupportedDetachedHead(
          'Detached HEAD is not a branch ref and cannot be created through this service.',
          value,
        ),
      };
    }

    const reservedNamespace = getReservedNamespace(value);
    if (reservedNamespace !== null) {
      return {
        ok: false,
        result: failure('reservedNamespace', 'Reserved ref namespace is not visible.', [
          diagnostic(
            'reservedNamespace',
            'Reserved ref namespace is not visible.',
            undefined,
            undefined,
            undefined,
            undefined,
            {
              namespace: reservedNamespace,
            },
          ),
        ]),
      };
    }

    if (value.startsWith(REF_NAME_STORAGE_PREFIX)) {
      return parseBranchRefName(value);
    }
  }

  const parsed = validateRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  return {
    ok: false,
    result: failure(
      'invalidRefName',
      'Invalid branch ref name.',
      refNameDiagnostics(parsed.diagnostics),
    ),
  };
}

function parseBranchRefName(
  value: string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  const suffix = value.slice(REF_NAME_STORAGE_PREFIX.length);
  const decoded = decodeBranchRefSuffix(suffix);
  if (!decoded.ok) {
    return {
      ok: false,
      result: failure('invalidRefName', 'Invalid branch ref name.', [
        diagnostic('invalidRefName', decoded.message, value),
      ]),
    };
  }

  const parsed = validateRefName(decoded.value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }
  return {
    ok: false,
    result: failure(
      'invalidRefName',
      'Invalid branch ref name.',
      refNameDiagnostics(parsed.diagnostics),
    ),
  };
}

function decodeBranchRefSuffix(
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  if (value.length === 0) {
    return { ok: false, message: 'refs/heads/* branch ref must include a branch name.' };
  }
  if (!value.includes('%')) {
    return { ok: true, value };
  }

  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return { ok: false, message: 'refs/heads/* branch ref contains invalid percent encoding.' };
  }
}

function getReservedNamespace(value: string): string | null {
  for (const prefix of RESERVED_REF_PREFIXES) {
    if (value === prefix || value.startsWith(`${prefix}/`)) {
      return prefix;
    }
  }
  if (value.startsWith('refs/') && !value.startsWith(REF_NAME_STORAGE_PREFIX)) {
    return 'refs/*';
  }
  return null;
}

function visibleBranchFromLiveRef(
  ref: LiveRefRecord,
):
  | { readonly ok: true; readonly branch: BranchRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] } {
  const parsed = parseBranchName(ref.name);
  if (parsed.ok) {
    return { ok: true, branch: branchFromLiveRef({ ...ref, name: parsed.name }) };
  }

  if (parsed.result.error.code === 'reservedNamespace') {
    return { ok: false, diagnostics: parsed.result.diagnostics };
  }

  return { ok: false, diagnostics: parsed.result.diagnostics };
}

function branchFromLiveRef(ref: LiveRefRecord): BranchRecord {
  const cloned = cloneLiveRefRecord(ref);
  return Object.freeze({
    name: cloned.name,
    refName: refNameStorageKey(cloned.name) as BranchRefName,
    ref: cloned,
  });
}

function branchFromTombstoneRef(ref: TombstoneRefRecord): DeletedBranchRecord {
  const cloned = cloneTombstoneRefRecord(ref);
  return Object.freeze({
    name: cloned.name,
    refName: refNameStorageKey(cloned.name) as BranchRefName,
    ref: cloned,
  });
}

function parseCommitForResult(
  value: WorkbookCommitId | string,
  paramName: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, paramName) };
  } catch {
    return {
      ok: false,
      result: failure('invalidCommitId', `Invalid ${paramName}.`, [
        diagnostic('invalidCommitId', `${paramName} must be commit:sha256:<64 lowercase hex>.`),
      ]),
    };
  }
}

function parseRefVersionForResult(
  value: RefVersion,
):
  | { readonly ok: true; readonly refVersion: RefVersion }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  try {
    return { ok: true, refVersion: parseRefVersion(value) };
  } catch {
    return {
      ok: false,
      result: failure('invalidRefVersion', 'Invalid RefVersion.', [
        diagnostic(
          'invalidRefVersion',
          'expectedRefVersion must be { kind: "counter", value: <non-negative base-10 integer> }.',
        ),
      ]),
    };
  }
}

function fromRefStoreFailure(result: {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
  readonly conflict?: RefMutationConflict;
  readonly diagnostics: readonly VersionDiagnostic[];
}): BranchFailureResult {
  return failure(
    branchErrorCodeFromRefStore(result.error.code),
    result.error.message,
    result.diagnostics,
    result.conflict,
  );
}

function casConflict(
  name: RefName,
  result: Extract<RefStoreMutationResult | RefStoreDeleteRefResult, { readonly ok: false }>,
): BranchFailureResult {
  return failure(
    'casConflict',
    'Branch compare-and-swap conflict.',
    [
      diagnostic(
        'casConflict',
        'Branch compare-and-swap conflict.',
        name,
        result.conflict?.actualHead,
        result.conflict?.actualRefVersion,
        result.conflict?.actualRefIncarnationId,
        { cause: result.error.code },
      ),
      ...result.diagnostics,
    ],
    result.conflict,
  );
}

function unsupportedDetachedHead(
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
): BranchFailureResult {
  return failure('unsupportedDetachedHead', message, [
    diagnostic('unsupportedDetachedHead', message, refName, commitId, undefined, undefined, {
      target: 'HEAD',
    }),
  ]);
}

function failure(
  code: BranchServiceErrorCode,
  message: string,
  diagnostics: readonly VersionDiagnostic[],
  conflict?: RefMutationConflict,
): BranchFailureResult {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, diagnostics }),
    conflict,
    diagnostics,
  });
}

function diagnostic(
  code: string,
  message: string,
  refName?: string,
  commitId?: WorkbookCommitId,
  refVersion?: RefVersion,
  refIncarnationId?: string,
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
    details: details === undefined ? undefined : Object.freeze({ ...details }),
  });
}

function refNameDiagnostics(
  diagnostics: readonly RefNameDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(item.code, item.message, item.value, undefined, undefined, undefined, {
      issue: item.issue,
    }),
  );
}

function branchErrorCodeFromRefStore(code: string): BranchServiceErrorCode {
  switch (code) {
    case 'invalidRefName':
    case 'invalidCommitId':
    case 'invalidRefVersion':
    case 'invalidRefPrefix':
    case 'protectedRef':
    case 'unsupportedRefOption':
    case 'refAlreadyExists':
    case 'refNotFound':
    case 'refTombstoned':
    case 'lastLiveRef':
    case 'unsupportedRefMetadataMutation':
    case 'versionCapabilityDisabled':
      return code;
    case 'expectedHeadMismatch':
    case 'expectedRefVersionMismatch':
      return 'casConflict';
    default:
      return 'versionCapabilityDisabled';
  }
}

function cloneLiveRefRecord(ref: LiveRefRecord): LiveRefRecord {
  return Object.freeze({
    ...ref,
    providerEpoch: Object.freeze({ ...ref.providerEpoch }),
    refVersion: cloneRefVersion(ref.refVersion),
    createdBy: Object.freeze({ ...ref.createdBy }),
    updatedBy: Object.freeze({ ...ref.updatedBy }),
  });
}

function cloneTombstoneRefRecord(ref: TombstoneRefRecord): TombstoneRefRecord {
  return Object.freeze({
    ...ref,
    previousProviderEpoch: Object.freeze({ ...ref.previousProviderEpoch }),
    refVersion: cloneRefVersion(ref.refVersion),
    deletedBy: Object.freeze({ ...ref.deletedBy }),
    deleteDiagnostics: ref.deleteDiagnostics?.map((item) => Object.freeze({ ...item })),
  });
}

function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}
