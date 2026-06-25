import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentProposalSummary,
  Paged,
  VersionError,
  VersionHead,
  VersionRef,
  VersionResult,
  VersionRevertResult,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookCommitSummary,
  WorkbookVersion,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';

import { isCapabilityEnabled } from './availability/version-action-availability';
import type { VersionPanelDiagnostic } from './VersionActionStatus';
import { normalizeVersionBranchNameInput } from './version-branch-name';
import { shortCommitId } from './version-history-format';

const COMMIT_PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 5;
const PROPOSAL_PAGE_SIZE = 5;
const VERSION_HISTORY_REFRESH_DELAY_MS = 40;
const VERSION_HISTORY_WORKBOOK_REFRESH_EVENTS = [
  'workbook:version-dirty-status-changed',
  'workbook:version-checkout-materialized',
  'workbook:version-active-checkout-state-changed',
] as const;

type VersionHistoryWorkbookRefreshEvent = (typeof VERSION_HISTORY_WORKBOOK_REFRESH_EVENTS)[number];

export type VersionHistoryWorkbook = {
  readonly version: Pick<
    WorkbookVersion,
    | 'getSurfaceStatus'
    | 'getStatus'
    | 'getHead'
    | 'readRef'
    | 'listCommits'
    | 'commit'
    | 'listRefs'
    | 'createBranch'
    | 'checkout'
    | 'promotePendingRemote'
    | 'merge'
    | 'applyMerge'
    | 'revert'
    | 'diff'
    | 'listReviews'
    | 'listProposals'
  >;
  readonly on?: (
    event: VersionHistoryWorkbookRefreshEvent,
    handler: (event: unknown) => void,
  ) => () => void;
};

export type VersionHistoryLoadState =
  | { readonly status: 'loading'; readonly previous?: VersionHistoryData }
  | { readonly status: 'ready'; readonly data: VersionHistoryData }
  | { readonly status: 'error'; readonly diagnostics: readonly VersionPanelDiagnostic[] };

export type VersionHistoryData = {
  readonly surface?: VersionSurfaceStatus;
  readonly rollout?: WorkbookVersionStatus;
  readonly head?: VersionHead;
  readonly commits: readonly WorkbookCommitSummary[];
  readonly refs: readonly VersionRef[];
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
  readonly reviewDiagnostic?: VersionPanelDiagnostic;
  readonly proposalDiagnostic?: VersionPanelDiagnostic;
  readonly diagnostics: readonly VersionPanelDiagnostic[];
};

export type CommitDirtySnapshot = {
  readonly statusRevision: string;
  readonly checkoutPreflightToken: string;
  readonly hasUncommittedLocalChanges: boolean;
};

export type CommitDirtyRefreshFence = {
  readonly data?: VersionHistoryData;
  readonly snapshot?: CommitDirtySnapshot;
};

type PublicSurfaceCurrentBranch = {
  readonly refName: NonNullable<VersionHead['refName']>;
};

export function commitDirtyRefreshFenceSnapshot(
  data: VersionHistoryData | undefined,
): Pick<CommitDirtyRefreshFence, 'snapshot'> {
  const snapshot = commitDirtySnapshot(data);
  return snapshot ? { snapshot } : {};
}

export function commitDirtyRefreshFenceRequiresRefresh(
  fence: CommitDirtyRefreshFence | undefined,
  data: VersionHistoryData | undefined,
): boolean {
  if (!fence) return false;
  if (data === fence.data) return true;

  const snapshot = commitDirtySnapshot(data);
  if (!snapshot) return true;
  if (!snapshot.hasUncommittedLocalChanges) return false;

  return (
    fence.snapshot === undefined ||
    snapshot.statusRevision === fence.snapshot.statusRevision ||
    snapshot.checkoutPreflightToken === fence.snapshot.checkoutPreflightToken
  );
}

