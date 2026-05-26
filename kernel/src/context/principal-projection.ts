import type {
  VerifiedPrincipal,
  KernelPrincipalHandoff,
  PrincipalIssuer,
} from '@mog-sdk/types-host/identity';
import type { AccessPrincipal } from '@mog-sdk/contracts/security';
import type { HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';

// =============================================================================
// Legacy projection (backward-compatible, used by the cooperative/legacy path)
// =============================================================================

export function projectPrincipal(verified: VerifiedPrincipal): KernelPrincipalHandoff {
  const canonicalTags = [...new Set<string>(verified.tags)].sort();

  let accessPrincipal: AccessPrincipal | null = null;
  if (verified.actorKind !== 'anonymous') {
    accessPrincipal = { tags: canonicalTags };
  }

  return {
    verified,
    accessPrincipal,
    canonicalTags,
  };
}

// =============================================================================
// Enhanced projection with full verification (host-compliant path)
// =============================================================================

/**
 * Context required for principal projection and verification.
 * The session-level tenant/workspace/document scope provides the expected
 * values that the principal's claims must match.
 */
export interface PrincipalProjectionContext {
  readonly principal: VerifiedPrincipal;
  readonly sessionTenantId: string | { readonly kind: 'single-tenant' };
  readonly sessionWorkspaceId: string | { readonly kind: 'no-workspace' };
  readonly documentId: string;
  readonly diagnostics: HostDiagnosticsSink;
}

/**
 * Structured error for principal projection failures.
 * The `code` field enables programmatic error handling without message parsing.
 */
export class PrincipalProjectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrincipalProjectionError';
  }
}

// ---------------------------------------------------------------------------
// Trusted issuer and actor kind constants
// ---------------------------------------------------------------------------

/**
 * Issuer kinds that are trusted to assert `mog:*` reserved namespace tags.
 * All issuer kinds in the current PrincipalIssuer union are considered trusted
 * because they represent host-verified origins. An unknown issuerKind (e.g.
 * from a future extension or a forged value) is treated as untrusted.
 */
const TRUSTED_ISSUER_KINDS: ReadonlySet<PrincipalIssuer['issuerKind']> = new Set([
  'mog-hosted',
  'self-hosted',
  'tauri-desktop',
  'trusted-node-process',
  'test',
]);

/**
 * Known actor kinds. The principal's actorKind must be one of these.
 */
const KNOWN_ACTOR_KINDS: ReadonlySet<VerifiedPrincipal['actorKind']> = new Set([
  'user',
  'service-account',
  'app',
  'plugin',
  'agent',
  'anonymous',
  'test',
]);

/**
 * Reserved tag prefix. Tags starting with `mog:` require a trusted issuer.
 */
const RESERVED_TAG_PREFIX = 'mog:';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTrustedIssuer(issuerKind: string): boolean {
  return TRUSTED_ISSUER_KINDS.has(issuerKind as PrincipalIssuer['issuerKind']);
}

function tenantsMatch(
  principalTenantId: string | { readonly kind: 'single-tenant' },
  sessionTenantId: string | { readonly kind: 'single-tenant' },
): boolean {
  if (typeof principalTenantId === 'string' && typeof sessionTenantId === 'string') {
    return principalTenantId === sessionTenantId;
  }
  if (typeof principalTenantId === 'object' && typeof sessionTenantId === 'object') {
    return principalTenantId.kind === sessionTenantId.kind;
  }
  return false;
}

