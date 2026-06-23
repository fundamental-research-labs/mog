import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../document/version-store/provider';
import { REF_NAME_STORAGE_PREFIX, validateRefName } from '../../document/version-store/ref-name';
import { createComputeBridgeSemanticStateReader } from '../../document/version-store/semantic-state-reader';
import type { WorkbookVersioningConfig } from './types';

const CHECKOUT_REBIND_IDENTITY_FIELD = '__mogCheckoutRebindIdentity';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const CHECKOUT_REBIND_IDENTITY_KEYS = new Set([
  'schemaVersion',
  'providerDocumentScopeKey',
  'providerWorkspaceId',
  'providerDocumentId',
  'providerPrincipalScope',
]);
const MATERIALIZED_CONTEXT_ALLOWED_VERSIONING_KEYS = new Set([
  'surfaceStatusService',
  'versionSurfaceStatusService',
]);

type CheckoutRebindIdentity = {
  readonly schemaVersion: 1;
  readonly providerDocumentScopeKey: string;
  readonly providerWorkspaceId?: string;
  readonly providerDocumentId: string;
  readonly providerPrincipalScope?: string;
};

type RebindIdentityErrorReason =
  | 'currentIdentityInvalid'
  | 'materializationIdentityStale'
  | 'priorCheckoutRefInvalid'
  | 'priorCheckoutRefStale'
  | 'providerDocumentMismatch'
  | 'providerIdentityEnvelopeMismatch'
  | 'providerScopeInvalid'
  | 'providerScopeMismatch';

type ProviderIdentityClass =
  | 'workspace'
  | 'document'
  | 'principal'
  | 'ref'
  | 'scope'
  | 'provider'
  | 'materialization';

type PriorCheckoutSession =
  | {
      readonly checkedOutCommitId: string;
      readonly detached: true;
    }
  | {
      readonly checkedOutCommitId: string;
      readonly detached: false;
      readonly branchName: string;
      readonly refHeadAtMaterialization: string;
      readonly currentRefHeadId?: string;
    };

type BoundMethod = (...args: readonly unknown[]) => unknown;

class VersionCheckoutRebindIdentityError extends Error {
  readonly reason: RebindIdentityErrorReason;
  readonly providerIdentityClass: ProviderIdentityClass;

  constructor(reason: RebindIdentityErrorReason, providerIdentityClass?: ProviderIdentityClass) {
    super('Checkout versioning identity could not be safely rebound.');
    this.name = errorNameForReason(reason);
    this.reason = reason;
    this.providerIdentityClass = providerIdentityClass ?? providerIdentityClassForReason(reason);
  }
}

export function checkoutRebindIdentityDiagnosticDetails(
  error: unknown,
): Readonly<Record<string, string>> | null {
  if (!(error instanceof VersionCheckoutRebindIdentityError)) return null;
  return Object.freeze({
    cause: error.name,
    identityFenceReason: error.reason,
    providerIdentityClass: error.providerIdentityClass,
  });
}

export function rebindVersioningAfterCheckout(input: {
  readonly versioning: unknown;
  readonly nextContext: DocumentContext;
  readonly operationContext?: VersionOperationContext;
}): WorkbookVersioningConfig {
  if (!isVersioningRecord(input.versioning)) return {};
  const identity = providerRebindIdentity(input.versioning);
  validateCurrentRebindIdentity(input.versioning, identity);
  validatePriorCheckoutRefs(input.versioning);
  assertMaterializedContextIsUnbound(input.nextContext, identity);
  seedMaterializedContextRebindIdentity(input.nextContext, identity);

  const semanticStateReader = createComputeBridgeSemanticStateReader(
    input.nextContext.computeBridge,
  );
  resetSemanticMutationCaptureAfterCheckout(
    input.versioning,
    semanticStateReader,
    checkoutResetOperationContext(input.operationContext, input.versioning),
  );
  const config = {
    ...input.versioning,
    snapshotRootByteSyncPort: {
      encodeDiff: (stateVector: Uint8Array) =>
        input.nextContext.computeBridge.encodeDiff(stateVector),
    },
    semanticStateReader,
  } as Record<string, unknown>;
  deleteAttachedVersionServices(config);
  return config as WorkbookVersioningConfig;
}