export function useVersionHistoryData(workbook: VersionHistoryWorkbook): {
  readonly loadState: VersionHistoryLoadState;
  readonly load: () => Promise<void>;
  readonly data?: VersionHistoryData;
  readonly diagnostics: readonly VersionPanelDiagnostic[];
  readonly loading: boolean;
} {
  const [loadState, setLoadState] = useState<VersionHistoryLoadState>({ status: 'loading' });
  const pendingRefreshRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightLoadRef = useRef<Promise<void> | undefined>(undefined);
  const queuedRefreshRef = useRef(false);

  const runLoad = useCallback(async () => {
    setLoadState((current) => ({
      status: 'loading',
      previous:
        current.status === 'ready'
          ? current.data
          : current.status === 'loading'
            ? current.previous
            : undefined,
    }));

    const diagnostics: VersionPanelDiagnostic[] = [];
    const surface = await readValue('VERSION_UI_SURFACE_STATUS_FAILED', () =>
      workbook.version.getSurfaceStatus(),
    );
    const readReviews = surface.ok && isCapabilityEnabled(surface.value, 'version:reviewRead');
    const readProposals = surface.ok && isCapabilityEnabled(surface.value, 'version:proposal');

    const [rollout, head, commits, refs, reviews, proposals] = await Promise.all([
      readValue('VERSION_UI_STATUS_FAILED', () => workbook.version.getStatus()),
      readVersionResult('VERSION_UI_HEAD_FAILED', () => workbook.version.getHead()),
      readVersionResult('VERSION_UI_COMMITS_FAILED', () =>
        workbook.version.listCommits({ pageSize: COMMIT_PAGE_SIZE, includeDiagnostics: true }),
      ),
      readVersionResult('VERSION_UI_REFS_FAILED', () =>
        workbook.version.listRefs({ includeDiagnostics: true }),
      ),
      readReviews
        ? readVersionResult('VERSION_UI_REVIEWS_FAILED', () =>
            workbook.version.listReviews({ limit: REVIEW_PAGE_SIZE }),
          )
        : Promise.resolve(emptyPagedRead<WorkbookVersionReviewRecordSummary>(REVIEW_PAGE_SIZE)),
      readProposals
        ? readVersionResult('VERSION_UI_PROPOSALS_FAILED', () =>
            workbook.version.listProposals({ limit: PROPOSAL_PAGE_SIZE }),
          )
        : Promise.resolve(emptyPagedRead<AgentProposalSummary>(PROPOSAL_PAGE_SIZE)),
    ]);

    if (!surface.ok) diagnostics.push(surface.diagnostic);
    if (!rollout.ok) diagnostics.push(rollout.diagnostic);
    if (!head.ok) diagnostics.push(head.diagnostic);
    if (!commits.ok) diagnostics.push(commits.diagnostic);
    if (!refs.ok) diagnostics.push(refs.diagnostic);
    if (!reviews.ok) diagnostics.push(reviews.diagnostic);
    if (!proposals.ok) diagnostics.push(proposals.diagnostic);

    const surfaceValue = surface.ok ? projectVersionHistorySurface(surface.value) : undefined;
    const headValue = head.ok ? head.value : undefined;
    const projectedHead = projectVersionHistoryHead(headValue, surfaceValue);

    const data: VersionHistoryData = {
      ...(surfaceValue ? { surface: surfaceValue } : {}),
      ...(rollout.ok ? { rollout: rollout.value } : {}),
      ...(projectedHead ? { head: projectedHead } : {}),
      commits: commits.ok ? commits.value.items : [],
      refs: refs.ok ? refs.value.items : [],
      reviews: reviews.ok ? reviews.value.items : [],
      proposals: proposals.ok ? proposals.value.items : [],
      ...(!reviews.ok ? { reviewDiagnostic: reviews.diagnostic } : {}),
      ...(!proposals.ok ? { proposalDiagnostic: proposals.diagnostic } : {}),
      diagnostics,
    };

    if (
      !surface.ok &&
      !rollout.ok &&
      !head.ok &&
      !commits.ok &&
      !refs.ok &&
      !reviews.ok &&
      !proposals.ok
    ) {
      setLoadState({ status: 'error', diagnostics });
      return;
    }
    setLoadState({ status: 'ready', data });
  }, [workbook]);

  const load = useCallback(async () => {
    if (pendingRefreshRef.current !== undefined) {
      clearTimeout(pendingRefreshRef.current);
      pendingRefreshRef.current = undefined;
    }

    if (inFlightLoadRef.current) {
      queuedRefreshRef.current = true;
      await inFlightLoadRef.current;
      return;
    }

    const refresh = (async () => {
      do {
        queuedRefreshRef.current = false;
        await runLoad();
      } while (queuedRefreshRef.current);
    })();
    inFlightLoadRef.current = refresh;
    try {
      await refresh;
    } finally {
      if (inFlightLoadRef.current === refresh) {
        inFlightLoadRef.current = undefined;
      }
    }
  }, [runLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workbook.on) return undefined;

    const scheduleRefresh = () => {
      if (inFlightLoadRef.current) {
        queuedRefreshRef.current = true;
        return;
      }

      if (pendingRefreshRef.current !== undefined) {
        clearTimeout(pendingRefreshRef.current);
      }
      pendingRefreshRef.current = setTimeout(() => {
        pendingRefreshRef.current = undefined;
        void load();
      }, VERSION_HISTORY_REFRESH_DELAY_MS);
    };

    const unsubscriptions = VERSION_HISTORY_WORKBOOK_REFRESH_EVENTS.map((event) =>
      workbook.on?.(event, scheduleRefresh),
    );

    return () => {
      if (pendingRefreshRef.current !== undefined) {
        clearTimeout(pendingRefreshRef.current);
        pendingRefreshRef.current = undefined;
      }
      for (const unsubscribe of unsubscriptions) {
        unsubscribe?.();
      }
    };
  }, [load, workbook]);

  const data =
    loadState.status === 'ready'
      ? loadState.data
      : loadState.status === 'loading'
        ? loadState.previous
        : undefined;
  const diagnostics =
    loadState.status === 'error' ? loadState.diagnostics : (data?.diagnostics ?? []);

  return {
    loadState,
    load,
    data,
    diagnostics,
    loading: loadState.status === 'loading',
  };
}

