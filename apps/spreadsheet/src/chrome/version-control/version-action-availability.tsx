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
  'version:reviewRead': 'Review read',
  'version:reviewWrite': 'Review write',
  'version:proposal': 'Proposal',
  'version:mergePreview': 'Merge preview',
  'version:mergeApply': 'Merge apply',
  'version:revert': 'Rollback',
  'version:provenance': 'Provenance',
  'version:remotePromote': 'Remote promote',
};

const VERSIONING_DISABLED_REASON = 'Versioning is disabled for this workbook.';
const VERSION_ACTION_UNAVAILABLE = 'Version action is unavailable.';
const DIRTY_STATUS_UNAVAILABLE_REASON =
  'Dirty status is unavailable; refresh version status before continuing.';
const REDACTED_VERSION_REF = '[version ref]';
const REDACTED_PRINCIPAL = '[principal]';
const REDACTED_COMMIT = '[commit]';
const REDACTED_PENDING_REMOTE_SEGMENT = '[pending remote segment]';
const REDACTED_SYNC_BATCH = '[sync batch]';
const REDACTED_INTERNAL_REFERENCE = '[internal reference]';
const REDACTED_EXTERNAL_LINK = '[external link]';
const REDACTED_SECRET = '[secret]';
const REDACTED_DIAGNOSTIC_PAYLOAD = '[diagnostic payload]';

const INCOMPLETE_HISTORY_DIAGNOSTIC_CODES = new Set([
  'VERSION_DANGLING_REF',
  'VERSION_GRAPH_UNINITIALIZED',
  'VERSION_MISSING_OBJECT',
  'VERSION_MISSING_PARENT',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_UNMATERIALIZABLE_COMMIT',
  'VERSION_CHECKOUT_COMMIT_COMPLETENESS_DIAGNOSTIC',
  'VERSION_CHECKOUT_MISSING_COMMIT',
  'VERSION_CHECKOUT_MISSING_DEPENDENCY',
  'VERSION_CHECKOUT_UNMATERIALIZABLE_COMMIT',
  'VERSION_REVERT_HISTORY_GAP',
]);

const STALE_HEAD_DIAGNOSTIC_CODES = new Set([
  'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
  'VERSION_REVERT_STALE_HEAD',
  'stale_head',
]);

const UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODES = new Set([
  'VERSION_REVERT_OPAQUE_DOMAIN',
  'VERSION_REVERT_UNSUPPORTED_DOMAIN',
  'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
  'externalReferenceUnsupported',
  'inconsistentVisibilityCache',
  'indexKeyedColumnVisibility',
  'indexKeyedRowVisibility',
  'indexKeyedVisibility',
  'opaqueDomain',
  'opaqueDomainDigestUnavailable',
  'opaqueFormatPointer',
  'unsupportedDomain',
  'unsupportedFormat',
]);

const INCOMPLETE_DIFF_DIAGNOSTIC_CODES = new Set(['VERSION_REVIEW_DIFF_COMPLETENESS_BLOCKED', 'VERSION_REVIEW_DIFF_INCOMPLETE']);

export type VersionActionDisabledReasonId =
  | 'version-action-busy'
  | 'version-branch-name-invalid'
  | 'version-capability-host-denied'
  | 'version-capability-unavailable'
  | 'version-checkout-unsafe'
  | 'version-commit-message-required'
  | 'version-commit-no-eligible-changes'
  | 'version-commit-no-local-changes'
  | 'version-diff-incomplete'
  | 'version-dirty-status-unavailable'
  | 'version-head-stale'
  | 'version-history-incomplete'
  | 'version-provider-writes-pending'
  | 'version-recalc-pending'
  | 'version-rollback-reason-required'
  | 'version-status-refreshing'
  | 'version-status-unavailable'
  | 'version-surface-unavailable'
  | 'version-target-required'
  | 'version-unsupported-domain'
  | 'versioning-disabled';

