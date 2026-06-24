import {
  activeRefDeleteRejected,
  branchFromLiveRef,
  branchFromTombstoneRef,
  casConflict,
  cloneRefVersion,
  diagnostic,
  failure,
  fromRefStoreFailure,
  unsupportedDetachedHead,
} from './branch-service-results';
import {
  parseBranchName,
  parseBranchNameForResult,
  parseCommitForResult,
  parseRefVersionForResult,
  visibleBranchFromLiveRef,
} from './branch-service-validation';
import { refNameStorageKey, type RefName } from './refs/ref-name';
import { createInMemoryRefStore, type VersionDiagnostic } from './refs/ref-store';
import type {
  BranchRecord,
  BranchRefName,
  BranchRefStore,
  CreateBranchInput,
  CreateBranchResult,
  CreateDetachedHeadInput,
  CreateDetachedHeadResult,
  DeleteBranchInput,
  DeleteBranchResult,
  FastForwardBranchInput,
  FastForwardBranchResult,
  GetBranchHeadResult,
  InMemoryBranchServiceOptions,
  ListBranchesInput,
  ListBranchesResult,
  ReadBranchInput,
  ReadBranchResult,
} from './branch-service-types';

export type {
  BranchFailureResult,
  BranchHead,
  BranchRecord,
  BranchRefName,
  BranchRefStore,
  BranchServiceError,
  BranchServiceErrorCode,
  CreateBranchInput,
  CreateBranchResult,
  CreateDetachedHeadInput,
  CreateDetachedHeadResult,
  DeleteBranchInput,
  DeleteBranchResult,
  DeletedBranchRecord,
  FastForwardBranchInput,
  FastForwardBranchResult,
  GetBranchHeadResult,
  InMemoryBranchServiceOptions,
  ListBranchesInput,
  ListBranchesResult,
  ReadBranchInput,
  ReadBranchResult,
} from './branch-service-types';

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

    if (this.headRefName === parsedName.name) {
      return activeRefDeleteRejected(parsedName.name);
    }

    if (input.expectedRefVersion === undefined) {
      return failure('missingExpectedRefVersion', 'Branch delete requires expectedRefVersion.', [
        diagnostic(
          'missingExpectedRefVersion',
          'Branch delete requires expectedRefVersion.',
          parsedName.name,
          undefined,
          undefined,
          undefined,
          { missingField: 'expectedRefVersion' },
        ),
      ]);
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
