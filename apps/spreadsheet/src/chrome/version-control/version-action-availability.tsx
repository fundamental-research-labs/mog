import type {
  VersionCapability,
  VersionDiagnostic,
  VersionRef,
  VersionSurfaceStatus,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { displayBranchName, validateVersionBranchCreationName } from './version-branch-name';

const ACTION_CAPABILITY_LABELS: Partial<Record<VersionCapability, string>> = {
  'version:read': 'Read',
  'version:commit': 'Commit',
  'version:branch': 'Branch',
  'version:checkout': 'Checkout',
  'version:diff': 'Diff',
  'version:revert': 'Rollback',
};

const VERSIONING_DISABLED_REASON = 'Versioning is disabled for this workbook.';

export type VersionActionAvailability = {
  readonly enabled: boolean;
  readonly disabledReason?: string;
};

type VersionActionSurfaceData = {
  readonly surface?: VersionSurfaceStatus;
  readonly refs?: readonly Pick<VersionRef, 'name'>[];
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

  const surface = data.surface;
  if (!surface) return disabledAction('Version surface status is unavailable.');
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:commit');
  if (surfaceReason) return disabledAction(surfaceReason);

  const dirtyReason = commitDirtyDisabledReason(surface);
  if (dirtyReason) return disabledAction(dirtyReason);

  const staleReason = currentStaleDisabledReason(surface, 'commit');
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

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:branch');
  if (surfaceReason) return disabledAction(surfaceReason);

  if (!targetCommitId) return disabledAction('Select a commit target first.');
  const branchNameValidation = validateVersionBranchCreationName(branchName, data.refs ?? []);
  if (!branchNameValidation.ok) return disabledAction(branchNameValidation.reason);
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

  const surface = data.surface;
  if (!surface) return disabledAction('Version surface status is unavailable.');
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:checkout');
  if (surfaceReason) return disabledAction(surfaceReason);

  const checkoutReason = checkoutUnsafeDisabledReason(surface);
  if (checkoutReason) return disabledAction(checkoutReason);

  const staleReason = currentStaleDisabledReason(surface, 'checkout');
  if (staleReason) return disabledAction(staleReason);
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

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:diff');
  if (surfaceReason) return disabledAction(surfaceReason);
  return enabledAction();
}

export function getRollbackAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  rollbackReason: string,
  targetCommitId: WorkbookCommitId | undefined,
): VersionActionAvailability {
  if (!data) return disabledAction('Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) return disabledAction('Version surface status is unavailable.');
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:revert');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'rollback');
  if (staleReason) return disabledAction(staleReason);

  if (!targetCommitId) return disabledAction('Select a commit target first.');
  if (rollbackReason.trim().length === 0) return disabledAction('Enter a rollback reason.');
  return enabledAction();
}

export function isCapabilityEnabled(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): boolean {
  return surface.capabilities[capability]?.enabled === true;
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

function actionSurfaceDisabledReason(
  surface: VersionSurfaceStatus | undefined,
  capability: VersionCapability,
): string | undefined {
  if (!surface) return 'Version surface status is unavailable.';
  if (!surface.featureGateEnabled) return VERSIONING_DISABLED_REASON;
  const readReason = capabilityDisabledReason(surface, 'version:read');
  if (readReason) return readReason;
  return capabilityDisabledReason(surface, capability);
}

function capabilityDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): string | undefined {
  const state = surface.capabilities[capability];
  const fallbackReason = `${ACTION_CAPABILITY_LABELS[capability] ?? capability} is unavailable.`;
  if (!state) return fallbackReason;
  if (state.enabled) return undefined;
  return state.reason || fallbackReason;
}

function commitDirtyDisabledReason(surface: VersionSurfaceStatus): string | undefined {
  const dirty = surface.dirty;

  const providerWriteReason = providerWritesDisabledReason(surface, 'committing');
  if (providerWriteReason) return providerWriteReason;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'commit');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) return 'Wait for recalculation to settle before committing.';
  if (dirty.commitEligibleChanges) return undefined;
  if (!dirty.hasUncommittedLocalChanges) return 'Make a workbook change before committing.';
  return (
    firstDiagnosticMessage(dirty.diagnostics) ?? 'No commit-eligible local changes are available.'
  );
}

function currentStaleDisabledReason(
  surface: VersionSurfaceStatus,
  action: 'commit' | 'checkout' | 'rollback',
): string | undefined {
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
  const suffix =
    action === 'commit'
      ? 'Refresh before committing.'
      : action === 'checkout'
        ? 'Checkout is blocked until the active checkout session is refreshed.'
        : 'Refresh before staging rollback.';
  return `${branchLabel} is stale because ${reason}. ${suffix}`;
}

function checkoutUnsafeDisabledReason(surface: VersionSurfaceStatus): string | undefined {
  const dirty = surface.dirty;
  if (dirty.checkoutSafe) return undefined;

  const providerWriteReason = providerWritesDisabledReason(surface, 'checking out');
  if (providerWriteReason) return providerWriteReason;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'checkout');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) return 'Wait for recalculation to settle before checking out.';

  const diagnosticMessage =
    firstDiagnosticMessage(dirty.unsafeReasons) ?? firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage) return diagnosticMessage;
  if (dirty.hasUncommittedLocalChanges) {
    return 'Commit or discard local changes before checking out.';
  }
  return 'Checkout preflight is unsafe for this workbook.';
}

function providerWritesDisabledReason(
  surface: VersionSurfaceStatus,
  action: 'committing' | 'checking out',
): string | undefined {
  return surface.dirty.pendingProviderWrites
    ? `Wait for provider writes to settle before ${action}.`
    : undefined;
}

function unsupportedDirtyDomainsDisabledReason(
  surface: VersionSurfaceStatus,
  action: 'commit' | 'checkout',
): string | undefined {
  const dirty = surface.dirty;
  if (dirty.unsupportedDirtyDomains.length === 0) return undefined;

  const diagnosticMessage = firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage && dirty.unsupportedDirtyDomains.includes('unknown')) {
    return diagnosticMessage;
  }

  const domains = formatInlineList(dirty.unsupportedDirtyDomains);
  return action === 'commit'
    ? `Changes in ${domains} cannot be committed yet.`
    : `Commit or discard changes in ${domains} before checking out.`;
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