export type VersionActionAvailability =
  | {
      readonly enabled: true;
      readonly disabledReason?: undefined;
      readonly disabledReasonId?: undefined;
    }
  | {
      readonly enabled: false;
      readonly disabledReason: string;
      readonly disabledReasonId: VersionActionDisabledReasonId;
    };

type DisabledActionReason = {
  readonly id: VersionActionDisabledReasonId;
  readonly message: string;
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
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:commit');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'commit');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const dirtyReason = commitDirtyDisabledReason(surface);
  if (dirtyReason) return disabledAction(dirtyReason);

  if (commitMessage.trim().length === 0) {
    return disabledAction('version-commit-message-required', 'Enter a commit message.');
  }
  return enabledAction();
}

export function getBranchAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  branchName: string,
  targetCommitId: WorkbookCommitId | undefined,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:branch');
  if (surfaceReason) return disabledAction(surfaceReason);

  if (!targetCommitId) {
    return disabledAction('version-target-required', 'Select a commit target first.');
  }
  const branchNameValidation = validateVersionBranchCreationName(branchName, data.refs ?? []);
  if (!branchNameValidation.ok) {
    return disabledAction('version-branch-name-invalid', branchNameValidation.reason);
  }
  return enabledAction();
}

export function getCheckoutAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:checkout');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'checkout');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const providerWriteReason =
    providerWritesDiagnosticReason(surface) ??
    providerWritesDisabledReason(surface, 'checking out');
  if (providerWriteReason) return disabledAction(providerWriteReason);

  const checkoutReason = checkoutUnsafeDisabledReason(surface);
  if (checkoutReason) return disabledAction(checkoutReason);

  return enabledAction();
}

export function getDiffAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

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
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surface = data.surface;
  if (!surface) {
    return disabledAction('version-surface-unavailable', 'Version surface status is unavailable.');
  }
  const surfaceReason = actionSurfaceDisabledReason(surface, 'version:revert');
  if (surfaceReason) return disabledAction(surfaceReason);

  const staleReason = currentStaleDisabledReason(surface, 'rollback');
  if (staleReason) return disabledAction(staleReason);

  const dirtyStatusReason = dirtyStatusUnavailableDisabledReason(surface);
  if (dirtyStatusReason) return disabledAction(dirtyStatusReason);

  const providerWriteReason =
    providerWritesDiagnosticReason(surface) ??
    providerWritesDisabledReason(surface, 'staging rollback');
  if (providerWriteReason) return disabledAction(providerWriteReason);

  if (!targetCommitId) {
    return disabledAction('version-target-required', 'Select a commit target first.');
  }
  if (rollbackReason.trim().length === 0) {
    return disabledAction('version-rollback-reason-required', 'Enter a rollback reason.');
  }
  return enabledAction();
}

export function getRemotePromoteAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, 'version:remotePromote');
  if (surfaceReason) return disabledAction(surfaceReason);
  return enabledAction();
}

export function getCapabilityAvailability(
  data: VersionActionSurfaceData | undefined,
  actionBusy: boolean,
  loading: boolean,
  capability: VersionCapability,
): VersionActionAvailability {
  if (!data) return disabledAction('version-status-unavailable', 'Version status is unavailable.');

  const commonReason = commonActionDisabledReason(actionBusy, loading);
  if (commonReason) return disabledAction(commonReason);

  const surfaceReason = actionSurfaceDisabledReason(data.surface, capability);
  if (surfaceReason) return disabledAction(surfaceReason);
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
  const sanitizedReason = sanitizeVersionStatusText(reason, VERSION_ACTION_UNAVAILABLE);
  if (!sanitizedReason) return null;

  return (
    <div id={id} className="text-[11px] leading-snug text-ss-text-secondary">
      {sanitizedReason}
    </div>
  );
}

export function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

export function sanitizeVersionStatusText(
  value: string | undefined,
  fallback: string,
): string | undefined {
  const message = value?.trim() ?? '';
  if (message.length === 0) return undefined;
  const redacted = redactSensitiveVersionDiagnosticText(message).replace(/\s+/g, ' ').trim();
  return redacted.length > 0 ? redacted : fallback;
}