function providerRebindIdentity(
  versioning: Record<string, unknown>,
): CheckoutRebindIdentity | null {
  if (!('provider' in versioning) || versioning.provider === undefined) return null;
  const provider = versioning.provider;
  if (!isVersioningRecord(provider))
    throw new VersionCheckoutRebindIdentityError('providerScopeInvalid');

  return identityForProviderScope(provider.documentScope, 'providerScopeInvalid');
}

function validateCurrentRebindIdentity(
  versioning: Record<string, unknown>,
  identity: CheckoutRebindIdentity | null,
): void {
  if (!identity) return;

  const storedIdentity = readStoredRebindIdentity(versioning, 'current');
  const storedIdentityMismatch = storedIdentity
    ? providerIdentityClassForMismatch(identity, storedIdentity)
    : null;
  if (storedIdentityMismatch) {
    throw new VersionCheckoutRebindIdentityError('providerScopeMismatch', storedIdentityMismatch);
  }

  const snapshotPortDocumentId = snapshotRootPortDocumentId(versioning.snapshotRootByteSyncPort);
  if (snapshotPortDocumentId && snapshotPortDocumentId !== identity.providerDocumentId) {
    throw new VersionCheckoutRebindIdentityError('providerDocumentMismatch', 'document');
  }
}

function assertMaterializedContextIsUnbound(
  nextContext: DocumentContext,
  identity: CheckoutRebindIdentity | null,
): void {
  const runtime = nextContext as DocumentContext & { versioning?: unknown };
  if (runtime.versioning === undefined || runtime.versioning === null) return;
  if (isVersioningRecord(runtime.versioning)) {
    const keys = Object.keys(runtime.versioning);
    if (
      keys.length === 0 ||
      keys.every((key) => MATERIALIZED_CONTEXT_ALLOWED_VERSIONING_KEYS.has(key))
    ) {
      validatePriorCheckoutRefs(runtime.versioning);
      return;
    }

    const materializedProviderIdentity = identity
      ? materializedProviderRebindIdentity(runtime.versioning)
      : null;
    if (identity && materializedProviderIdentity) {
      throw new VersionCheckoutRebindIdentityError(
        'materializationIdentityStale',
        providerIdentityClassForMismatch(identity, materializedProviderIdentity) ?? 'provider',
      );
    }

    const storedIdentity = identity
      ? readStoredRebindIdentityIfPresent(runtime.versioning, 'materialized')
      : null;
    if (identity && storedIdentity) {
      throw new VersionCheckoutRebindIdentityError(
        'materializationIdentityStale',
        providerIdentityClassForMismatch(identity, storedIdentity) ?? 'materialization',
      );
    }
  }
  throw new VersionCheckoutRebindIdentityError('materializationIdentityStale', 'materialization');
}

function seedMaterializedContextRebindIdentity(
  nextContext: DocumentContext,
  identity: CheckoutRebindIdentity | null,
): void {
  const runtime = nextContext as DocumentContext & { versioning?: unknown };
  if (!identity) {
    delete runtime.versioning;
    return;
  }
  runtime.versioning = Object.freeze({
    [CHECKOUT_REBIND_IDENTITY_FIELD]: cloneRebindIdentity(identity),
  });
}

function materializedProviderRebindIdentity(
  versioning: Record<string, unknown>,
): CheckoutRebindIdentity | null {
  if (!('provider' in versioning) || versioning.provider === undefined) return null;
  const provider = versioning.provider;
  if (!isVersioningRecord(provider)) {
    throw new VersionCheckoutRebindIdentityError('materializationIdentityStale', 'provider');
  }
  try {
    return identityForProviderScope(provider.documentScope, 'materializationIdentityStale');
  } catch (error) {
    if (error instanceof VersionCheckoutRebindIdentityError) {
      throw new VersionCheckoutRebindIdentityError(
        'materializationIdentityStale',
        error.providerIdentityClass,
      );
    }
    throw error;
  }
}

function identityForProviderScope(
  value: unknown,
  invalidReason: RebindIdentityErrorReason,
): CheckoutRebindIdentity {
  try {
    const documentScope = normalizeVersionDocumentScope(value as VersionDocumentScope);
    return Object.freeze({
      schemaVersion: 1 as const,
      providerDocumentScopeKey: versionDocumentScopeKey(documentScope),
      ...(documentScope.workspaceId === undefined
        ? {}
        : { providerWorkspaceId: documentScope.workspaceId }),
      providerDocumentId: documentScope.documentId,
      ...(documentScope.principalScope === undefined
        ? {}
        : { providerPrincipalScope: documentScope.principalScope }),
    });
  } catch {
    throw new VersionCheckoutRebindIdentityError(invalidReason, 'provider');
  }
}

