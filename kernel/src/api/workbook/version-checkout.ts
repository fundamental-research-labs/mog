import type {
  VersionCheckoutDependencyRole,
  VersionCheckoutDependencySummary,
  VersionCheckoutOptions,
  VersionCheckoutPlan,
  VersionCheckoutResolvedTarget,
  VersionCheckoutResult,
  VersionCheckoutTarget,
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type {
  CheckoutMaterializationRequest,
  CheckoutMaterializationResult,
} from '../../document/version-store/checkout-service';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from '../../document/version-store/ref-name';
import {
  readVersionCheckoutAdmissionState,
  revalidateVersionCheckoutAdmissionLease,
  type VersionCheckoutAdmissionBlock,
} from './version-checkout-admission';
import {
  checkoutSyncBatchStatusBlockedDiagnostic,
  recoverabilityForCheckoutIssue,
  safeMessageForCheckoutIssue,
} from './version-checkout-diagnostics';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';
import { validateVersionOperationGate } from './version-operation-gate';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_CHECKOUT_OPTION_KEYS = new Set(['includeDiagnostics', 'requireClean']);
const VERSION_CHECKOUT_TARGET_KIND_KEYS = new Set(['kind']);
const VERSION_CHECKOUT_TARGET_COMMIT_KEYS = new Set(['id', 'kind']);
const VERSION_CHECKOUT_TARGET_REF_KEYS = new Set(['kind', 'name']);
const VERSION_CHECKOUT_DEPENDENCY_ROLES = new Set<VersionCheckoutDependencyRole>([
  'snapshotRoot',
  'semanticChangeSet',
  'mutationSegment',
  'redactionSummary',
  'verificationSummary',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type VersionCheckoutOperation = 'checkout';
type CheckoutFailureMutationGuarantee = 'no-workbook-mutation' | 'unknown-after-partial-mutation';

export type VersionCheckoutTransactionToken = object;

export type VersionCheckoutTransactionBeginResult =
  | {
      readonly ok: true;
      readonly token: VersionCheckoutTransactionToken;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export interface VersionCheckoutTransactionGuard {
  beginCheckoutTransaction(): VersionCheckoutTransactionBeginResult;
  endCheckoutTransaction(token: VersionCheckoutTransactionToken): void;
}

type AttachedCheckoutMaterializationService = {
  planCheckout?: (request: CheckoutMaterializationRequest) => MaybePromise<unknown>;
  checkout?: (request: CheckoutMaterializationRequest) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ParsedCheckoutTarget =
  | {
      readonly ok: true;
      readonly request: CheckoutMaterializationRequest;
      readonly payload: VersionDiagnosticPublicPayload;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export async function checkoutWorkbookVersion(
  ctx: DocumentContext,
  target: VersionCheckoutTarget,
  options: VersionCheckoutOptions = {},
  transactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionCheckoutResult> {
  const optionDiagnostics = validateCheckoutOptions(options);
  if (optionDiagnostics.length > 0) {
    return degradedCheckout(optionDiagnostics);
  }

  const parsed = validateCheckoutTarget(target);
  if (!parsed.ok) {
    return degradedCheckout(parsed.diagnostics);
  }

  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'checkout',
    'version:checkout',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedCheckout(operationGateDiagnostics);
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'checkout');
  if (gateDiagnostics.length > 0) {
    return degradedCheckout(gateDiagnostics);
  }

  const service = getAttachedCheckoutMaterializationService(ctx);
  if (!service?.planCheckout && !service?.checkout) {
    return degradedCheckout([serviceUnavailableDiagnostic(parsed.payload)]);
  }

  const admission = await readVersionCheckoutAdmissionState(ctx);
  if (admission.block) {
    return degradedCheckout([checkoutAdmissionDiagnostic(admission.block, parsed.payload)]);
  }

  const transaction = transactionGuard?.beginCheckoutTransaction();
  if (transaction && !transaction.ok) {
    return degradedCheckout(transaction.diagnostics);
  }
  const token = transaction?.token ?? null;
  const fencedBlock = await revalidateVersionCheckoutAdmissionLease(ctx, admission.lease);
  if (fencedBlock) {
    if (token) transactionGuard?.endCheckoutTransaction(token);
    return degradedCheckout([checkoutAdmissionDiagnostic(fencedBlock, parsed.payload)]);
  }

  try {
    const planCheckout = service.planCheckout;
    if (service.checkout) {
      const checkoutResult = await service.checkout(parsed.request);
      if (!isMaterializerUnavailableResult(checkoutResult) || !planCheckout) {
        return mapCheckoutResult(checkoutResult, parsed.payload);
      }
    }
    if (!planCheckout) {
      return degradedCheckout([serviceUnavailableDiagnostic(parsed.payload)]);
    }
    return mapCheckoutResult(await planCheckout(parsed.request), parsed.payload);
  } catch {
    return degradedCheckout([providerErrorDiagnostic(parsed.payload)]);
  } finally {
    if (token) transactionGuard?.endCheckoutTransaction(token);
  }
}

export function hasAttachedVersionCheckoutService(ctx: DocumentContext): boolean {
  return getAttachedCheckoutMaterializationService(ctx) !== null;
}

function getAttachedCheckoutMaterializationService(
  ctx: DocumentContext,
): AttachedCheckoutMaterializationService | null {
  const services = getAttachedVersionRuntimeServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.checkoutService,
    services.checkoutMaterializationService,
    services.materializationService,
    services.versionCheckoutService,
    services.publicCheckoutService,
    services,
  ]) {
    const service = toCheckoutMaterializationService(candidate);
    if (service) return service;
  }

  return null;
}

function getAttachedVersionRuntimeServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function toCheckoutMaterializationService(
  value: unknown,
): AttachedCheckoutMaterializationService | null {
  const planCheckout = bindMethod(value, 'planCheckout');
  const checkout = bindMethod(value, 'checkout');
  if (!planCheckout && !checkout) return null;

  return {
    ...(planCheckout ? { planCheckout: (request) => planCheckout(request) } : {}),
    ...(checkout ? { checkout: (request) => checkout(request) } : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function validateCheckoutOptions(input: VersionCheckoutOptions): readonly VersionStoreDiagnostic[] {
  if (input === undefined) return [];
  if (!isRecord(input) || Array.isArray(input)) {
    return [
      invalidOptionsDiagnostic('checkout options must be an object when supplied.', {
        option: 'options',
      }),
    ];
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const key of Object.keys(input)) {
    if (!VERSION_CHECKOUT_OPTION_KEYS.has(key)) {
      diagnostics.push(invalidOptionsDiagnostic('Unsupported checkout option.', { option: key }));
    }
  }

  if (
    'includeDiagnostics' in input &&
    input.includeDiagnostics !== undefined &&
    typeof input.includeDiagnostics !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic('includeDiagnostics must be a boolean when supplied.', {
        option: 'includeDiagnostics',
      }),
    );
  }
  if (
    'requireClean' in input &&
    input.requireClean !== undefined &&
    typeof input.requireClean !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic('requireClean must be a boolean when supplied.', {
        option: 'requireClean',
      }),
    );
  } else if (input.requireClean === false) {
    diagnostics.push(requireCleanUnsupportedDiagnostic());
  }

  return diagnostics;
}

function validateCheckoutTarget(input: VersionCheckoutTarget): ParsedCheckoutTarget {
  if (!isRecord(input) || Array.isArray(input)) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('checkout target must be an object.', { option: 'target' }),
      ],
    };
  }
  const rawTarget = input as Readonly<Record<string, unknown>>;

  if (input.kind === 'head') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_KIND_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('HEAD checkout target must contain only kind.', {
            targetKind: 'head',
          }),
        ],
      };
    }
    return {
      ok: true,
      request: { target: 'ref', refName: VERSION_HEAD_REF },
      payload: { targetKind: 'head', refName: VERSION_HEAD_REF },
    };
  }

  if (input.kind === 'commit') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_COMMIT_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Commit checkout target must contain kind and id.', {
            targetKind: 'commit',
          }),
        ],
      };
    }
    const commitId = toCommitId(input.id);
    if (!commitId) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Checkout commit target id is invalid.', {
            targetKind: 'commit',
            option: 'id',
          }),
        ],
      };
    }
    return {
      ok: true,
      request: { target: 'commit', commitId },
      payload: { targetKind: 'commit', commitId },
    };
  }

  if (input.kind === 'ref') {
    if (!hasExactKeys(input, VERSION_CHECKOUT_TARGET_REF_KEYS)) {
      return {
        ok: false,
        diagnostics: [
          invalidTargetDiagnostic('Ref checkout target must contain kind and name.', {
            targetKind: 'ref',
          }),
        ],
      };
    }
    const ref = parseCheckoutRefName(input.name);
    if (!ref.ok) return { ok: false, diagnostics: ref.diagnostics };
    return {
      ok: true,
      request: { target: 'ref', refName: ref.serviceRefName },
      payload: {
        targetKind: ref.serviceRefName === VERSION_HEAD_REF ? 'head' : 'ref',
        refName: ref.publicRefName,
      },
    };
  }

  return {
    ok: false,
    diagnostics: [
      invalidTargetDiagnostic('Unsupported checkout target kind.', {
        targetKind: formatUnknown(rawTarget.kind),
      }),
    ],
  };
}

