import type {
  CheckoutRebindIdentity,
  ProviderIdentityClass,
  RebindIdentityErrorReason,
} from './version-checkout-rebind-types';

export class VersionCheckoutRebindIdentityError extends Error {
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

export function providerIdentityClassForMismatch(
  expected: CheckoutRebindIdentity,
  actual: CheckoutRebindIdentity,
): ProviderIdentityClass | null {
  if (actual.providerDocumentScopeKey === expected.providerDocumentScopeKey) return null;
  if (actual.providerWorkspaceId !== expected.providerWorkspaceId) return 'workspace';
  if (actual.providerDocumentId !== expected.providerDocumentId) return 'document';
  if (actual.providerPrincipalScope !== expected.providerPrincipalScope) return 'principal';
  return 'scope';
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
