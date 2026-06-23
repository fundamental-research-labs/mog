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
  readonly providerDocumentId: string;
};

type RebindIdentityErrorReason =
  | 'currentIdentityInvalid'
  | 'materializationIdentityStale'
  | 'providerDocumentMismatch'
  | 'providerScopeInvalid'
  | 'providerScopeMismatch';

class VersionCheckoutRebindIdentityError extends Error {
  readonly reason: RebindIdentityErrorReason;

  constructor(reason: RebindIdentityErrorReason) {
    super('Checkout versioning identity could not be safely rebound.');
    this.name = errorNameForReason(reason);
    this.reason = reason;
  }
}

export function checkoutRebindIdentityDiagnosticDetails(
  error: unknown,
): Readonly<Record<string, string>> | null {
  if (!(error instanceof VersionCheckoutRebindIdentityError)) return null;
  return Object.freeze({
    cause: error.name,
    identityFenceReason: error.reason,
  });
}

export function rebindVersioningAfterCheckout(input: {
  readonly versioning: unknown;
  readonly nextContext: DocumentContext;
}): WorkbookVersioningConfig {
  if (!isVersioningRecord(input.versioning)) return {};
  const identity = providerRebindIdentity(input.versioning);
  validateCurrentRebindIdentity(input.versioning, identity);
  assertMaterializedContextIsUnbound(input.nextContext);
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

  const documentScope = normalizeProviderDocumentScope(provider.documentScope);
  return Object.freeze({
    schemaVersion: 1 as const,
    providerDocumentScopeKey: versionDocumentScopeKey(documentScope),
    providerDocumentId: documentScope.documentId,
  });
}

function validateCurrentRebindIdentity(
  versioning: Record<string, unknown>,
  identity: CheckoutRebindIdentity | null,
): void {
  if (!identity) return;

  const storedIdentity = readStoredRebindIdentity(versioning, 'current');
  if (
    storedIdentity &&
    storedIdentity.providerDocumentScopeKey !== identity.providerDocumentScopeKey
  ) {
    throw new VersionCheckoutRebindIdentityError('providerScopeMismatch');
  }

  const snapshotPortDocumentId = snapshotRootPortDocumentId(versioning.snapshotRootByteSyncPort);
  if (snapshotPortDocumentId && snapshotPortDocumentId !== identity.providerDocumentId) {
    throw new VersionCheckoutRebindIdentityError('providerDocumentMismatch');
  }
}

function assertMaterializedContextIsUnbound(nextContext: DocumentContext): void {
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
  }
  throw new VersionCheckoutRebindIdentityError('materializationIdentityStale');
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

function normalizeProviderDocumentScope(value: unknown): VersionDocumentScope {
  try {
    return normalizeVersionDocumentScope(value as VersionDocumentScope);
  } catch {
    throw new VersionCheckoutRebindIdentityError('providerScopeInvalid');
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
    typeof value.providerDocumentId !== 'string'
  ) {
    throw new VersionCheckoutRebindIdentityError(
      source === 'current' ? 'currentIdentityInvalid' : 'materializationIdentityStale',
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    providerDocumentScopeKey: value.providerDocumentScopeKey,
    providerDocumentId: value.providerDocumentId,
  });
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
