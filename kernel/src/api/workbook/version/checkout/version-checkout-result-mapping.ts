import type {
  VersionCheckoutDependencyRole,
  VersionCheckoutDependencySummary,
  VersionCheckoutPlan,
  VersionCheckoutResult,
  VersionCheckoutResolvedTarget,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  recoverabilityForCheckoutIssue,
  safeMessageForCheckoutIssue,
} from './version-checkout-diagnostics';
import {
  degradedCheckout,
  invalidPayloadDiagnostic,
  providerErrorDiagnostic,
  publicDiagnostic,
} from './version-checkout-diagnostic-factories';
import type { CheckoutFailureMutationGuarantee } from './version-checkout-shared';
import {
  isPayloadPrimitive,
  isRecord,
  safePublicDiagnosticRefName,
  toCommitId,
  toPublicRefName,
  toRevision,
} from './version-checkout-shared';

const VERSION_CHECKOUT_DEPENDENCY_ROLES = new Set<VersionCheckoutDependencyRole>([
  'snapshotRoot',
  'semanticChangeSet',
  'mutationSegment',
  'redactionSummary',
  'verificationSummary',
]);

export function mapCheckoutResult(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionCheckoutResult {
  if (!isRecord(value)) {
    return degradedCheckout([providerErrorDiagnostic(fallbackPayload)]);
  }

  if (value.ok === true) {
    const plan = mapCheckoutPlan(value.plan);
    if (!plan) {
      return degradedCheckout([invalidPayloadDiagnostic(fallbackPayload)]);
    }
    if (value.materialization === 'applied') {
      return {
        status: 'success',
        materialization: 'applied',
        plan,
        diagnostics: mapCheckoutDiagnostics(value.diagnostics, fallbackPayload),
        mutationGuarantee: 'workbook-state-materialized',
      };
    }
    return {
      status: 'success',
      materialization: 'planned',
      plan,
      diagnostics: mapCheckoutDiagnostics(value.diagnostics, fallbackPayload),
      mutationGuarantee: 'no-workbook-mutation',
    };
  }

  if (value.ok === false) {
    const mutationGuarantee =
      value.mutationGuarantee === 'unknown-after-partial-mutation'
        ? 'unknown-after-partial-mutation'
        : 'no-workbook-mutation';
    return degradedCheckout(
      mapCheckoutDiagnostics(
        Array.isArray(value.diagnostics)
          ? value.diagnostics
          : isRecord(value.error)
            ? value.error.diagnostics
            : undefined,
        fallbackPayload,
        mutationGuarantee,
      ),
      mutationGuarantee,
    );
  }

  return degradedCheckout([providerErrorDiagnostic(fallbackPayload)]);
}

function mapCheckoutPlan(value: unknown): VersionCheckoutPlan | null {
  if (!isRecord(value) || value.strategy !== 'fullSnapshot') return null;

  const target = mapResolvedTarget(value.resolvedTarget);
  const commitId = toCommitId(value.commitId);
  const parentCommitIds = Array.isArray(value.parentCommitIds)
    ? value.parentCommitIds.map(toCommitId)
    : null;
  const requiredDependencies = Array.isArray(value.requiredDependencies)
    ? value.requiredDependencies.map(mapRequiredDependency)
    : null;

  if (
    !target ||
    !commitId ||
    !parentCommitIds ||
    parentCommitIds.some((parent): parent is null => parent === null) ||
    !requiredDependencies ||
    requiredDependencies.some((dependency): dependency is null => dependency === null)
  ) {
    return null;
  }

  const dependencies = requiredDependencies as VersionCheckoutDependencySummary[];
  return {
    strategy: 'fullSnapshot',
    target,
    commitId,
    parentCommitIds: parentCommitIds as WorkbookCommitId[],
    requiredDependencies: dependencies,
    requiredDependencyCount: dependencies.length,
  };
}

function mapResolvedTarget(value: unknown): VersionCheckoutResolvedTarget | null {
  if (!isRecord(value)) return null;

  if (value.kind === 'commit') {
    const commitId = toCommitId(value.commitId);
    return commitId ? { kind: 'commit', commitId } : null;
  }

  if (value.kind === 'ref') {
    const refName = toPublicRefName(value.refName);
    const commitId = toCommitId(value.commitId);
    const refRevision = toRevision(value.refVersion);
    if (!refName || !commitId || !refRevision) return null;
    return {
      kind: 'ref',
      refName,
      commitId,
      refRevision,
      ...(typeof value.refIncarnationId === 'string'
        ? { refIncarnationId: value.refIncarnationId }
        : {}),
    };
  }

  if (value.kind === 'head') {
    const refName = toPublicRefName(value.refName);
    const commitId = toCommitId(value.commitId);
    if (!refName || !commitId) return null;
    const refRevision = toRevision(value.refVersion);
    return {
      kind: 'head',
      refName,
      commitId,
      ...(refRevision ? { refRevision } : {}),
      ...(typeof value.refIncarnationId === 'string'
        ? { refIncarnationId: value.refIncarnationId }
        : {}),
    };
  }

  return null;
}

function mapRequiredDependency(value: unknown): VersionCheckoutDependencySummary | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (
    typeof role !== 'string' ||
    !VERSION_CHECKOUT_DEPENDENCY_ROLES.has(role as VersionCheckoutDependencyRole)
  ) {
    return null;
  }
  if (typeof value.objectType !== 'string') return null;
  return {
    role: role as VersionCheckoutDependencyRole,
    objectType: value.objectType,
    ...(typeof value.index === 'number' && Number.isInteger(value.index)
      ? { index: value.index }
      : {}),
  };
}

