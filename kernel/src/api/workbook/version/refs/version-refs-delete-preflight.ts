import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { toVersionRefRecordRevision } from './version-refs-diagnostics';
import {
  activeRefDeleteDiagnostic,
  danglingRefDiagnostic,
  lastLiveRefDiagnostic,
  mapGraphFailureDiagnostics,
  mapPreflightBranchFailureDiagnostics,
  preflightInvalidPayloadDiagnostic,
  preflightReadFailedDiagnostic,
  protectedRefDiagnostic,
  staleDeleteRefDiagnostic,
} from './version-refs-delete-diagnostics';
import { parsePublicBranchName } from './version-refs-delete-options';
import { mapBranchRecord } from './version-refs-delete-results';
import { getActiveCheckoutSessionReader } from './version-refs-delete-service';
import {
  isRecord,
  revisionsEqual,
  toCommitId,
  VERSION_HEAD_REF,
  type ActiveRefProjection,
  type DeleteCapableVersionRefLifecycleService,
  type DeletePreflightRef,
  type DeleteRefOperation,
  type ProviderReadProjection,
  type ValidatedDeleteRefOptions,
} from './version-refs-delete-types';

export async function preflightDeleteRef(
  ctx: DocumentContext,
  service: DeleteCapableVersionRefLifecycleService,
  input: ValidatedDeleteRefOptions,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const activeDiagnostics = await activeRefDeleteDiagnostics(ctx, service, input, operation);
  if (activeDiagnostics.length > 0) return activeDiagnostics;

  const ref = await readDeletePreflightRef(service, input, operation);
  if (ref.status === 'missing') return ref.diagnostics;
  if (ref.status !== 'checked') return [];

  if (ref.protected) return [protectedRefDiagnostic(operation)];

  if (input.expectedHead && input.expectedHead !== ref.commitId) {
    return [
      staleDeleteRefDiagnostic(operation, 'expectedHeadMismatch', {
        commitId: ref.commitId,
        revision: ref.revision,
      }),
    ];
  }
  if (!revisionsEqual(input.expectedRefVersion, ref.revision)) {
    return [
      staleDeleteRefDiagnostic(operation, 'expectedRefVersionMismatch', {
        commitId: ref.commitId,
        revision: ref.revision,
      }),
    ];
  }
  return lastLiveRefDeleteDiagnostics(service, input, operation);
}

async function lastLiveRefDeleteDiagnostics(
  service: DeleteCapableVersionRefLifecycleService,
  input: ValidatedDeleteRefOptions,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  if (!service.listBranches) return [];
  let value: unknown;
  try {
    value = await service.listBranches({});
  } catch {
    return [preflightReadFailedDiagnostic(operation, 'liveRefList')];
  }
  if (!isRecord(value)) return [preflightInvalidPayloadDiagnostic(operation)];
  if (value.ok === false) return mapPreflightBranchFailureDiagnostics(value, operation);
  const rawItems = Array.isArray(value.branches)
    ? value.branches
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.refs)
        ? value.refs
        : null;
  if (!rawItems) return [preflightInvalidPayloadDiagnostic(operation)];
  const liveRefs = rawItems.map(mapBranchRecord).filter((ref) => Boolean(ref));
  return liveRefs.length <= 1 && liveRefs.some((ref) => ref?.name === input.refName)
    ? [lastLiveRefDiagnostic(operation)]
    : [];
}

async function activeRefDeleteDiagnostics(
  ctx: DocumentContext,
  service: DeleteCapableVersionRefLifecycleService,
  input: ValidatedDeleteRefOptions,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const activeSessionReader = getActiveCheckoutSessionReader(ctx, service);
  if (activeSessionReader) {
    try {
      const activeRef = activeCheckoutSessionRefName(await activeSessionReader(), operation);
      if (activeRef.status === 'blocked') return activeRef.diagnostics;
      const activeRefName = activeRef.refName;
      if (activeRefName && activeRefName === input.refName) {
        return [activeRefDeleteDiagnostic(operation)];
      }
    } catch {
      return [preflightReadFailedDiagnostic(operation, 'activeCheckoutSession')];
    }
  }

  const headReader = service.getHead ?? service.readHead;
  if (!headReader) return [];
  try {
    const head = currentHeadRefName(await headReader(), operation);
    if (head.status === 'blocked') return head.diagnostics;
    const headRefName = head.refName;
    return headRefName === input.refName ? [activeRefDeleteDiagnostic(operation)] : [];
  } catch {
    return [preflightReadFailedDiagnostic(operation, 'currentHead')];
  }
}

