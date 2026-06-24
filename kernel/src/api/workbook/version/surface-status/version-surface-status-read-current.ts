import type {
  VersionDiagnostic,
  VersionMainRefName,
  VersionRefName,
  VersionRefSelector,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import {
  VERSION_BRANCH_REF_PREFIX,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
} from '../refs/version-refs-constants';
import type { AttachedVersionReadService } from './version-surface-status-attachments';
import { readCheckoutSessionCurrentStatus } from './version-surface-status-current';
import type { VersionSurfaceCheckoutSession } from './version-surface-status-service-types';
import { isRecord, surfaceDiagnostic, toCommitId } from './version-surface-status-utils';

type ProjectedHead = {
  readonly id: string;
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly resolvedFrom?: VersionRefSelector;
};

type ProjectedRef = {
  readonly name: 'HEAD' | VersionMainRefName | VersionRefName;
  readonly commitId?: string;
};

export async function readVersionSurfaceCurrentStatus(
  readService: AttachedVersionReadService | null,
  diagnostics: VersionDiagnostic[],
  activeCheckoutSession: VersionSurfaceCheckoutSession | null,
): Promise<VersionSurfaceStatus['current']> {
  if (activeCheckoutSession) {
    return readCheckoutSessionCurrentStatus({
      session: activeCheckoutSession,
      ...(readService?.readRef ? { readRef: readService.readRef } : {}),
      diagnostics,
    });
  }

  if (!readService) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.readUnavailable',
        'warning',
        'No document-scoped version graph read service is attached.',
        'VC-04',
      ),
    );
    return defaultVersionSurfaceCurrentStatus();
  }

  let head: ProjectedHead | null = null;
  try {
    const result = readService.readHead
      ? await readService.readHead()
      : readService.getHead
        ? await readService.getHead()
        : null;
    head = projectHeadResult(result);
  } catch {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service failed while resolving the current head.',
        'VC-04',
      ),
    );
  }

  if (!head) {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service could not provide a current head.',
        'VC-04',
      ),
    );
    return defaultVersionSurfaceCurrentStatus();
  }

  const refName = head.refName ?? head.resolvedFrom;
  let currentRefHeadId = refName === VERSION_HEAD_REF ? undefined : head.id;
  if (readService.readRef && refName && refName !== VERSION_HEAD_REF) {
    try {
      const ref = projectRefResult(await readService.readRef(refName));
      currentRefHeadId = ref?.commitId ?? currentRefHeadId;
    } catch {
      diagnostics.push(
        surfaceDiagnostic(
          'version.surfaceStatus.currentReadFailed',
          'warning',
          'The version read service failed while resolving the current ref head.',
          'VC-04',
          { refName },
        ),
      );
    }
  }

  return {
    headCommitId: head.id,
    ...(head.refName ? { branchName: branchNameFromRefName(head.refName) } : {}),
    ...(currentRefHeadId ? { currentRefHeadId } : {}),
    detached: !head.refName,
    stale: false,
  };
}

export function defaultVersionSurfaceCurrentStatus(): VersionSurfaceStatus['current'] {
  return {
    detached: false,
    stale: false,
  };
}

function projectHeadResult(value: unknown): ProjectedHead | null {
  if (!isRecord(value)) return null;
  if (value.status === 'success' && isRecord(value.head)) return projectHead(value.head);
  if ('head' in value && value.head !== null) return projectHead(value.head);
  return projectHead(value);
}

function projectHead(value: unknown): ProjectedHead | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id) ?? toCommitId(value.commitId);
  if (!id) return null;
  const refName = toRefName(value.refName) ?? legacyBranchNameToRefName(value.branchName);
  const resolvedFrom = toRefSelector(value.resolvedFrom);
  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
  };
}

function projectRefResult(value: unknown): ProjectedRef | null {
  if (!isRecord(value)) return null;
  if (value.status === 'success' && isRecord(value.ref)) return projectRef(value.ref);
  if ('ref' in value && value.ref !== null) return projectRef(value.ref);
  return projectRef(value);
}

function projectRef(value: unknown): ProjectedRef | null {
  if (!isRecord(value)) return null;
  if (value.name === VERSION_HEAD_REF) {
    return { name: VERSION_HEAD_REF };
  }

  const name = toRefName(value.name);
  const commitId = toCommitId(value.commitId);
  return name && commitId ? { name, commitId } : null;
}

function branchNameFromRefName(refName: VersionMainRefName | VersionRefName): string {
  return refName === VERSION_MAIN_REF ? 'main' : refName.slice(VERSION_BRANCH_REF_PREFIX.length);
}

function toRefSelector(value: unknown): VersionRefSelector | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return toRefName(value);
}

function toRefName(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionRefName;
  }
  return undefined;
}

function legacyBranchNameToRefName(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (value === undefined) return undefined;
  if (value === 'main') return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionRefName;
  }
  if (typeof value === 'string' && value.length > 0) {
    return `${VERSION_BRANCH_REF_PREFIX}${value}` as VersionRefName;
  }
  return undefined;
}