function redactSensitiveVersionDiagnosticText(message: string): string {
  return message
    .replace(
      /["']?\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b["']?\s*:\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal(?:Id|Ids|Ref|Scope|Tag|Tags|_tags)?\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(
      /\bprincipal\b\s+(?:"[^"]*"|'[^']*'|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|principal:[^\s,;)}]+)/gi,
      `principal ${REDACTED_PRINCIPAL}`,
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED_PRINCIPAL)
    .replace(/\brefs\/(?!heads\/(?:<branch>|\*))[^\s"'`<>),;]+/g, REDACTED_VERSION_REF)
    .replace(/\bcommit:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_COMMIT)
    .replace(/\bpending-remote-segment:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_PENDING_REMOTE_SEGMENT)
    .replace(/\bsync-batch-status:sha256:[0-9a-f]{12,64}\b/gi, REDACTED_SYNC_BATCH)
    .replace(/\/Users\/[^\s"'`<>),;]+/g, REDACTED_INTERNAL_REFERENCE)
    .replace(
      /\b(?:mog-internal|dev\/version-control-eval|plans\/active|plans\/)[^\s"'`<>),;]*/g,
      REDACTED_INTERNAL_REFERENCE,
    )
    .replace(/\bhttps?:\/\/[^\s"'`<>),;]+/gi, REDACTED_EXTERNAL_LINK)
    .replace(
      /["']?\b(?:rawPayload|raw_payload|providerPayload|provider_payload|diagnosticPayload|diagnostic_payload|rawWorkbookBytes|raw_workbook_bytes|workbookBytes|workbook_bytes|payloadBytes|payload_bytes)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|\[[^\]]*\]|[^\s,;)}]+)/gi,
      `diagnosticPayload ${REDACTED_DIAGNOSTIC_PAYLOAD}`,
    )
    .replace(
      /\b(password|token|secret|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}]+)/gi,
      (_match, label: string) => `${label} ${REDACTED_SECRET}`,
    );
}

function commonActionDisabledReason(
  actionBusy: boolean,
  loading: boolean,
): DisabledActionReason | undefined {
  if (actionBusy) {
    return {
      id: 'version-action-busy',
      message: 'Wait for the current version action to finish.',
    };
  }
  if (loading) {
    return { id: 'version-status-refreshing', message: 'Version status is refreshing.' };
  }
  return undefined;
}

function actionSurfaceDisabledReason(
  surface: VersionSurfaceStatus | undefined,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  if (!surface) {
    return {
      id: 'version-surface-unavailable',
      message: 'Version surface status is unavailable.',
    };
  }
  if (!surface.featureGateEnabled) {
    return { id: 'versioning-disabled', message: VERSIONING_DISABLED_REASON };
  }
  const readReason = capabilityDisabledReason(surface, 'version:read');
  if (readReason) return readReason;
  const capabilityReason = capabilityDisabledReason(surface, capability);
  if (capabilityReason) return capabilityReason;
  return publicStatusDisabledReason(surface, capability);
}

function publicStatusDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const hostDeniedReason = hostCapabilityDiagnosticDisabledReason(surface, capability);
  if (hostDeniedReason) return hostDeniedReason;

  const action = publicStatusActionForCapability(capability);
  if (!action) return undefined;

  const staleReason = currentStaleDisabledReason(surface, action);
  if (staleReason) return staleReason;

  const dirtyStatusReason = dirtyStatusDisabledReasonForCapability(surface, capability);
  if (dirtyStatusReason) return dirtyStatusReason;

  const providerWriteReason = providerWritesDisabledReasonForCapability(surface, capability);
  if (providerWriteReason) return providerWriteReason;

  const unsupportedDomainAction = unsupportedDirtyDomainActionForCapability(capability);
  if (unsupportedDomainAction) {
    const unsupportedDomainReason = unsupportedDirtyDomainsDisabledReason(
      surface,
      unsupportedDomainAction,
    );
    if (unsupportedDomainReason) return unsupportedDomainReason;
  }

  return publicStatusDiagnosticDisabledReason(surface, capability);
}

function publicStatusActionForCapability(
  capability: VersionCapability,
): CurrentStaleAction | undefined {
  switch (capability) {
    case 'version:commit':
      return 'commit';
    case 'version:checkout':
      return 'checkout';
    case 'version:revert':
      return 'rollback';
    case 'version:reviewRead':
    case 'version:reviewWrite':
    case 'version:proposal':
      return 'review';
    case 'version:mergePreview':
    case 'version:mergeApply':
      return 'merge';
    case 'version:provenance':
      return 'export';
    case 'version:remotePromote':
      return 'remotePromote';
    default:
      return undefined;
  }
}

function unsupportedDirtyDomainActionForCapability(
  capability: VersionCapability,
): 'commit' | 'checkout' | 'review' | 'merge' | 'export' | undefined {
  switch (capability) {
    case 'version:commit':
      return 'commit';
    case 'version:checkout':
      return 'checkout';
    case 'version:reviewRead':
    case 'version:reviewWrite':
    case 'version:proposal':
      return 'review';
    case 'version:mergePreview':
    case 'version:mergeApply':
      return 'merge';
    case 'version:provenance':
      return 'export';
    default:
      return undefined;
  }
}

function hostCapabilityDiagnosticDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const diagnostic = allSurfaceDiagnostics(surface).find((item) =>
    hostCapabilityDiagnosticApplies(item, capability),
  );
  if (!diagnostic) return undefined;

  return {
    id: 'version-capability-host-denied',
    message: fallbackDiagnosticMessage('version-capability-host-denied'),
  };
}

function hostCapabilityDiagnosticApplies(
  diagnostic: VersionDiagnostic,
  capability: VersionCapability,
): boolean {
  if (
    diagnostic.code !== 'version.surfaceStatus.hostCapabilityDenied' &&
    diagnostic.dependency !== 'hostCapability'
  ) {
    return false;
  }

  const data = diagnosticData(diagnostic);
  const deniedCapabilities = [
    ...diagnosticStringArray(data, 'deniedCapabilities'),
    ...diagnosticStringArray(data, 'capabilities'),
    ...diagnosticStringArray(data, 'capability'),
  ];
  if (deniedCapabilities.length === 0) return true;
  return deniedCapabilities.includes(capability) || deniedCapabilities.includes('version:read');
}

function publicStatusDiagnosticDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  for (const diagnostic of allSurfaceDiagnostics(surface)) {
    const reasonId = publicStatusDiagnosticReasonId(diagnostic, capability);
    if (!reasonId) continue;
    return {
      id: reasonId,
      message: fallbackDiagnosticMessage(reasonId),
    };
  }
  return undefined;
}

function publicStatusDiagnosticReasonId(
  diagnostic: VersionDiagnostic,
  capability: VersionCapability,
): VersionActionDisabledReasonId | undefined {
  if (isStaleHeadDiagnostic(diagnostic)) return 'version-head-stale';
  if (isIncompleteDiffDiagnostic(diagnostic) && incompleteDiffDiagnosticApplies(capability)) {
    return 'version-diff-incomplete';
  }
  if (isUnsupportedDomainDiagnostic(diagnostic)) return 'version-unsupported-domain';
  if (isIncompleteHistoryDiagnostic(diagnostic)) return 'version-history-incomplete';
  return undefined;
}

function isStaleHeadDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const reason = diagnosticString(diagnosticData(diagnostic), 'reason');
  return STALE_HEAD_DIAGNOSTIC_CODES.has(code) || reason === 'stale-head' || reason === 'staleHead';
}

function isUnsupportedDomainDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const data = diagnosticData(diagnostic);
  const category =
    diagnosticString(data, 'category') ??
    diagnosticString(data, 'accessCategory') ??
    diagnosticNestedString(data, 'payload', 'category');
  const reason =
    diagnosticString(data, 'reason') ?? diagnosticNestedString(data, 'payload', 'reason');

  return (
    UNSUPPORTED_DOMAIN_DIAGNOSTIC_CODES.has(code) ||
    category === 'unsupported' ||
    category === 'opaque' ||
    category === 'subset-hidden' ||
    reason === 'unsupportedDomain' ||
    reason === 'opaqueDomain'
  );
}

function isIncompleteDiffDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  return INCOMPLETE_DIFF_DIAGNOSTIC_CODES.has(code) || code.includes('DIFF_COMPLETENESS');
}

function incompleteDiffDiagnosticApplies(capability: VersionCapability): boolean {
  return capability === 'version:reviewRead' ||
    capability === 'version:reviewWrite' ||
    capability === 'version:proposal' ||
    capability === 'version:mergePreview' ||
    capability === 'version:mergeApply';
}

function isIncompleteHistoryDiagnostic(diagnostic: VersionDiagnostic): boolean {
  const code = String(diagnostic.code);
  const category =
    diagnosticString(diagnosticData(diagnostic), 'category') ??
    diagnosticNestedString(diagnosticData(diagnostic), 'payload', 'category');
  return (
    INCOMPLETE_HISTORY_DIAGNOSTIC_CODES.has(code) ||
    code.includes('HISTORY_GAP') ||
    category === 'incomplete'
  );
}

function fallbackDiagnosticMessage(reasonId: VersionActionDisabledReasonId): string {
  switch (reasonId) {
    case 'version-capability-host-denied':
      return 'Host policy denies this version capability.';
    case 'version-diff-incomplete':
      return 'Review or merge diff diagnostics are incomplete; refresh version status before continuing.';
    case 'version-dirty-status-unavailable':
      return DIRTY_STATUS_UNAVAILABLE_REASON;
    case 'version-head-stale':
      return 'Refresh version status before continuing.';
    case 'version-history-incomplete':
      return 'Version history is incomplete for this action.';
    case 'version-unsupported-domain':
      return 'This version action includes unsupported domains.';
    default:
      return 'This version action is unavailable.';
  }
}

function capabilityDisabledReason(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const state = surface.capabilities[capability];
  const fallbackReason = `${ACTION_CAPABILITY_LABELS[capability] ?? capability} is unavailable.`;
  if (!state) return { id: 'version-capability-unavailable', message: fallbackReason };
  if (state.enabled) return undefined;
  return {
    id:
      state.dependency === 'hostCapability'
        ? 'version-capability-host-denied'
        : 'version-capability-unavailable',
    message: state.reason || fallbackReason,
  };
}

function commitDirtyDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty;

  const providerWriteReason = providerWritesDisabledReason(surface, 'committing');
  if (providerWriteReason) return providerWriteReason;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'commit');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) {
    return {
      id: 'version-recalc-pending',
      message: 'Wait for recalculation to settle before committing.',
    };
  }
  if (dirty.commitEligibleChanges) return undefined;
  if (!dirty.hasUncommittedLocalChanges) {
    return {
      id: 'version-commit-no-local-changes',
      message: 'Make a workbook change before committing.',
    };
  }
  return (
    diagnosticMessageReason(dirty.diagnostics, 'version-commit-no-eligible-changes') ?? {
      id: 'version-commit-no-eligible-changes',
      message: 'No commit-eligible local changes are available.',
    }
  );
}