function readStoredRebindIdentity(
  versioning: Record<string, unknown>,
  source: 'current' | 'materialized',
): CheckoutRebindIdentity | null {
  const value = versioning[CHECKOUT_REBIND_IDENTITY_FIELD];
  if (value === undefined) return null;
  if (
    !isVersioningRecord(value) ||
    !Object.keys(value).every((key) => CHECKOUT_REBIND_IDENTITY_KEYS.has(key)) ||
    value.schemaVersion !== 1 ||
    typeof value.providerDocumentScopeKey !== 'string' ||
    typeof value.providerDocumentId !== 'string' ||
    !isOptionalString(value.providerWorkspaceId) ||
    !isOptionalString(value.providerPrincipalScope)
  ) {
    throw new VersionCheckoutRebindIdentityError(
      source === 'current' ? 'currentIdentityInvalid' : 'materializationIdentityStale',
      source === 'current' ? 'scope' : 'materialization',
    );
  }
  const identity = Object.freeze({
    schemaVersion: 1 as const,
    providerDocumentScopeKey: value.providerDocumentScopeKey,
    ...(value.providerWorkspaceId === undefined
      ? {}
      : { providerWorkspaceId: value.providerWorkspaceId }),
    providerDocumentId: value.providerDocumentId,
    ...(value.providerPrincipalScope === undefined
      ? {}
      : { providerPrincipalScope: value.providerPrincipalScope }),
  });
  validateStoredRebindIdentityEnvelope(identity, source);
  return identity;
}

function readStoredRebindIdentityIfPresent(
  versioning: Record<string, unknown>,
  source: 'current' | 'materialized',
): CheckoutRebindIdentity | null {
  return CHECKOUT_REBIND_IDENTITY_FIELD in versioning
    ? readStoredRebindIdentity(versioning, source)
    : null;
}

function cloneRebindIdentity(identity: CheckoutRebindIdentity): CheckoutRebindIdentity {
  return Object.freeze({ ...identity });
}

function snapshotRootPortDocumentId(value: unknown): string | null {
  if (!isVersioningRecord(value) || typeof value.docId !== 'string') return null;
  try {
    return normalizeVersionDocumentScope({ documentId: value.docId }).documentId;
  } catch {
    throw new VersionCheckoutRebindIdentityError('providerDocumentMismatch');
  }
}

function validateStoredRebindIdentityEnvelope(
  identity: CheckoutRebindIdentity,
  source: 'current' | 'materialized',
): void {
  let scopeKey: string;
  try {
    scopeKey = versionDocumentScopeKey({
      ...(identity.providerWorkspaceId === undefined
        ? {}
        : { workspaceId: identity.providerWorkspaceId }),
      documentId: identity.providerDocumentId,
      ...(identity.providerPrincipalScope === undefined
        ? {}
        : { principalScope: identity.providerPrincipalScope }),
    });
  } catch {
    throw new VersionCheckoutRebindIdentityError(
      source === 'current' ? 'currentIdentityInvalid' : 'materializationIdentityStale',
      source === 'current' ? 'scope' : 'materialization',
    );
  }
  if (scopeKey === identity.providerDocumentScopeKey) return;
  throw new VersionCheckoutRebindIdentityError(
    source === 'current' ? 'providerIdentityEnvelopeMismatch' : 'materializationIdentityStale',
    source === 'current' ? 'scope' : 'materialization',
  );
}

function errorNameForReason(reason: RebindIdentityErrorReason): string {
  switch (reason) {
    case 'currentIdentityInvalid':
    case 'providerDocumentMismatch':
    case 'providerIdentityEnvelopeMismatch':
    case 'providerScopeInvalid':
    case 'providerScopeMismatch':
      return 'VersionCheckoutRebindProviderIdentityError';
    case 'priorCheckoutRefInvalid':
    case 'priorCheckoutRefStale':
      return 'VersionCheckoutRebindPriorCheckoutRefError';
    case 'materializationIdentityStale':
      return 'VersionCheckoutRebindMaterializationIdentityError';
  }
}