function commitDirtySnapshot(
  data: VersionHistoryData | undefined,
): CommitDirtySnapshot | undefined {
  const dirty = data?.surface?.dirty;
  if (!dirty) return undefined;
  if (
    dirty.source !== 'VC-05' ||
    dirty.statusRevision.length === 0 ||
    dirty.checkoutPreflightToken.length === 0
  ) {
    return undefined;
  }
  return {
    statusRevision: dirty.statusRevision,
    checkoutPreflightToken: dirty.checkoutPreflightToken,
    hasUncommittedLocalChanges: dirty.hasUncommittedLocalChanges,
  };
}

async function readValue<T>(
  code: string,
  read: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    return { ok: true, value: await read() };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

export async function readVersionResult<T>(
  code: string,
  read: () => Promise<VersionResult<T>>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: VersionPanelDiagnostic }
> {
  try {
    const result = await read();
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, diagnostic: diagnosticFromError(code, result.error) };
  } catch {
    return {
      ok: false,
      diagnostic: {
        code,
        severity: 'warning',
        message: 'Version service call failed.',
      },
    };
  }
}

function emptyPagedRead<T>(limit: number): { readonly ok: true; readonly value: Paged<T> } {
  return { ok: true, value: { items: [], limit } };
}

export function resolveSelectedOrHeadCommitId(
  data: VersionHistoryData,
  selectedCommitId: WorkbookCommitId | undefined,
): WorkbookCommitId | undefined {
  if (selectedCommitId) return selectedCommitId;
  return currentCheckoutCommitId(data.surface?.current) ?? data.head?.id;
}

function projectVersionHistorySurface(
  surface: VersionSurfaceStatus | undefined,
): VersionSurfaceStatus | undefined {
  if (!surface) return undefined;

  const publicBranch = publicSurfaceCurrentBranch(surface.current);
  const branchName = publicBranch?.refName;
  if (surface.current.branchName === branchName) return surface;

  return {
    ...surface,
    current: branchName
      ? { ...surface.current, branchName }
      : surfaceCurrentWithoutBranchName(surface.current),
  };
}