function parseCheckoutRefName(value: unknown):
  | {
      readonly ok: true;
      readonly serviceRefName: string;
      readonly publicRefName: string;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (value === VERSION_HEAD_REF) {
    return { ok: true, serviceRefName: VERSION_HEAD_REF, publicRefName: VERSION_HEAD_REF };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('Checkout ref target name must be a string.', {
          targetKind: 'ref',
          option: 'name',
        }),
      ],
    };
  }

  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const validated = validateRefName(branchName, 'target.name');
  if (!validated.ok) {
    return {
      ok: false,
      diagnostics: [
        invalidTargetDiagnostic('Checkout ref target is not public-safe.', {
          targetKind: 'ref',
          refName: 'redacted',
        }),
      ],
    };
  }

  return {
    ok: true,
    serviceRefName: validated.name,
    publicRefName: publicRefNameForBranch(validated.name),
  };
}

function mapCheckoutResult(
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

function isMaterializerUnavailableResult(value: unknown): boolean {
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

function serviceUnavailableDiagnostic(
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_SERVICE_UNAVAILABLE',
    'No document-scoped checkout materialization service is attached; no workbook state is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

function invalidTargetDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_CHECKOUT_INVALID_TARGET', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

function invalidOptionsDiagnostic(
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload,
  });
}

function requireCleanUnsupportedDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_REQUIRE_CLEAN_UNSUPPORTED',
    'Checkout cannot discard dirty working state; requireClean:false is not supported.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { option: 'requireClean', requireClean: false },
    },
  );
}

