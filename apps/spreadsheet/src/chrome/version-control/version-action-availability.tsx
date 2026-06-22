import type {
  VersionCapability,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

const ACTION_CAPABILITY_LABELS: Partial<Record<VersionCapability, string>> = {
  'version:commit': 'Commit',
  'version:branch': 'Branch',
  'version:checkout': 'Checkout',
  'version:diff': 'Diff',
};

export type VersionActionAvailability = {
  readonly enabled: boolean;
  readonly disabledReason?: string;
};

type VersionActionSurfaceData = {
  readonly surface?: VersionSurfaceStatus;
};

export function getCommitAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  commitMessage: string,
): VersionActionAvailability {
  if (!data) return disabledAction('Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const capabilityReason = capabilityDisabledReason(data, 'version:commit');
  if (capabilityReason) return disabledAction(capabilityReason);

  const surface = data.surface;
  if (!surface) return disabledAction('Version surface status is unavailable.');

  const dirtyReason = commitDirtyDisabledReason(surface);
  if (dirtyReason) return disabledAction(dirtyReason);

  const staleReason = currentStaleDisabledReason(surface);
  if (staleReason) return disabledAction(staleReason);

  if (commitMessage.trim().length === 0) return disabledAction('Enter a commit message.');
  return enabledAction();
}

export function getBranchAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  branchName: string,
  targetCommitId: WorkbookCommitId | undefined,
): VersionActionAvailability {
  if (!data) return disabledAction('Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const capabilityReason = capabilityDisabledReason(data, 'version:branch');
  if (capabilityReason) return disabledAction(capabilityReason);

  if (!targetCommitId) return disabledAction('Select a commit target first.');
  if (branchName.trim().length === 0) return disabledAction('Enter a branch name.');
  return enabledAction();
}

export function getCheckoutAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const capabilityReason = capabilityDisabledReason(data, 'version:checkout');
  if (capabilityReason) return disabledAction(capabilityReason);

  const surface = data.surface;
  if (!surface) return disabledAction('Version surface status is unavailable.');

  const checkoutReason = checkoutUnsafeDisabledReason(surface);
  if (checkoutReason) return disabledAction(checkoutReason);
  return enabledAction();
}

export function getDiffAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const capabilityReason = capabilityDisabledReason(data, 'version:diff');
  if (capabilityReason) return disabledAction(capabilityReason);
  return enabledAction();
}

export function DisabledReason({
  id,
  reason,
}: {
  readonly id: string;
  readonly reason?: string;
}): React.JSX.Element | null {
  if (!reason) return null;

  return (
    <div id={id} className="text-[11px] leading-snug text-ss-text-secondary">
      {reason}
    </div>
  );
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function commonActionDisabledReason(actionBusy: boolean, loading: boolean): string | undefined {
  if (actionBusy) return 'Wait for the current version action to finish.';
  if (loading) return 'Version status is refreshing.';
  return undefined;
}

function capabilityDisabledReason(
  data: VersionActionSurfaceData,
  capability: VersionCapability,
): string | undefined {
  const surface = data.surface;
  if (!surface) return 'Version surface status is unavailable.';

  const state = surface.capabilities[capability];
  if (state.enabled) return undefined;
  return state.reason || `${ACTION_CAPABILITY_LABELS[capability] ?? capability} is unavailable.`;
}

function commitDirtyDisabledReason(surface: VersionSurfaceStatus): string | undefined {
  const dirty = surface.dirty;
  if (dirty.commitEligibleChanges) return undefined;

  const diagnosticMessage = firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage && dirty.unsupportedDirtyDomains.includes('unknown')) {
    return diagnosticMessage;
  }
  if (dirty.unsupportedDirtyDomains.length > 0) {
    return `Changes in ${formatInlineList(dirty.unsupportedDirtyDomains)} cannot be committed yet.`;
  }
  if (dirty.pendingProviderWrites) return 'Wait for provider writes to settle before committing.';
  if (dirty.pendingRecalc) return 'Wait for recalculation to settle before committing.';
  if (!dirty.hasUncommittedLocalChanges) return 'Make a workbook change before committing.';
  return diagnosticMessage ?? 'No commit-eligible local changes are available.';
}

function currentStaleDisabledReason(surface: VersionSurfaceStatus): string | undefined {
  const current = surface.current;
  if (!current.stale) return undefined;

  const branchLabel = current.branchName
    ? displayBranchName(current.branchName)
    : 'Current checkout';
  const reason =
    current.staleReason === 'refMoved'
      ? 'the branch head moved'
      : current.staleReason === 'activeSessionBehind'
        ? 'the active checkout session is behind the branch head'
        : 'the current head could not be verified';
  return `${branchLabel} is stale because ${reason}. Refresh before committing.`;
}

function checkoutUnsafeDisabledReason(surface: VersionSurfaceStatus): string | undefined {
  const dirty = surface.dirty;
  if (dirty.checkoutSafe) return undefined;

  const diagnosticMessage =
    firstDiagnosticMessage(dirty.unsafeReasons) ?? firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage) return diagnosticMessage;
  if (dirty.hasUncommittedLocalChanges) {
    return 'Commit or discard local changes before checkout.';
  }
  if (dirty.pendingProviderWrites) return 'Wait for provider writes to settle before checkout.';
  if (dirty.pendingRecalc) return 'Wait for recalculation to settle before checkout.';
  return 'Checkout preflight is unsafe for this workbook.';
}

function firstDiagnosticMessage(
  diagnostics: readonly Pick<VersionDiagnostic, 'message'>[],
): string | undefined {
  return diagnostics.find((diagnostic) => diagnostic.message.trim().length > 0)?.message;
}

function formatInlineList(values: readonly string[]): string {
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`;
}

function enabledAction(): VersionActionAvailability {
  return { enabled: true };
}

function disabledAction(disabledReason: string): VersionActionAvailability {
  return { enabled: false, disabledReason };
}

function displayBranchName(name: string): string {
  return name.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? name.slice(VERSION_BRANCH_REF_PREFIX.length)
    : name;
}