function projectVersionHistoryHead(
  head: VersionHead | undefined,
  surface: VersionSurfaceStatus | undefined,
): VersionHead | undefined {
  const current = surface?.current;
  if (!current) return head;

  const currentHeadId = currentCheckoutCommitId(current);
  if (!currentHeadId) return head;

  const currentRefName = publicSurfaceCurrentBranch(current)?.refName;
  const headMatchesCurrent =
    head?.id === currentHeadId &&
    (currentRefName ? head.refName === currentRefName : head.refName === undefined);

  if (headMatchesCurrent) return head;

  return {
    id: currentHeadId,
    ...(currentRefName ? { refName: currentRefName } : {}),
  };
}

function currentCheckoutCommitId(
  current: VersionSurfaceStatus['current'] | undefined,
): WorkbookCommitId | undefined {
  return (current?.checkedOutCommitId ?? current?.headCommitId) as WorkbookCommitId | undefined;
}

function publicSurfaceCurrentBranch(
  current: VersionSurfaceStatus['current'],
): PublicSurfaceCurrentBranch | undefined {
  if (current.detached || !current.branchName) return undefined;

  const normalized = normalizeVersionBranchNameInput(current.branchName);
  if (!normalized.ok) return undefined;

  return {
    refName: normalized.branch.refName as NonNullable<VersionHead['refName']>,
  };
}

function surfaceCurrentWithoutBranchName(
  current: VersionSurfaceStatus['current'],
): VersionSurfaceStatus['current'] {
  return {
    ...(current.headCommitId ? { headCommitId: current.headCommitId } : {}),
    ...(current.checkedOutCommitId ? { checkedOutCommitId: current.checkedOutCommitId } : {}),
    ...(current.refHeadAtMaterialization
      ? { refHeadAtMaterialization: current.refHeadAtMaterialization }
      : {}),
    ...(current.currentRefHeadId ? { currentRefHeadId: current.currentRefHeadId } : {}),
    detached: current.detached,
    stale: current.stale,
    ...(current.staleReason ? { staleReason: current.staleReason } : {}),
  };
}

export function rollbackActionMessage(
  result: VersionRevertResult,
  targetCommitId: WorkbookCommitId,
): string {
  const target = shortCommitId(targetCommitId);
  if (result.status === 'planned') return `Rollback staged for ${target}`;
  if (result.status === 'requires-review') return `Rollback for ${target} requires review`;
  if (result.status === 'applied') return `Rollback applied for ${target}`;
  return `Rollback rejected for ${target}`;
}

export function diagnosticFromRevertResult(
  code: string,
  result: VersionRevertResult,
): VersionPanelDiagnostic {
  const diagnostic = result.diagnostics.find((entry) => entry.safeMessage.trim().length > 0);
  if (!diagnostic) {
    return { code, severity: 'warning', message: 'Rollback preflight was rejected.' };
  }
  return {
    code: diagnostic.issueCode,
    severity: diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity,
    message: diagnostic.safeMessage,
  };
}

function diagnosticFromError(code: string, error: VersionError): VersionPanelDiagnostic {
  if (error.code === 'target_unavailable') {
    return {
      code: error.diagnostics[0]?.code ?? code,
      severity: error.diagnostics[0]?.severity ?? 'warning',
      message: error.diagnostics[0]?.message ?? error.target,
    };
  }
  if (
    error.code === 'version_capability_unavailable' ||
    error.code === 'invalid_state' ||
    error.code === 'not_found' ||
    error.code === 'invalid_branch_name' ||
    error.code === 'redaction_blocked'
  ) {
    return { code, severity: 'warning', message: error.reason };
  }
  if (error.code === 'stale_head') {
    return {
      code,
      severity: 'warning',
      message: `Version head changed before the request completed. Expected ${shortCommitId(
        error.expectedHeadId,
      )}, now ${shortCommitId(error.actualHeadId)}. Refresh version history before retrying.`,
    };
  }
  if (error.code === 'stale_revision') {
    return { code, severity: 'warning', message: 'Version revision is stale.' };
  }
  return { code, severity: 'warning', message: 'Version request failed.' };
}
