import type { DocumentContext } from '../../context';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../document/version-store/provider';
import { createComputeBridgeSemanticStateReader } from '../../document/version-store/semantic-state-reader';
import type { WorkbookVersioningConfig } from './types';

const CHECKOUT_REBIND_IDENTITY_FIELD = '__mogCheckoutRebindIdentity';
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
  | 'providerDocumentMismatch'
  | 'providerScopeInvalid'
  | 'providerScopeMismatch';

type ProviderIdentityClass =
  | 'workspace'
  | 'document'
  | 'principal'
  | 'scope'
  | 'provider'
  | 'materialization';

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
}): WorkbookVersioningConfig {
  if (!isVersioningRecord(input.versioning)) return {};
  const identity = providerRebindIdentity(input.versioning);
  validateCurrentRebindIdentity(input.versioning, identity);
  assertMaterializedContextIsUnbound(input.nextContext, identity);
  seedMaterializedContextRebindIdentity(input.nextContext, identity);

  const semanticStateReader = createComputeBridgeSemanticStateReader(
    input.nextContext.computeBridge,
  );
  resetSemanticMutationCaptureAfterCheckout(input.versioning, semanticStateReader);
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
  return Object.freeze({
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

function errorNameForReason(reason: RebindIdentityErrorReason): string {
  switch (reason) {
    case 'currentIdentityInvalid':
    case 'providerDocumentMismatch':
    case 'providerScopeInvalid':
    case 'providerScopeMismatch':
      return 'VersionCheckoutRebindProviderIdentityError';
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
    case 'providerDocumentMismatch':
      return 'document';
    case 'providerScopeInvalid':
      return 'provider';
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
): void {
  const semanticCapture = versioning.semanticMutationCapture;
  if (!isVersioningRecord(semanticCapture)) return;
  const reset = semanticCapture.resetNormalCaptureForCheckout;
  if (typeof reset !== 'function') return;
  reset.call(semanticCapture, { semanticStateReader });
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