type CurrentStaleAction =
  | 'commit'
  | 'checkout'
  | 'rollback'
  | 'review'
  | 'merge'
  | 'export'
  | 'remotePromote';

function currentStaleDisabledReason(
  surface: VersionSurfaceStatus,
  action: CurrentStaleAction,
): DisabledActionReason | undefined {
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
        : action === 'rollback'
          ? 'Refresh before staging rollback.'
          : action === 'review'
            ? 'Refresh before reviewing version changes.'
            : action === 'merge'
              ? 'Refresh before merging.'
              : action === 'remotePromote'
                ? 'Refresh before promoting remote changes.'
                : 'Refresh before exporting version metadata.';
  return {
    id: 'version-head-stale',
    message: `${branchLabel} is stale because ${reason}. ${suffix}`,
  };
}

function checkoutUnsafeDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty;
  if (dirty.checkoutSafe) return undefined;

  const dirtyDomainReason = unsupportedDirtyDomainsDisabledReason(surface, 'checkout');
  if (dirtyDomainReason) return dirtyDomainReason;

  if (dirty.pendingRecalc) {
    return {
      id: 'version-recalc-pending',
      message: 'Wait for recalculation to settle before checking out.',
    };
  }

  const diagnosticMessage =
    firstDiagnosticMessage(dirty.unsafeReasons) ?? firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage) return { id: 'version-checkout-unsafe', message: diagnosticMessage };
  if (dirty.hasUncommittedLocalChanges) {
    return {
      id: 'version-checkout-unsafe',
      message: 'Commit or discard local changes before checking out.',
    };
  }
  return {
    id: 'version-checkout-unsafe',
    message: 'Checkout preflight is unsafe for this workbook.',
  };
}