function providerIdentityClassForMismatch(
  expected: CheckoutRebindIdentity,
  actual: CheckoutRebindIdentity,
): ProviderIdentityClass | null {
  if (actual.providerDocumentScopeKey === expected.providerDocumentScopeKey) return null;
  if (actual.providerWorkspaceId !== expected.providerWorkspaceId) return 'workspace';
  if (actual.providerDocumentId !== expected.providerDocumentId) return 'document';
  if (actual.providerPrincipalScope !== expected.providerPrincipalScope) return 'principal';
  return 'scope';
}

function providerIdentityClassForReason(reason: RebindIdentityErrorReason): ProviderIdentityClass {
  switch (reason) {
    case 'priorCheckoutRefInvalid':
    case 'priorCheckoutRefStale':
      return 'ref';
    case 'providerDocumentMismatch':
      return 'document';
    case 'providerScopeInvalid':
      return 'provider';
    case 'providerIdentityEnvelopeMismatch':
    case 'currentIdentityInvalid':
    case 'providerScopeMismatch':
      return 'scope';
    case 'materializationIdentityStale':
      return 'materialization';
  }
}

function resetSemanticMutationCaptureAfterCheckout(
  versioning: Record<string, unknown>,
  semanticStateReader: ReturnType<typeof createComputeBridgeSemanticStateReader>,
  operationContext: VersionOperationContext | undefined,
): void {
  const semanticCapture = versioning.semanticMutationCapture;
  if (!isVersioningRecord(semanticCapture)) return;
  const reset = semanticCapture.resetNormalCaptureForCheckout;
  if (typeof reset !== 'function') return;
  const resetInput: Record<string, unknown> = { semanticStateReader };
  if (operationContext) resetInput.operationContext = operationContext;
  reset.call(semanticCapture, resetInput);
}

function validatePriorCheckoutRefs(versioning: Record<string, unknown>): void {
  const readActiveCheckoutSession = activeCheckoutSessionReader(versioning);
  if (!readActiveCheckoutSession) return;

  const sessionValue = callPriorCheckoutRefReader(readActiveCheckoutSession);
  if (isThenable(sessionValue)) return;

  const session = parsePriorCheckoutSession(sessionValue);
  if (!session || session.detached) return;

  if (session.checkedOutCommitId !== session.refHeadAtMaterialization) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }
  if (
    session.currentRefHeadId !== undefined &&
    session.currentRefHeadId !== session.refHeadAtMaterialization
  ) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }

  const readRef = checkoutRefReader(versioning);
  if (!readRef) return;

  const refValue = callPriorCheckoutRefReader(() =>
    readRef(publicRefNameFromBranchName(session.branchName)),
  );
  if (isThenable(refValue)) return;

  const currentRefHeadId = projectRefHeadCommitId(refValue);
  if (!currentRefHeadId) {
    throw priorCheckoutRefError('priorCheckoutRefInvalid');
  }
  if (currentRefHeadId !== session.refHeadAtMaterialization) {
    throw priorCheckoutRefError('priorCheckoutRefStale');
  }
}

function callPriorCheckoutRefReader(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }
}

function priorCheckoutRefError(
  reason: Extract<RebindIdentityErrorReason, 'priorCheckoutRefInvalid' | 'priorCheckoutRefStale'>,
): VersionCheckoutRebindIdentityError {
  return new VersionCheckoutRebindIdentityError(reason, 'ref');
}

function activeCheckoutSessionReader(versioning: Record<string, unknown>): (() => unknown) | null {
  for (const candidate of versioningServiceCandidates(versioning)) {
    const read =
      bindMethod(candidate, 'readActiveCheckoutSession') ??
      bindMethod(candidate, 'getActiveCheckoutSession');
    if (read) return () => read();
  }
  return null;
}

function checkoutRefReader(
  versioning: Record<string, unknown>,
): ((name: string) => unknown) | null {
  for (const candidate of [
    versioning.readService,
    versioning.writeService,
    versioning.commitService,
    versioning.publicService,
    versioning.refService,
    versioning,
  ]) {
    const read = bindMethod(candidate, 'readRef') ?? bindMethod(candidate, 'getRef');
    if (read) return (name) => read(name);
  }
  return null;
}

function versioningServiceCandidates(versioning: Record<string, unknown>): readonly unknown[] {
  return [
    versioning.surfaceStatusService,
    versioning.versionSurfaceStatusService,
    versioning.statusService,
    versioning.dirtyStatusService,
    versioning,
  ];
}

