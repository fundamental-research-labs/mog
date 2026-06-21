import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import { VersionObjectStoreError, type InMemoryVersionObjectStore } from './object-store';
import type { WorkbookCommitPayload, WorkbookCommitStoreDiagnostic } from './commit-store';

type ParentCommitIdsResult =
  | { readonly ok: true; readonly parentCommitIds: readonly WorkbookCommitId[] }
  | { readonly ok: false; readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[] };

export function parseVc04ParentCommitIds(value: unknown): ParentCommitIdsResult {
  if (!Array.isArray(value)) {
    return failed([
      diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit parentCommitIds must be an array.'),
    ]);
  }
  if (value.length > 1) {
    return failed([
      diagnostic(
        'VERSION_UNSUPPORTED_PARENT_COMMIT',
        'VC-04 supports root commits and single-parent forward commits only.',
        { details: { parentCommitCount: value.length } },
      ),
    ]);
  }
  if (value.length === 0) {
    return { ok: true, parentCommitIds: [] };
  }

  try {
    return {
      ok: true,
      parentCommitIds: [parseWorkbookCommitId(value[0], 'parentCommitIds[0]')],
    };
  } catch {
    return failed([
      diagnostic('VERSION_INVALID_COMMIT_ID', 'Parent commit id must be commit:sha256:<64 hex>.'),
    ]);
  }
}

export async function validateVc04ParentCommitClosureForCreate(
  objectStore: InMemoryVersionObjectStore,
  value: readonly (WorkbookCommitId | string)[],
): Promise<ParentCommitIdsResult> {
  const parsed = parseVc04ParentCommitIds(value);
  if (!parsed.ok || parsed.parentCommitIds.length === 0) {
    return parsed;
  }

  const parentCommitId = parsed.parentCommitIds[0];
  const parentDependency = commitDependency(parentCommitId);
  try {
    const parentRecord = await objectStore.getObjectRecord<WorkbookCommitPayload>(parentDependency);
    const dependencyDiagnostics: WorkbookCommitStoreDiagnostic[] = [];
    for (const dependency of parentRecord.preimage.dependencies) {
      if (!(await objectStore.hasObject(dependency))) {
        dependencyDiagnostics.push(missingDependencyDiagnostic(dependency));
      }
    }
    if (dependencyDiagnostics.length > 0) {
      return failed(dependencyDiagnostics);
    }
  } catch (error) {
    if (
      error instanceof VersionObjectStoreError &&
      error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
    ) {
      return failed([
        diagnostic('VERSION_MISSING_PARENT', 'Parent commit object is missing.', {
          commitId: parentCommitId,
          dependency: parentDependency,
        }),
      ]);
    }
    return failed([
      diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Parent commit validation failed.', {
        commitId: parentCommitId,
        sourceDiagnostics:
          error instanceof VersionObjectStoreError ? [error.diagnostic] : undefined,
      }),
    ]);
  }

  return parsed;
}

function missingDependencyDiagnostic(
  dependency: VersionDependencyRef,
): WorkbookCommitStoreDiagnostic {
  return diagnostic(
    dependency.kind === 'commit' ? 'VERSION_MISSING_PARENT' : 'VERSION_MISSING_DEPENDENCY',
    dependency.kind === 'commit'
      ? 'Parent commit closure has a missing parent.'
      : 'Parent commit closure has a missing dependency.',
    { dependency },
  );
}

function commitDependency(commitId: WorkbookCommitId): VersionDependencyRef {
  return {
    kind: 'commit',
    commitId,
    digest: objectDigestFromWorkbookCommitId(commitId),
  };
}

function failed(diagnostics: readonly WorkbookCommitStoreDiagnostic[]): ParentCommitIdsResult {
  return { ok: false, diagnostics };
}

function diagnostic(
  code: WorkbookCommitStoreDiagnostic['code'],
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