function providerWritesDisabledReason(
  surface: VersionSurfaceStatus,
  action: string,
): DisabledActionReason | undefined {
  return surface.dirty.pendingProviderWrites
    ? {
        id: 'version-provider-writes-pending',
        message: `Wait for provider writes to settle before ${action}.`,
      }
    : undefined;
}

function dirtyStatusDisabledReasonForCapability(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  return dirtyStatusRequiredForCapability(capability)
    ? dirtyStatusUnavailableDisabledReason(surface)
    : undefined;
}

function dirtyStatusRequiredForCapability(capability: VersionCapability): boolean {
  switch (capability) {
    case 'version:commit':
    case 'version:checkout':
    case 'version:reviewWrite':
    case 'version:proposal':
    case 'version:mergeApply':
    case 'version:revert':
    case 'version:provenance':
    case 'version:remotePromote':
      return true;
    default:
      return false;
  }
}

function dirtyStatusUnavailableDisabledReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  const dirty = surface.dirty as Partial<VersionSurfaceStatus['dirty']> & {
    readonly source?: unknown;
  };
  if (
    dirty.source === 'VC-05' &&
    typeof dirty.statusRevision === 'string' &&
    dirty.statusRevision.length > 0 &&
    typeof dirty.checkoutPreflightToken === 'string' &&
    dirty.checkoutPreflightToken.length > 0 &&
    Array.isArray(dirty.unsupportedDirtyDomains) &&
    Array.isArray(dirty.unsafeReasons) &&
    Array.isArray(dirty.diagnostics)
  ) {
    return undefined;
  }

  return {
    id: 'version-dirty-status-unavailable',
    message: DIRTY_STATUS_UNAVAILABLE_REASON,
  };
}

