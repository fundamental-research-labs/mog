import type {
  VersionMainRefName,
  VersionRefName,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionRevertTarget,
  VersionStoreDiagnostic,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import { mapCommitId, mapPublicRevision, mapPublicTargetRef } from '../../version-attempt-metadata';
import {
  invalidProviderPayloadDiagnostic,
  mapProviderDiagnostics,
  mapProviderFailureDiagnostics,
  providerErrorDiagnostic,
} from './version-revert-provider-diagnostics';
import { isPositiveInteger, isRecord } from './version-revert-provider-shape';

export function mapRevertProviderResult(
  value: unknown,
  input: VersionRevertInput,
  options: VersionRevertOptions,
):
  | { readonly ok: true; readonly value: VersionRevertResult }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (isRecord(value) && value.ok === true) {
    return mapRevertProviderResult(value.value, input, options);
  }
  if (isRecord(value) && value.ok === false) {
    return {
      ok: false,
      diagnostics: mapProviderFailureDiagnostics(value, input),
    };
  }
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }

  const status = value.status;
  if (status === 'failed' || status === 'blocked' || status === 'degraded') {
    return { ok: false, diagnostics: mapProviderFailureDiagnostics(value, input) };
  }

  if (
    status !== 'planned' &&
    status !== 'applied' &&
    status !== 'rejected' &&
    status !== 'requires-review'
  ) {
    return { ok: false, diagnostics: [invalidProviderPayloadDiagnostic()] };
  }

  const target = mapProviderTarget(value.target, input.target);
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapProviderDiagnostics(value.diagnostics, input)
    : [];
  const mutationGuarantee = toRevertMutationGuarantee(value.mutationGuarantee, status, options);
  const commitRef = withInputTargetRef(
    mapWorkbookCommitRef(value.commitRef ?? value.commit),
    input,
  );
  const reviewInvalidationIds = mapOptionalStringArray(value.reviewInvalidationIds);

  if (
    !target ||
    !mutationGuarantee ||
    (value.commitRef !== undefined && !commitRef) ||
    (value.commit !== undefined && !commitRef) ||
    (value.reviewInvalidationIds !== undefined && !reviewInvalidationIds) ||
    (status === 'applied' && !commitRef)
  ) {
    return {
      ok: false,
      diagnostics: [...diagnostics, invalidProviderPayloadDiagnostic()],
    };
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      status,
      target,
      ...(commitRef ? { commitRef } : {}),
      ...(reviewInvalidationIds ? { reviewInvalidationIds } : {}),
      diagnostics,
      mutationGuarantee,
    },
  };
}

function mapProviderTarget(
  value: unknown,
  fallback: VersionRevertTarget,
): VersionRevertTarget | null {
  if (value === undefined) return fallback;
  if (!isRecord(value) || Array.isArray(value)) return null;

  if (value.kind === 'commit') {
    const commitId = mapCommitId(value.commitId);
    return commitId ? { kind: 'commit', commitId } : null;
  }
  if (value.kind === 'range') {
    const baseCommitId = mapCommitId(value.baseCommitId);
    const headCommitId = mapCommitId(value.headCommitId);
    return baseCommitId && headCommitId ? { kind: 'range', baseCommitId, headCommitId } : null;
  }
  if (value.kind === 'mergeCommit') {
    const commitId = mapCommitId(value.commitId);
    return commitId && isPositiveInteger(value.mainlineParent)
      ? { kind: 'mergeCommit', commitId, mainlineParent: value.mainlineParent }
      : null;
  }
  return null;
}

function mapWorkbookCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = mapCommitId(value.id);
  if (!id) return null;

  const refName = value.refName === undefined ? undefined : mapPublicTargetRef(value.refName);
  const resolvedFrom =
    value.resolvedFrom === undefined ? undefined : mapPublicRefSelector(value.resolvedFrom);
  const refRevision =
    value.refRevision === undefined ? undefined : mapPublicRevision(value.refRevision);
  if (
    (value.refName !== undefined && !refName) ||
    (value.resolvedFrom !== undefined && !resolvedFrom) ||
    (value.refRevision !== undefined && !refRevision)
  ) {
    return null;
  }

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function withInputTargetRef(
  commitRef: WorkbookCommitRef | null,
  input: VersionRevertInput,
): WorkbookCommitRef | null {
  if (!commitRef) return null;
  const targetRef = mapPublicTargetRef(input.targetRef);
  if (!targetRef) return commitRef;
  if (commitRef.refName && commitRef.refName !== targetRef) return commitRef;

  return {
    ...commitRef,
    refName: commitRef.refName ?? targetRef,
    resolvedFrom: commitRef.resolvedFrom ?? targetRef,
  };
}

function mapPublicRefSelector(
  value: unknown,
): 'HEAD' | VersionMainRefName | VersionRefName | undefined {
  if (value === 'HEAD') return 'HEAD';
  return mapPublicTargetRef(value);
}

function mapOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? Object.freeze([...value])
    : undefined;
}

function toRevertMutationGuarantee(
  value: unknown,
  status: VersionRevertResult['status'],
  options: VersionRevertOptions,
): VersionRevertResult['mutationGuarantee'] | undefined {
  if (
    value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'revert-commit-created' ||
    value === 'unknown-after-crash'
  ) {
    return value;
  }
  if (value !== undefined) return undefined;
  if (status === 'planned') return 'no-write-attempted';
  if (status === 'applied') return 'revert-commit-created';
  return options.dryRun === true ? 'no-write-attempted' : 'ref-not-mutated';
}