function parsePriorCheckoutSession(value: unknown): PriorCheckoutSession | null {
  if (value === null || value === undefined) return null;
  if (!isVersioningRecord(value)) {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  const checkedOutCommitId = toCommitId(value.checkedOutCommitId);
  if (!checkedOutCommitId || typeof value.detached !== 'boolean') {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  if (value.detached) {
    return Object.freeze({ checkedOutCommitId, detached: true });
  }

  const branchName = normalizeCheckoutBranchName(value.branchName ?? value.refName);
  const refHeadAtMaterialization = toCommitId(value.refHeadAtMaterialization);
  if (!branchName || !refHeadAtMaterialization) {
    throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
  }

  let currentRefHeadId: string | undefined;
  if (value.currentRefHeadId !== undefined) {
    currentRefHeadId = toCommitId(value.currentRefHeadId) ?? undefined;
    if (!currentRefHeadId) {
      throw new VersionCheckoutRebindIdentityError('priorCheckoutRefInvalid', 'ref');
    }
  }

  return Object.freeze({
    checkedOutCommitId,
    detached: false,
    branchName,
    refHeadAtMaterialization,
    ...(currentRefHeadId === undefined ? {} : { currentRefHeadId }),
  });
}

function checkoutResetOperationContext(
  operationContext: VersionOperationContext | undefined,
  versioning: Record<string, unknown>,
): VersionOperationContext | undefined {
  if (isVersionOperationContext(operationContext)) return operationContext;

  for (const candidate of checkoutOperationContextCandidates(versioning)) {
    if (isVersionOperationContext(candidate)) return candidate;
  }
  return undefined;
}

function checkoutOperationContextCandidates(
  versioning: Record<string, unknown>,
): readonly unknown[] {
  const semanticCapture = isVersioningRecord(versioning.semanticMutationCapture)
    ? versioning.semanticMutationCapture
    : {};
  return [
    versioning.checkoutOperationContext,
    versioning.operationContext,
    semanticCapture.checkoutOperationContext,
    semanticCapture.operationContext,
  ];
}

function isVersionOperationContext(value: unknown): value is VersionOperationContext {
  if (!isVersioningRecord(value)) return false;
  if (
    typeof value.operationId !== 'string' ||
    value.operationId.length === 0 ||
    typeof value.kind !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !Array.isArray(value.domainIds) ||
    !value.domainIds.every((domainId) => typeof domainId === 'string') ||
    typeof value.capturePolicy !== 'string' ||
    typeof value.writeAdmissionMode !== 'string'
  ) {
    return false;
  }

  const author = value.author;
  return (
    isVersioningRecord(author) &&
    typeof author.authorId === 'string' &&
    author.authorId.length > 0 &&
    typeof author.actorKind === 'string'
  );
}

function projectRefHeadCommitId(value: unknown): string | null {
  if (!isVersioningRecord(value)) return null;
  if (value.status === 'success' && isVersioningRecord(value.ref)) {
    return projectRefHeadCommitId(value.ref);
  }
  if (value.ok === true && isVersioningRecord(value.ref)) {
    return projectRefHeadCommitId(value.ref);
  }
  if ('ref' in value) {
    return value.ref === null ? null : projectRefHeadCommitId(value.ref);
  }
  return toCommitId(value.commitId) ?? toCommitId(value.targetCommitId);
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isVersioningRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as unknown;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isVersioningRecord(value) && typeof value.then === 'function';
}

function normalizeCheckoutBranchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const branchName = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  return validateRefName(branchName).ok ? branchName : null;
}

function publicRefNameFromBranchName(branchName: string): string {
  return `${REF_NAME_STORAGE_PREFIX}${branchName}`;
}

function toCommitId(value: unknown): string | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value) ? value : null;
}

function deleteAttachedVersionServices(config: Record<string, unknown>): void {
  delete config.writeService;
  delete config.readService;
  delete config.commitService;
  delete config.publicService;
  delete config.checkoutService;
  delete config.checkoutMaterializationService;
  delete config.mergeService;
  delete config.versionMergeService;
  delete config.diffService;
  delete config.versionDiffService;
  delete config.branchService;
  delete config.branchRefService;
  delete config.refLifecycleService;
}

function isVersioningRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