function workspacesMatch(
  principalWorkspaceId: string | { readonly kind: 'no-workspace' },
  sessionWorkspaceId: string | { readonly kind: 'no-workspace' },
): boolean {
  if (typeof principalWorkspaceId === 'string' && typeof sessionWorkspaceId === 'string') {
    return principalWorkspaceId === sessionWorkspaceId;
  }
  if (typeof principalWorkspaceId === 'object' && typeof sessionWorkspaceId === 'object') {
    return principalWorkspaceId.kind === sessionWorkspaceId.kind;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main verifier
// ---------------------------------------------------------------------------

/**
 * Project and verify a host-provided `VerifiedPrincipal` into a
 * `KernelPrincipalHandoff` suitable for Rust workbook security setup.
 *
 * Unlike the legacy `projectPrincipal()`, this function validates:
 * 1. Issuer presence and identity
 * 2. Actor kind membership
 * 3. Tenant/workspace scope match against the session
 * 4. Anonymous semantics (empty tags, null accessPrincipal)
 * 5. Reserved `mog:*` tag namespace authority (only trusted issuers)
 * 6. Tag deduplication and canonical sorting
 * 7. Diagnostic emission for success and failure
 *
 * Throws `PrincipalProjectionError` on validation failure.
 */
export function projectAndVerifyPrincipal(ctx: PrincipalProjectionContext): KernelPrincipalHandoff {
  const { principal, sessionTenantId, sessionWorkspaceId, diagnostics } = ctx;

  const fail = (code: string, reason: string): never => {
    diagnostics.emit({
      kind: 'hostConstruction.invalid',
      correlationId: '',
      timestamp: Date.now(),
      code,
      phase: 'principal-projection',
      invariant: code,
      reason,
    });
    throw new PrincipalProjectionError(code, reason);
  };

  // 1. Issuer validation
  if (!principal.issuer) {
    fail('PRINCIPAL_MISSING_ISSUER', 'VerifiedPrincipal must have an issuer');
  }
  if (!principal.issuer.issuerId) {
    fail('PRINCIPAL_MISSING_ISSUER_ID', 'VerifiedPrincipal issuer must have an issuerId');
  }
  if (!principal.issuer.issuerKind) {
    fail('PRINCIPAL_MISSING_ISSUER_KIND', 'VerifiedPrincipal issuer must have an issuerKind');
  }

  // 2. Actor kind validation
  if (!KNOWN_ACTOR_KINDS.has(principal.actorKind)) {
    fail(
      'PRINCIPAL_UNKNOWN_ACTOR_KIND',
      `Unknown actorKind '${principal.actorKind}'. Expected one of: ${[...KNOWN_ACTOR_KINDS].join(', ')}`,
    );
  }

  // 3. Tenant/workspace scope validation
  if (!tenantsMatch(principal.tenantId, sessionTenantId)) {
    fail('PRINCIPAL_TENANT_MISMATCH', `Principal tenantId does not match session tenantId`);
  }

  if (!workspacesMatch(principal.workspaceId, sessionWorkspaceId)) {
    fail(
      'PRINCIPAL_WORKSPACE_MISMATCH',
      `Principal workspaceId does not match session workspaceId`,
    );
  }

  // 4. Anonymous semantics
  if (principal.actorKind === 'anonymous') {
    if (principal.tags.length > 0) {
      fail('PRINCIPAL_ANONYMOUS_WITH_TAGS', 'Anonymous principals must have empty tags');
    }

    diagnostics.emit({
      kind: 'hostConstruction.invalid',
      correlationId: '',
      timestamp: Date.now(),
      code: 'PRINCIPAL_PROJECTION_OK',
      phase: 'principal-projection',
      invariant: 'projection-success',
      reason: 'Anonymous principal projected successfully',
    });

    return {
      verified: principal,
      accessPrincipal: null,
      canonicalTags: [],
    };
  }

  // 5. Tag namespace authority — reject mog:* tags from untrusted issuers
  const trusted = isTrustedIssuer(principal.issuer.issuerKind);
  const reservedTags = principal.tags.filter((t) => t.startsWith(RESERVED_TAG_PREFIX));

  if (!trusted && reservedTags.length > 0) {
    fail(
      'PRINCIPAL_FORGED_RESERVED_TAG',
      `Issuer '${principal.issuer.issuerId}' (kind: '${principal.issuer.issuerKind}') is not trusted ` +
        `to assert reserved namespace tags: ${reservedTags.join(', ')}`,
    );
  }

  // 6. Canonical tag sorting and deduplication
  const canonicalTags = [...new Set<string>(principal.tags)].sort();
  const accessPrincipal: AccessPrincipal = { tags: canonicalTags };

  // 7. Success diagnostic
  diagnostics.emit({
    kind: 'hostConstruction.invalid',
    correlationId: '',
    timestamp: Date.now(),
    code: 'PRINCIPAL_PROJECTION_OK',
    phase: 'principal-projection',
    invariant: 'projection-success',
    reason: `Principal '${principal.subjectId}' (${principal.actorKind}) projected with ${canonicalTags.length} tag(s)`,
  });

  return {
    verified: principal,
    accessPrincipal,
    canonicalTags,
  };
}
