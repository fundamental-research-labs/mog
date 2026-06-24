import type {
  VersionBranchRefReadResult,
  VersionRef,
  VersionRefListResult,
  VersionRefMutationResult,
  VersionSymbolicRef,
  VersionSymbolicRefReadResult,
} from '@mog-sdk/contracts/api';

import { VERSION_BRANCH_REF_PREFIX, VERSION_HEAD_REF } from './version-refs-constants';
import { toVersionRefRecordRevision } from './version-refs-diagnostics';
import {
  danglingRefDiagnostic,
  degradedList,
  degradedMutation,
  degradedRef,
  invalidPayloadDiagnostic,
  mapBranchFailureDiagnostics,
  mapOptionalBranchDiagnostics,
  providerErrorDiagnostic,
  type VersionRefOperation,
} from './version-refs-public-diagnostics';
import { parsePublicBranchName, type ParsedRefPrefix } from './version-refs-validation';
import { isRecord, toCommitId, toRevision } from './version-refs-values';

export function mapSymbolicHeadResult(value: unknown): VersionSymbolicRefReadResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false) {
    return degradedRef(
      null,
      mapBranchFailureDiagnostics(value.diagnostics, 'readRef'),
    ) as VersionSymbolicRefReadResult;
  }
  const ref = mapSymbolicHeadRecord('head' in value ? value.head : value);
  if (!ref) return null;
  const diagnostics = mapOptionalBranchDiagnostics(value.diagnostics, 'readRef');
  return diagnostics.length > 0
    ? ({ status: 'degraded', ref, diagnostics } as VersionSymbolicRefReadResult)
    : { status: 'success', ref, diagnostics: [] };
}

export function mapBranchReadResult(
  value: unknown,
  operation: VersionRefOperation,
): VersionBranchRefReadResult {
  if (!isRecord(value)) {
    return degradedRef(null, [providerErrorDiagnostic(operation)]) as VersionBranchRefReadResult;
  }
  if (value.ok === true) {
    if (value.branch === null) {
      return degradedRef(null, [danglingRefDiagnostic(operation)]) as VersionBranchRefReadResult;
    }
    const ref = mapBranchRecord(value.branch);
    if (ref) return { status: 'success', ref, diagnostics: [] };
    return degradedRef(null, [invalidPayloadDiagnostic(operation)]) as VersionBranchRefReadResult;
  }
  if (value.ok === false) {
    return degradedRef(
      null,
      mapBranchFailureDiagnostics(value.diagnostics, operation),
    ) as VersionBranchRefReadResult;
  }
  const publicRef = mapVersionRef(value.ref ?? value);
  if (publicRef) return { status: 'success', ref: publicRef, diagnostics: [] };
  return degradedRef(null, [providerErrorDiagnostic(operation)]) as VersionBranchRefReadResult;
}

export function mapBranchListResult(
  value: unknown,
  prefix: Extract<ParsedRefPrefix, { readonly ok: true }>,
): VersionRefListResult {
  if (!isRecord(value)) return degradedList([], [providerErrorDiagnostic('listRefs')]);
  if (value.ok === false) {
    return degradedList([], mapBranchFailureDiagnostics(value.diagnostics, 'listRefs'));
  }

  const rawItems = Array.isArray(value.branches)
    ? value.branches
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.refs)
        ? value.refs
        : null;
  if (!rawItems) return degradedList([], [invalidPayloadDiagnostic('listRefs')]);

  const diagnostics = mapOptionalBranchDiagnostics(value.diagnostics, 'listRefs');
  const items = rawItems
    .map(mapBranchRecord)
    .filter((ref): ref is VersionRef => Boolean(ref))
    .filter((ref) => refMatchesPrefix(ref, prefix))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (diagnostics.length > 0) return degradedList(items, diagnostics);
  return { status: 'success', items, diagnostics: [] };
}

export function mapBranchMutationResult(
  value: unknown,
  operation: VersionRefOperation,
): VersionRefMutationResult {
  if (!isRecord(value)) return degradedMutation(null, [providerErrorDiagnostic(operation)]);
  if (value.ok === false) {
    return degradedMutation(null, mapBranchFailureDiagnostics(value.diagnostics, operation));
  }
  const ref = mapBranchRecord(value.branch ?? value.ref ?? value);
  if (!ref) return degradedMutation(null, [invalidPayloadDiagnostic(operation)]);
  return { status: 'success', ref, diagnostics: [] };
}

function mapSymbolicHeadRecord(value: unknown): VersionSymbolicRef | null {
  if (!isRecord(value)) return null;
  const targetName =
    typeof value.branchName === 'string'
      ? value.branchName
      : typeof value.refName === 'string'
        ? value.refName
        : typeof value.target === 'string'
          ? value.target
          : undefined;
  const parsed = parsePublicBranchName(targetName, 'readRef');
  const revision = toVersionRefRecordRevision(value.refVersion, value.revision);
  if (!parsed.ok || !revision) return null;
  return { name: VERSION_HEAD_REF, target: parsed.refName, revision };
}

function mapBranchRecord(value: unknown): VersionRef | null {
  if (!isRecord(value)) return null;
  const liveRef = isRecord(value.ref) ? value.ref : value;
  const branchName =
    typeof value.name === 'string'
      ? value.name
      : typeof liveRef.name === 'string'
        ? liveRef.name
        : undefined;
  const commitId = toCommitId(liveRef.targetCommitId) ?? toCommitId(liveRef.commitId);
  const revision = toVersionRefRecordRevision(liveRef.refVersion, liveRef.revision);
  if (!branchName || !commitId || !revision) return mapVersionRef(value);
  const parsed = parsePublicBranchName(branchName, 'readRef');
  if (!parsed.ok) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof liveRef.updatedAt === 'string' ? { updatedAt: liveRef.updatedAt } : {}),
  };
}

function mapVersionRef(value: unknown): VersionRef | null {
  if (!isRecord(value)) return null;
  const parsed = parsePublicBranchName(value.name, 'readRef');
  const commitId = toCommitId(value.commitId);
  const revision = toRevision(value.revision);
  if (!parsed.ok || !commitId || !revision) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

function refMatchesPrefix(
  ref: VersionRef,
  prefix: Extract<ParsedRefPrefix, { readonly ok: true }>,
): boolean {
  if (prefix.prefix === undefined) return true;
  const branchName = ref.name.slice(VERSION_BRANCH_REF_PREFIX.length);
  if (prefix.prefix.endsWith('/')) return branchName.startsWith(prefix.prefix);
  return branchName === prefix.prefix || branchName.startsWith(`${prefix.prefix}/`);
}