function checkoutAdmissionDiagnostic(
  block: VersionCheckoutAdmissionBlock,
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  switch (block.reason) {
    case 'dirtyWorkingState':
      return checkoutDirtyWorkingStateDiagnostic({ ...payload, reason: block.reason });
    case 'pendingProviderWrites':
      return checkoutPendingProviderWritesDiagnostic({
        ...payload,
        reason: block.reason,
        ...(block.pendingRemoteSegmentCount === undefined
          ? {}
          : { pendingRemoteSegmentCount: block.pendingRemoteSegmentCount }),
        ...(block.remoteSyncApplyActiveCount === undefined
          ? {}
          : { remoteSyncApplyActiveCount: block.remoteSyncApplyActiveCount }),
        ...(block.pendingRemotePromotionActiveCount === undefined
          ? {}
          : { pendingRemotePromotionActiveCount: block.pendingRemotePromotionActiveCount }),
        ...(block.pendingRemotePromotionQueuedCount === undefined
          ? {}
          : { pendingRemotePromotionQueuedCount: block.pendingRemotePromotionQueuedCount }),
      });
    case 'syncBatchStatusBlocked':
      return checkoutSyncBatchStatusBlockedDiagnostic(block, payload);
    case 'pendingRecalc':
      return checkoutPendingRecalcDiagnostic({ ...payload, reason: block.reason });
    case 'liveCollaborationActive':
      return checkoutLiveCollaborationActiveDiagnostic({
        ...payload,
        reason: block.reason,
        ...(block.collaborationState ? { collaborationState: block.collaborationState } : {}),
        ...(block.roomId ? { roomId: block.roomId } : {}),
        ...(block.sidecarStatus ? { sidecarStatus: block.sidecarStatus } : {}),
        ...(block.activeParticipantCount === undefined
          ? {}
          : { activeParticipantCount: block.activeParticipantCount }),
        ...(block.remoteProviderAttached === undefined
          ? {}
          : { remoteProviderAttached: block.remoteProviderAttached }),
        ...(block.inFlightRemoteUpdateCount === undefined
          ? {}
          : { inFlightRemoteUpdateCount: block.inFlightRemoteUpdateCount }),
        ...(block.syncApplyRemoteQueueDepth === undefined
          ? {}
          : { syncApplyRemoteQueueDepth: block.syncApplyRemoteQueueDepth }),
      });
    case 'checkoutAlreadyInProgress':
    case 'checkoutPreflightUnsafe':
      return checkoutWriteFenceUnavailableDiagnostic({ ...payload, reason: block.reason });
    case 'checkoutPreflightStale':
      return checkoutWriteFenceStaleDiagnostic({ ...payload, reason: block.reason });
    case 'staleWorkspaceHead':
      return checkoutStaleWorkspaceHeadDiagnostic({
        ...payload,
        reason: block.reason,
        staleReason: block.staleReason,
        ...(block.branchName ? { branchName: block.branchName } : {}),
        ...(block.checkedOutCommitId ? { checkedOutCommitId: block.checkedOutCommitId } : {}),
        ...(block.refHeadAtMaterialization
          ? { refHeadAtMaterialization: block.refHeadAtMaterialization }
          : {}),
        ...(block.currentRefHeadId ? { currentRefHeadId: block.currentRefHeadId } : {}),
      });
  }
}

export function checkoutDirtyWorkingStateDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
    'Checkout requires a clean workbook and did not apply the target snapshot.',
    {
      severity: 'error',
      recoverability: 'none',
      payload,
    },
  );
}

function checkoutPendingProviderWritesDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PENDING_PROVIDER_WRITES',
    'Checkout is blocked while remote sync changes are waiting to be promoted into version history.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutPendingRecalcDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PENDING_RECALC',
    'Checkout is blocked while workbook recalculation is not settled.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutLiveCollaborationActiveDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_LIVE_COLLABORATION_ACTIVE',
    'Checkout is blocked while live collaboration is active or cannot be proven idle.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function checkoutStaleWorkspaceHeadDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
    'Checkout is blocked because the active checkout session is stale relative to its ref head.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function checkoutWriteFenceUnavailableDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_WRITE_FENCE_UNAVAILABLE',
    'Checkout could not acquire a local write fence before materialization.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function checkoutWriteFenceStaleDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_WRITE_FENCE_STALE',
    'Workbook state changed while checkout materialization was in progress.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function invalidPayloadDiagnostic(payload: VersionDiagnosticPublicPayload): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The checkout materialization service returned an invalid public checkout plan.',
    {
      severity: 'error',
      recoverability: 'repair',
      payload,
    },
  );
}

function providerErrorDiagnostic(payload: VersionDiagnosticPublicPayload): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_PROVIDER_ERROR',
    'The checkout materialization service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForCheckoutIssue(issueCode),
    messageTemplateId: `version.checkout.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

function degradedCheckout(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee:
    | 'no-workbook-mutation'
    | 'unknown-after-partial-mutation' = 'no-workbook-mutation',
): VersionCheckoutResult {
  return {
    status: 'degraded',
    materialization: 'not-applied',
    plan: null,
    diagnostics,
    mutationGuarantee,
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

function toPublicRefName(value: unknown): VersionMainRefName | VersionRefName | null {
  if (typeof value !== 'string') return null;
  if (value === VERSION_HEAD_REF) return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const validated = validateRefName(branchName);
  if (!validated.ok) return null;
  return publicRefNameForBranch(validated.name);
}

function publicRefNameForBranch(name: string): VersionMainRefName | VersionRefName {
  if (name === 'main') return VERSION_MAIN_REF;
  return `${REF_NAME_STORAGE_PREFIX}${name}` as VersionRefName;
}

function safePublicDiagnosticRefName(value: string): string {
  if (value === VERSION_HEAD_REF || value === VERSION_MAIN_REF) return value;
  const publicRef = toPublicRefName(value);
  return publicRef ?? 'redacted';
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: Set<string>,
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}
