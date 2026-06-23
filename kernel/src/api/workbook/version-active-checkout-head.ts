import type {
  VersionDegradedHeadResult,
  VersionDiagnostic,
  VersionMainRefName,
  VersionRef,
  VersionRefName,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  degradedHead,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import {
  getAttachedVersionReadService,
  getAttachedVersionServices,
} from './version-service-attachments';
import {
  getAttachedVersionSurfaceStatusService,
  readVersionSurfaceCheckoutSession,
  type VersionSurfaceCheckoutSession,
} from './version-surface-status-service';

type ActiveCheckoutHeadResolution =
  | { readonly status: 'absent' }
  | {
      readonly status: 'resolved';
      readonly session: VersionSurfaceCheckoutSession;
      readonly head: WorkbookCommitRef;
    }
  | {
      readonly status: 'degraded';
      readonly session?: VersionSurfaceCheckoutSession;
      readonly result: VersionDegradedHeadResult;
    };

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

export async function readActiveCheckoutHead(
  ctx: DocumentContext,
): Promise<ActiveCheckoutHeadResolution> {
  const services = getAttachedVersionServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  const diagnostics: VersionDiagnostic[] = [];
  const session = await readVersionSurfaceCheckoutSession(surfaceStatusService, diagnostics);

  if (!session) {
    return { status: 'absent' };
  }

  if (session.detached) {
    return {
      status: 'resolved',
      session,
      head: { id: session.checkedOutCommitId as WorkbookCommitId },
    };
  }

  const refName = refNameFromBranchName(session.branchName);
  if (!refName) {
    return {
      status: 'degraded',
      session,
      result: degradedHead([
        providerErrorDiagnostic('getHead', {
          reason: 'invalid-active-checkout-branch',
        }),
      ]),
    };
  }

  const readService = getAttachedVersionReadService(ctx);
  if (!readService?.readRef) {
    return {
      status: 'degraded',
      session,
      result: degradedHead([serviceUnavailableDiagnostic('getHead', { refName })]),
    };
  }

  try {
    const result = mapRefResult(await readService.readRef(refName), refName);
    if (result.status === 'degraded') {
      return {
        status: 'degraded',
        session,
        result: degradedHead(result.diagnostics, result.ref ?? undefined),
      };
    }
    if (!isConcreteVersionRef(result.ref)) {
      return {
        status: 'degraded',
        session,
        result: degradedHead([providerErrorDiagnostic('getHead', { refName })], result.ref),
      };
    }
    return {
      status: 'resolved',
      session,
      head: {
        id: result.ref.commitId,
        refName: result.ref.name,
        resolvedFrom: result.ref.name,
        refRevision: result.ref.revision,
      },
    };
  } catch {
    return {
      status: 'degraded',
      session,
      result: degradedHead([providerErrorDiagnostic('getHead', { refName })]),
    };
  }
}

function refNameFromBranchName(
  branchName: string | undefined,
): VersionMainRefName | VersionRefName | null {
  if (!branchName) return null;
  return branchName.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? (branchName as VersionMainRefName | VersionRefName)
    : (`${VERSION_BRANCH_REF_PREFIX}${branchName}` as VersionMainRefName | VersionRefName);
}

function isConcreteVersionRef(value: unknown): value is VersionRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'commitId' in value &&
    typeof value.commitId === 'string'
  );
}