function providerWritesDisabledReasonForCapability(
  surface: VersionSurfaceStatus,
  capability: VersionCapability,
): DisabledActionReason | undefined {
  const action = providerWriteActionForCapability(capability);
  if (!action) return undefined;
  return providerWritesDiagnosticReason(surface) ?? providerWritesDisabledReason(surface, action);
}

function providerWriteActionForCapability(capability: VersionCapability): string | undefined {
  switch (capability) {
    case 'version:commit':
      return 'committing';
    case 'version:checkout':
      return 'checking out';
    case 'version:reviewWrite':
      return 'updating reviews';
    case 'version:proposal':
      return 'updating proposals';
    case 'version:mergeApply':
      return 'applying merge changes';
    case 'version:revert':
      return 'staging rollback';
    case 'version:provenance':
      return 'exporting version metadata';
    default:
      return undefined;
  }
}

function providerWritesDiagnosticReason(
  surface: VersionSurfaceStatus,
): DisabledActionReason | undefined {
  if (!surface.dirty.pendingProviderWrites) return undefined;
  const pendingProviderDiagnostics = [
    ...surface.dirty.unsafeReasons,
    ...surface.dirty.diagnostics,
  ].filter((diagnostic) => diagnostic.code === 'version.surfaceStatus.pendingProviderWrites');
  return diagnosticMessageReason(pendingProviderDiagnostics, 'version-provider-writes-pending');
}

