import type {
  VersionHistoryRootGapPolicy,
  VersionHistoryRootPolicy,
} from '@mog-sdk/contracts/versioning';

import { versionStoreDiagnostic, type VersionStoreDiagnostic } from './provider';
import type { VersionStoreOperation } from './provider-types';

export const VERSION_HISTORY_ROOT_KINDS = Object.freeze([
  'new',
  'import',
  'existing-no-history',
  'external-change',
  'reconcile',
  'recovery',
] as const);

export type VersionHistoryRootKind = (typeof VERSION_HISTORY_ROOT_KINDS)[number];

export type VersionHistoryRootPolicyFact = boolean | 'unknown';

export type VersionHistoryRootPolicyInput = {
  readonly kind: VersionHistoryRootKind | string | undefined;
  readonly policy: VersionHistoryRootPolicy | undefined;
  readonly operation: VersionStoreOperation;
  readonly hasExistingVisibleHistory: VersionHistoryRootPolicyFact;
  readonly trustedBase?: VersionHistoryRootPolicyFact;
  readonly rootCommitMatchesPolicy?: VersionHistoryRootPolicyFact;
};

export type VersionHistoryRootPolicyDecision =
  | { readonly ok: true; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type VersionHistoryRootPolicyBlockReason =
  | 'missing-policy'
  | 'invalid-policy'
  | 'unknown-root-kind'
  | 'policy-root-mismatch'
  | 'existing-history-unknown'
  | 'detached-root-disallowed'
  | 'history-gap-rejected'
  | 'external-change-history-unverified'
  | 'external-change-base-untrusted';

const VERSION_HISTORY_ROOT_KIND_SET = new Set<string>(VERSION_HISTORY_ROOT_KINDS);
const VERSION_HISTORY_ROOT_GAP_POLICIES = new Set<string>([
  'reject',
  'record-gap',
  'allow-opaque-root',
]);

export function evaluateVersionHistoryRootPolicy(
  input: VersionHistoryRootPolicyInput,
): VersionHistoryRootPolicyDecision {
  const kind = publicRootKind(input.kind);
  const policy = normalizeVersionHistoryRootPolicy(input.policy);
  if (!policy) return blocked(input, 'missing-policy', kind);
  if (!kind) return blocked(input, 'unknown-root-kind', undefined, policy);
  if (!isWellFormedVersionHistoryRootPolicy(input.policy)) {
    return blocked(input, 'invalid-policy', kind, policy);
  }
  if (input.rootCommitMatchesPolicy === false) {
    return blocked(input, 'policy-root-mismatch', kind, policy);
  }

  switch (kind) {
    case 'new':
    case 'import':
      return evaluatePrimaryRoot(input, kind, policy);
    case 'existing-no-history':
    case 'reconcile':
    case 'recovery':
      return evaluateGapRoot(input, kind, policy);
    case 'external-change':
      return evaluateExternalChangeRoot(input, kind, policy);
  }
}

export function versionHistoryRootPolicyBlockedDiagnostics(
  input: VersionHistoryRootPolicyInput,
): readonly VersionStoreDiagnostic[] {
  const decision = evaluateVersionHistoryRootPolicy(input);
  return decision.ok ? [] : decision.diagnostics;
}

function evaluatePrimaryRoot(
  input: VersionHistoryRootPolicyInput,
  kind: VersionHistoryRootKind,
  policy: NormalizedVersionHistoryRootPolicy,
): VersionHistoryRootPolicyDecision {
  if (input.hasExistingVisibleHistory === 'unknown') {
    return blocked(input, 'existing-history-unknown', kind, policy);
  }
  if (input.hasExistingVisibleHistory && !policy.allowDetachedRoots) {
    return blocked(input, 'detached-root-disallowed', kind, policy);
  }
  return allowed();
}

function evaluateGapRoot(
  input: VersionHistoryRootPolicyInput,
  kind: VersionHistoryRootKind,
  policy: NormalizedVersionHistoryRootPolicy,
): VersionHistoryRootPolicyDecision {
  if (policy.gapPolicy === 'reject') {
    return blocked(input, 'history-gap-rejected', kind, policy);
  }
  if (input.hasExistingVisibleHistory === 'unknown') {
    return blocked(input, 'existing-history-unknown', kind, policy);
  }
  if (!input.hasExistingVisibleHistory && !policy.allowDetachedRoots) {
    return blocked(input, 'detached-root-disallowed', kind, policy);
  }
  return allowed();
}

function evaluateExternalChangeRoot(
  input: VersionHistoryRootPolicyInput,
  kind: VersionHistoryRootKind,
  policy: NormalizedVersionHistoryRootPolicy,
): VersionHistoryRootPolicyDecision {
  if (input.hasExistingVisibleHistory !== true) {
    return blocked(input, 'external-change-history-unverified', kind, policy);
  }
  if (input.trustedBase !== true) {
    return blocked(input, 'external-change-base-untrusted', kind, policy);
  }
  return allowed();
}

function allowed(): VersionHistoryRootPolicyDecision {
  return { ok: true, diagnostics: [] };
}

function blocked(
  input: VersionHistoryRootPolicyInput,
  reason: VersionHistoryRootPolicyBlockReason,
  kind?: VersionHistoryRootKind,
  policy?: NormalizedVersionHistoryRootPolicy,
): VersionHistoryRootPolicyDecision {
  return {
    ok: false,
    diagnostics: [rootPolicyDiagnostic(input, reason, kind, policy)],
  };
}

function rootPolicyDiagnostic(
  input: VersionHistoryRootPolicyInput,
  reason: VersionHistoryRootPolicyBlockReason,
  kind: VersionHistoryRootKind | undefined,
  policy: NormalizedVersionHistoryRootPolicy | undefined,
): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_HISTORY_ROOT_POLICY_BLOCKED', {
    operation: input.operation,
    safeMessage: safeMessageForReason(reason),
    recoverability: recoverabilityForReason(reason),
    mutationGuarantee: 'no-write-attempted',
    details: {
      rootPolicy: 'default-history-root-policy',
      rootKind: kind ?? 'unknown',
      reason,
      existingVisibleHistory: factDetail(input.hasExistingVisibleHistory),
      trustedBase: factDetail(input.trustedBase ?? 'unknown'),
      rootCommitPolicy: policy?.rootCommitId === undefined ? 'absent' : 'configured',
      allowDetachedRoots: policy?.allowDetachedRoots ?? false,
      gapPolicy: policy?.gapPolicy ?? 'unknown',
      redacted: true,
    },
  });
}

