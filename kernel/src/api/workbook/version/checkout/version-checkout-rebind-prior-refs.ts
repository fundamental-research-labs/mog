import {
  REF_NAME_STORAGE_PREFIX,
  validateRefName,
} from '../../../../document/version-store/refs/ref-name';
import { VersionCheckoutRebindIdentityError } from './version-checkout-rebind-errors';
import type { RebindIdentityErrorReason } from './version-checkout-rebind-types';
import {
  bindMethod,
  isThenable,
  isVersioningRecord,
  toCommitId,
} from './version-checkout-rebind-utils';

type PriorCheckoutSession =
  | {
      readonly checkedOutCommitId: string;
      readonly detached: true;
    }
  | {
      readonly checkedOutCommitId: string;
      readonly detached: false;
      readonly branchName: string;
      readonly refHeadAtMaterialization: string;
      readonly currentRefHeadId?: string;
    };

export function validatePriorCheckoutRefs(versioning: Record<string, unknown>): void {
  const readActiveCheckoutSession = activeCheckoutSessionReader(versioning);
  if (!readActiveCheckoutSession) return;

  const sessionValue = callPriorCheckoutRefReader(readActiveCheckoutSession);
  if (isThenable(sessionValue)) return;

  const session = parsePriorCheckoutSession(sessionValue);
  if (!session || session.detached) return;

  if (session.checkedOutCommitId !== session.refHeadAtMaterialization) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }
  if (
    session.currentRefHeadId !== undefined &&
    session.currentRefHeadId !== session.refHeadAtMaterialization
  ) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }

  const readRef = checkoutRefReader(versioning);
  if (!readRef) return;

  const refValue = callPriorCheckoutRefReader(() =>
    readRef(publicRefNameFromBranchName(session.branchName)),
  );
  if (isThenable(refValue)) return;

  const currentRefHeadId = projectRefHeadCommitId(refValue);
  if (!currentRefHeadId) {
    throw priorCheckoutRefError('priorCheckoutRefInvalid');
  }
  if (currentRefHeadId !== session.refHeadAtMaterialization) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }
}

function callPriorCheckoutRefReader(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }
}

function priorCheckoutRefError(
  reason: Extract<RebindIdentityErrorReason, 'priorCheckoutRefInvalid' | 'priorCheckoutRefStale'>,
): VersionCheckoutRebindIdentityError {
  return new VersionCheckoutRebindIdentityError(reason, 'ref');
}

function activeCheckoutSessionReader(versioning: Record<string, unknown>): (() => unknown) | null {
  for (const candidate of versioningServiceCandidates(versioning)) {
    const read =
      bindMethod(candidate, 'readActiveCheckoutSession') ??
      bindMethod(candidate, 'getActiveCheckoutSession');
    if (read) return () => read();
  }
  return null;
}

function checkoutRefReader(
  versioning: Record<string, unknown>,
): ((name: string) => unknown) | null {
  for (const candidate of [
    versioning.readService,
    versioning.writeService,
    versioning.commitService,
    versioning.publicService,
    versioning.refService,
    versioning,
  ]) {
    const read = bindMethod(candidate, 'readRef') ?? bindMethod(candidate, 'getRef');
    if (read) return (name) => read(name);
  }
  return null;
}

function versioningServiceCandidates(versioning: Record<string, unknown>): readonly unknown[] {
  return [
    versioning.surfaceStatusService,
    versioning.versionSurfaceStatusService,
    versioning.statusService,
    versioning.dirtyStatusService,
    versioning,
  ];
}

function parsePriorCheckoutSession(value: unknown): PriorCheckoutSession | null {
  if (value === null || value === undefined) return null;
  if (!isVersioningRecord(value)) {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  const checkedOutCommitId = toCommitId(value.checkedOutCommitId);
  if (!checkedOutCommitId || typeof value.detached !== 'boolean') {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  if (value.detached) {
    return Object.freeze({ checkedOutCommitId, detached: true });
  }

  const branchName = normalizeCheckoutBranchName(value.branchName ?? value.refName);
  const refHeadAtMaterialization = toCommitId(value.refHeadAtMaterialization);
  if (!branchName || !refHeadAtMaterialization) {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  let currentRefHeadId: string | undefined;
  if (value.currentRefHeadId !== undefined) {
    currentRefHeadId = toCommitId(value.currentRefHeadId) ?? undefined;
    if (!currentRefHeadId) {
      throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
    }
  }

  return Object.freeze({
    checkedOutCommitId,
    detached: false,
    branchName,
    refHeadAtMaterialization,
    ...(currentRefHeadId === undefined ? {} : { currentRefHeadId }),
  });
}

function projectRefHeadCommitId(value: unknown): string | null {
  if (!isVersioningRecord(value)) return null;
  if (value.status === 'success' && isVersioningRecord(value.ref)) {
    return projectRefHeadCommitId(value.ref);
  }
  if (value.ok === true && isVersioningRecord(value.ref)) {
    return projectRefHeadCommitId(value.ref);
  }
  if ('ref' in value) {
    return value.ref === null ? null : projectRefHeadCommitId(value.ref);
  }
  return toCommitId(value.commitId) ?? toCommitId(value.targetCommitId);
}

function normalizeCheckoutBranchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  return validateRefName(branchName).ok ? branchName : null;
}

function publicRefNameFromBranchName(branchName: string): string {
  return `${REF_NAME_STORAGE_PREFIX}${branchName}`;
}
