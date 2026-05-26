/**
 * Deterministic verified principal fixtures for host-contract testing.
 *
 * Provides a complete set of principal fixtures covering owner, admin,
 * writer, reader, anonymous, test, cross-tenant, cross-workspace, and
 * forged-owner scenarios. No randomness: all values are fixed strings
 * derived from the provided tenant/workspace IDs.
 */

import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';

export interface PrincipalFixtures {
  /** Full owner principal with mog:owner tag from a trusted issuer. */
  readonly owner: VerifiedPrincipal;

  /** Admin principal with mog:admin tag from a trusted issuer. */
  readonly admin: VerifiedPrincipal;

  /** Writer principal with write-level access, no privileged tags. */
  readonly writer: VerifiedPrincipal;

  /** Reader principal with read-only access, no privileged tags. */
  readonly reader: VerifiedPrincipal;

  /** Anonymous principal with actorKind 'anonymous' and empty tags. */
  readonly anonymous: VerifiedPrincipal;

  /** Generic test principal. */
  readonly test: VerifiedPrincipal;

  /** Principal from a different tenant — should fail tenant scope checks. */
  readonly wrongTenant: VerifiedPrincipal;

  /** Principal from a different workspace — should fail workspace scope checks. */
  readonly wrongWorkspace: VerifiedPrincipal;

  /**
   * Forged owner: has mog:owner tag but from an untrusted external issuer.
   * Tests that tag namespace authority is validated, not just tag presence.
   */
  readonly forgedOwner: VerifiedPrincipal;
}

const DEFAULT_TENANT_ID = 'test-tenant';
const DEFAULT_WORKSPACE_ID = 'test-workspace';

export function createPrincipalFixtures(
  tenantId?: string,
  workspaceId?: string,
): PrincipalFixtures {
  const tid = tenantId ?? DEFAULT_TENANT_ID;
  const wid = workspaceId ?? DEFAULT_WORKSPACE_ID;

  const trustedIssuer = {
    issuerId: 'test-issuer',
    issuerKind: 'test' as const,
  };

  const untrustedIssuer = {
    issuerId: 'external-untrusted-issuer',
    issuerKind: 'test' as const,
  };

  return {
    owner: {
      issuer: trustedIssuer,
      subjectId: 'test-owner-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'user',
      tags: ['mog:owner'],
    },

    admin: {
      issuer: trustedIssuer,
      subjectId: 'test-admin-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'user',
      tags: ['mog:admin'],
    },

    writer: {
      issuer: trustedIssuer,
      subjectId: 'test-writer-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'user',
      tags: [],
    },

    reader: {
      issuer: trustedIssuer,
      subjectId: 'test-reader-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'user',
      tags: ['read-only'],
    },

    anonymous: {
      issuer: trustedIssuer,
      subjectId: 'anonymous',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'anonymous',
      tags: [],
    },

    test: {
      issuer: trustedIssuer,
      subjectId: 'test-user-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'test',
      tags: [],
    },

    wrongTenant: {
      issuer: trustedIssuer,
      subjectId: 'test-wrong-tenant-001',
      tenantId: 'wrong-tenant',
      workspaceId: wid,
      actorKind: 'user',
      tags: [],
    },

    wrongWorkspace: {
      issuer: trustedIssuer,
      subjectId: 'test-wrong-workspace-001',
      tenantId: tid,
      workspaceId: 'wrong-workspace',
      actorKind: 'user',
      tags: [],
    },

    forgedOwner: {
      issuer: untrustedIssuer,
      subjectId: 'test-forged-owner-001',
      tenantId: tid,
      workspaceId: wid,
      actorKind: 'user',
      tags: ['mog:owner'],
    },
  };
}