function safeMessageForReason(reason: VersionHistoryRootPolicyBlockReason): string {
  switch (reason) {
    case 'missing-policy':
    case 'invalid-policy':
    case 'unknown-root-kind':
      return 'Version history root policy could not validate this root transition.';
    case 'policy-root-mismatch':
      return 'Version history root policy does not match this root transition.';
    case 'existing-history-unknown':
      return 'Version history root policy could not verify existing history state.';
    case 'detached-root-disallowed':
      return 'Version history root policy does not allow detached roots.';
    case 'history-gap-rejected':
      return 'Version history root policy rejects roots that would create a history gap.';
    case 'external-change-history-unverified':
      return 'Version history root policy requires verified existing history for external-change roots.';
    case 'external-change-base-untrusted':
      return 'Version history root policy requires a trusted base for external-change roots.';
  }
}

function recoverabilityForReason(
  reason: VersionHistoryRootPolicyBlockReason,
): VersionStoreDiagnostic['recoverability'] {
  switch (reason) {
    case 'external-change-history-unverified':
    case 'external-change-base-untrusted':
    case 'existing-history-unknown':
      return 'retry';
    case 'policy-root-mismatch':
    case 'history-gap-rejected':
    case 'detached-root-disallowed':
      return 'unsupported';
    case 'missing-policy':
    case 'invalid-policy':
    case 'unknown-root-kind':
      return 'none';
  }
}

type NormalizedVersionHistoryRootPolicy = {
  readonly rootCommitId?: string;
  readonly allowDetachedRoots: boolean;
  readonly gapPolicy: VersionHistoryRootGapPolicy;
};

function normalizeVersionHistoryRootPolicy(
  policy: VersionHistoryRootPolicy | undefined,
): NormalizedVersionHistoryRootPolicy | null {
  if (!isRecord(policy)) return null;
  return {
    ...(typeof policy.rootCommitId === 'string' ? { rootCommitId: policy.rootCommitId } : {}),
    allowDetachedRoots: policy.allowDetachedRoots === true,
    gapPolicy: isVersionHistoryRootGapPolicy(policy.gapPolicy) ? policy.gapPolicy : 'reject',
  };
}

function isWellFormedVersionHistoryRootPolicy(policy: unknown): policy is VersionHistoryRootPolicy {
  if (!isRecord(policy)) return false;
  if ('rootCommitId' in policy && typeof policy.rootCommitId !== 'string') return false;
  if (typeof policy.allowDetachedRoots !== 'boolean') return false;
  return isVersionHistoryRootGapPolicy(policy.gapPolicy);
}

function isVersionHistoryRootGapPolicy(value: unknown): value is VersionHistoryRootGapPolicy {
  return typeof value === 'string' && VERSION_HISTORY_ROOT_GAP_POLICIES.has(value);
}

function publicRootKind(value: unknown): VersionHistoryRootKind | undefined {
  return typeof value === 'string' && VERSION_HISTORY_ROOT_KIND_SET.has(value)
    ? (value as VersionHistoryRootKind)
    : undefined;
}

function factDetail(value: VersionHistoryRootPolicyFact): 'true' | 'false' | 'unknown' {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'unknown';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
