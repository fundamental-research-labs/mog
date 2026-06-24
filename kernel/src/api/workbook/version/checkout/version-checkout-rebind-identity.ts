import type { DocumentContext } from '../../../../context';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../../../../document/version-store/provider';
import {
  providerIdentityClassForMismatch,
  VersionCheckoutRebindIdentityError,
} from './version-checkout-rebind-errors';
import { validatePriorCheckoutRefs } from './version-checkout-rebind-prior-refs';
import type {
  CheckoutRebindIdentity,
  RebindIdentityErrorReason,
} from './version-checkout-rebind-types';
import { isOptionalString, isVersioningRecord } from './version-checkout-rebind-utils';

const CHECKOUT_REBIND_IDENTITY_FIELD = '__mogCheckoutRebindIdentity';
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

export function providerRebindIdentity(
  versioning: Record<string, unknown>,
): CheckoutRebindIdentity | null {
  if (!('provider' in versioning) || versioning.provider === undefined) return null;
  const provider = versioning.provider;
  if (!isVersioningRecord(provider))
    throw new VersionCheckoutRebindIdentityError('providerScopeInvalid');

  return identityForProviderScope(provider.documentScope, 'providerScopeInvalid');
}

export function validateCurrentRebindIdentity(
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

export function assertMaterializedContextIsUnbound(
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

export function seedMaterializedContextRebindIdentity(
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