async function readDeletePreflightRef(
  service: DeleteCapableVersionRefLifecycleService,
  input: ValidatedDeleteRefOptions,
  operation: DeleteRefOperation,
): Promise<DeletePreflightRef> {
  if (service.readBranch) {
    try {
      return projectBranchRead(await service.readBranch({ name: input.branchName }), operation);
    } catch {
      return { status: 'missing', diagnostics: [preflightReadFailedDiagnostic(operation, 'ref')] };
    }
  }
  if (service.readRef) {
    try {
      return projectRefRead(await service.readRef(input.refName), operation);
    } catch {
      return { status: 'missing', diagnostics: [preflightReadFailedDiagnostic(operation, 'ref')] };
    }
  }
  return { status: 'unchecked' };
}

function projectBranchRead(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value)) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  if (value.ok === false) {
    return {
      status: 'missing',
      diagnostics: mapPreflightBranchFailureDiagnostics(value, operation),
    };
  }
  if (value.ok !== true) return projectRefRead(value, operation);
  if (value.branch === null) {
    return { status: 'missing', diagnostics: [danglingRefDiagnostic(operation)] };
  }
  const ref =
    isRecord(value.branch) && isRecord(value.branch.ref) ? value.branch.ref : value.branch;
  return projectLiveRefRecord(ref, operation);
}

function projectRefRead(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value)) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  if (value.status === 'degraded' || value.status === 'failed') {
    return {
      status: 'missing',
      diagnostics: mapGraphFailureDiagnostics(value, operation),
    };
  }
  const ref =
    value.status === 'success' && isRecord(value.ref)
      ? value.ref
      : isRecord(value.ref)
        ? value.ref
        : value;
  return projectLiveRefRecord(ref, operation);
}

function projectLiveRefRecord(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value) || value.name === VERSION_HEAD_REF) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  const commitId =
    toCommitId(value.targetCommitId) ??
    toCommitId(value.commitId) ??
    toCommitId(value.previousTargetCommitId);
  const revision = toVersionRefRecordRevision(value.refVersion, value.revision);
  if (!commitId || !revision) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  return { status: 'checked', commitId, revision, protected: value.protected === true };
}

function activeCheckoutSessionRefName(
  value: unknown,
  operation: DeleteRefOperation,
): ActiveRefProjection {
  const session = unwrapProviderReadValue(value, operation, 'activeCheckoutSession');
  if (session.status === 'blocked') return session;
  if (
    !isRecord(session.value) ||
    session.value.detached === true ||
    typeof session.value.branchName !== 'string'
  ) {
    return { status: 'ok', refName: null };
  }
  const parsed = parsePublicBranchName(session.value.branchName, 'readRef');
  return { status: 'ok', refName: parsed.ok ? parsed.refName : null };
}

function currentHeadRefName(value: unknown, operation: DeleteRefOperation): ActiveRefProjection {
  const read = unwrapProviderReadValue(value, operation, 'currentHead');
  if (read.status === 'blocked') return read;
  if (!isRecord(read.value)) return { status: 'ok', refName: null };
  const head = isRecord(read.value.head)
    ? read.value.head
    : isRecord(read.value.ref)
      ? read.value.ref
      : read.value;
  if (head.mode === 'detached') return { status: 'ok', refName: null };
  const candidate =
    typeof head.refName === 'string'
      ? head.refName
      : typeof head.branchName === 'string'
        ? head.branchName
        : typeof head.target === 'string'
          ? head.target
          : undefined;
  if (!candidate) return { status: 'ok', refName: null };
  const parsed = parsePublicBranchName(candidate, 'readRef');
  return { status: 'ok', refName: parsed.ok ? parsed.refName : null };
}

function unwrapProviderReadValue(
  value: unknown,
  operation: DeleteRefOperation,
  phase: 'activeCheckoutSession' | 'currentHead',
): ProviderReadProjection {
  if (!isRecord(value)) return { status: 'read', value };
  if (value.status === 'pending') {
    return {
      status: 'blocked',
      diagnostics: [preflightReadFailedDiagnostic(operation, `${phase}Pending`)],
    };
  }
  if (value.status === 'failed' || value.status === 'degraded') {
    return {
      status: 'blocked',
      diagnostics: [preflightReadFailedDiagnostic(operation, `${phase}Failed`)],
    };
  }
  if (value.status === 'success') {
    return {
      status: 'read',
      value: isRecord(value.session)
        ? value.session
        : isRecord(value.current)
          ? value.current
          : isRecord(value.value)
            ? value.value
            : value,
    };
  }
  return { status: 'read', value };
}
