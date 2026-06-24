import type {
  VersionDegradedHeadResult,
  VersionDiagnostic,
  VersionMainRefName,
  VersionRef,
  VersionRefName,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  degradedHead,
  mapHeadResult,
  mapLegacyHeadResult,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from '../../version-public-read-mappers';
import {
  getAttachedVersionReadService,
  getAttachedVersionServices,
} from '../status/version-service-attachments';
import {
  getAttachedVersionSurfaceStatusService,
  readVersionSurfaceCheckoutSession,
  type VersionSurfaceCheckoutSession,
} from '../surface-status/version-surface-status-service';
import { readPersistedActiveCheckoutMaterialization } from './version-active-checkout-persistence';
import { restoreAttachedActiveCheckoutMaterialization } from './version-active-checkout-restore';

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
  let session = await readVersionSurfaceCheckoutSession(surfaceStatusService, diagnostics);
  if (!session) {
    const restored = await restorePersistedActiveCheckoutSession(ctx, surfaceStatusService);
    if (restored) {
      return {
        status: 'resolved',
        session: restored.session,
        head: restored.head,
      };
    }
  }

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

async function restorePersistedActiveCheckoutSession(
  ctx: DocumentContext,
  surfaceStatusService: ReturnType<typeof getAttachedVersionSurfaceStatusService>,
): Promise<{
  readonly session: VersionSurfaceCheckoutSession;
  readonly head: WorkbookCommitRef;
} | null> {
  const persisted = await readPersistedActiveCheckoutMaterialization(ctx);
  if (!persisted || persisted.detached) return null;
  const readService = getAttachedVersionReadService(ctx);
  if (!readService) return null;

  try {
    const head = readService.readHead
      ? mapHeadResult(await readService.readHead())
      : readService.getHead
        ? mapLegacyHeadResult(await readService.getHead())
        : null;
    if (!head || isDegradedHeadResult(head) || !head.refName) return null;
    const branchName = branchNameFromPublicRefName(head.refName);
    if (
      !branchName ||
      branchName !== persisted.branchName ||
      head.id !== persisted.checkedOutCommitId ||
      persisted.refHeadAtMaterialization !== persisted.checkedOutCommitId
    ) {
      return null;
    }
    const session = await restoreAttachedActiveCheckoutMaterialization({
      ctx,
      surfaceStatusService,
      session: persisted,
    });
    return session ? { session, head } : null;
  } catch {
    return null;
  }
}

function branchNameFromPublicRefName(refName: VersionMainRefName | VersionRefName): string | null {
  if (!refName.startsWith(VERSION_BRANCH_REF_PREFIX)) return null;
  return refName.slice(VERSION_BRANCH_REF_PREFIX.length);
}

function isDegradedHeadResult(
  value: WorkbookCommitRef | VersionDegradedHeadResult,
): value is VersionDegradedHeadResult {
  return 'status' in value && value.status === 'degraded';
}

function isConcreteVersionRef(value: unknown): value is VersionRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'commitId' in value &&
    typeof value.commitId === 'string'
  );
}