function unsupportedDirtyDomainsDisabledReason(
  surface: VersionSurfaceStatus,
  action: 'commit' | 'checkout' | 'review' | 'merge' | 'export',
): DisabledActionReason | undefined {
  const dirty = surface.dirty;
  if (dirty.unsupportedDirtyDomains.length === 0) return undefined;

  const diagnosticMessage = firstDiagnosticMessage(dirty.diagnostics);
  if (diagnosticMessage && dirty.unsupportedDirtyDomains.includes('unknown')) {
    return { id: 'version-unsupported-domain', message: diagnosticMessage };
  }

  const domains = formatInlineList(dirty.unsupportedDirtyDomains);
  if (action === 'commit') {
    return {
      id: 'version-unsupported-domain',
      message: `Changes in ${domains} cannot be committed yet.`,
    };
  }
  if (action === 'checkout') {
    return {
      id: 'version-unsupported-domain',
      message: `Commit or discard changes in ${domains} before checking out.`,
    };
  }
  const actionLabel =
    action === 'review'
      ? 'reviewed'
      : action === 'merge'
        ? 'merged'
        : 'exported with version metadata';
  return {
    id: 'version-unsupported-domain',
    message: `Changes in ${domains} cannot be ${actionLabel} yet.`,
  };
}

function firstDiagnosticMessage(
  diagnostics: readonly Pick<VersionDiagnostic, 'message'>[],
): string | undefined {
  return diagnostics.find((diagnostic) => diagnostic.message.trim().length > 0)?.message;
}

function diagnosticMessageReason(
  diagnostics: readonly Pick<VersionDiagnostic, 'message'>[],
  id: VersionActionDisabledReasonId,
): DisabledActionReason | undefined {
  const message = firstDiagnosticMessage(diagnostics);
  return message ? { id, message } : undefined;
}

function allSurfaceDiagnostics(surface: VersionSurfaceStatus): readonly VersionDiagnostic[] {
  return [
    ...diagnosticsArray(surface.diagnostics),
    ...diagnosticsArray(surface.storage?.diagnostics),
    ...diagnosticsArray(surface.dirty?.diagnostics),
    ...diagnosticsArray(surface.dirty?.unsafeReasons),
  ];
}

function diagnosticsArray(value: unknown): readonly VersionDiagnostic[] {
  return Array.isArray(value) ? (value as readonly VersionDiagnostic[]) : [];
}

function diagnosticData(
  diagnostic: VersionDiagnostic,
): Readonly<Record<string, unknown>> | undefined {
  const data = diagnostic.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Readonly<Record<string, unknown>>)
    : undefined;
}

function diagnosticString(
  data: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function diagnosticStringArray(
  data: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  const value = data?.[key];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function diagnosticNestedString(
  data: Readonly<Record<string, unknown>> | undefined,
  parentKey: string,
  key: string,
): string | undefined {
  const parent = data?.[parentKey];
  return parent && typeof parent === 'object' && !Array.isArray(parent)
    ? diagnosticString(parent as Readonly<Record<string, unknown>>, key)
    : undefined;
}

function formatInlineList(values: readonly string[]): string {
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`;
}

function enabledAction(): VersionActionAvailability {
  return { enabled: true };
}

function disabledAction(
  idOrReason: VersionActionDisabledReasonId | DisabledActionReason,
  message?: string,
): VersionActionAvailability {
  const reason =
    typeof idOrReason === 'string'
      ? { id: idOrReason, message: message ?? idOrReason }
      : idOrReason;
  const fallback = fallbackDiagnosticMessage(reason.id);
  return {
    enabled: false,
    disabledReason: sanitizeVersionStatusText(reason.message, fallback) ?? fallback,
    disabledReasonId: reason.id,
  };
}