function mapCheckoutDiagnostics(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
  mutationGuarantee?: CheckoutFailureMutationGuarantee,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((entry) => mapCheckoutDiagnostic(entry, fallbackPayload, mutationGuarantee));
}

export function isMaterializerUnavailableResult(value: unknown): boolean {
  if (!isRecord(value) || value.ok !== false) return false;
  if (isRecord(value.error) && value.error.code === 'checkoutMaterializerUnavailable') {
    return true;
  }
  const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics : [];
  return diagnostics.some(
    (entry) => isRecord(entry) && entry.code === 'VERSION_CHECKOUT_MATERIALIZER_UNAVAILABLE',
  );
}

function mapCheckoutDiagnostic(
  value: unknown,
  fallbackPayload: VersionDiagnosticPublicPayload,
  mutationGuarantee?: CheckoutFailureMutationGuarantee,
): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic(fallbackPayload);

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_CHECKOUT_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForCheckoutIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForCheckoutIssue(issueCode),
    payload: sanitizeCheckoutDiagnosticPayload(value, fallbackPayload, mutationGuarantee),
  });
}

function sanitizeCheckoutDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  fallbackPayload: VersionDiagnosticPublicPayload,
  mutationGuarantee?: CheckoutFailureMutationGuarantee,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'checkout',
    ...fallbackPayload,
  };

  if (mutationGuarantee) {
    payload.mutationGuarantee = mutationGuarantee;
    payload.rollbackSafe = mutationGuarantee === 'no-workbook-mutation';
  }

  const commitId = toCommitId(value.commitId);
  if (commitId) payload.commitId = commitId;

  if (typeof value.refName === 'string') {
    payload.refName = safePublicDiagnosticRefName(value.refName);
  }

  if (isRecord(value.dependency)) {
    const dependency = value.dependency;
    if (typeof dependency.objectType === 'string') {
      payload.objectType = dependency.objectType;
    }
  }

  if (typeof value.objectType === 'string') payload.objectType = value.objectType;
  if (typeof value.role === 'string') payload.dependencyRole = value.role;

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of [
      'path',
      'target',
      'cause',
      'identityFenceReason',
      'providerIdentityClass',
      'accessCategory',
      'partialSnapshot',
    ] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}
